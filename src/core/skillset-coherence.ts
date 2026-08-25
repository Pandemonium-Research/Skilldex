import { readFile, readdir, stat } from 'node:fs/promises'
import path from 'node:path'
import { parseDocument } from 'yaml'
import type {
  DeclaredConvention,
  CoherenceDiagnostic,
  SkillsetCoherenceResult,
  MarkdownTable,
} from '../types/skillset.js'

const SKILL_MD = 'SKILL.md'
const ASSETS_DIR = 'assets'
const CONVENTIONS_INFO_TAG = 'skilldex-conventions'

/** Minimum overlapping keys before a member table is treated as restating a convention. */
const RESTATEMENT_KEY_THRESHOLD = 2

/**
 * Checks that a skillset's member skills agree with the conventions its shared assets declare.
 *
 * Structural validation (see skillset-validator.ts) establishes that a skillset is well-formed.
 * It cannot express agreement *between* members, which is the property skillsets exist to provide:
 * conventions live in one shared asset so independently authored members cannot drift apart.
 *
 * Agreement is checked against conventions the shared asset *declares* in a fenced
 * ```yaml skilldex-conventions``` block, not inferred from prose. A member that restates a
 * declared mapping and contradicts it is an error. A member that appears to restate a convention
 * nobody declared is a warning — the fix is to declare it.
 */
export async function checkSkillsetCoherence(
  skillsetPath: string,
  embeddedSkills: string[]
): Promise<SkillsetCoherenceResult> {
  const absPath = path.resolve(skillsetPath)
  const diagnostics: CoherenceDiagnostic[] = []

  const sharedAssets = await listSharedAssets(absPath)
  const declaredConventions = await collectDeclaredConventions(absPath, sharedAssets)

  const coherentMembers = new Set(embeddedSkills)

  for (const member of embeddedSkills) {
    const memberDir = path.join(absPath, member)
    let content: string
    try {
      content = await readFile(path.join(memberDir, SKILL_MD), 'utf8')
    } catch {
      // discoverEmbeddedSkills only lists dirs with a readable SKILL.md; a failure here means it
      // vanished between the two reads. Nothing to check.
      continue
    }

    const refs = extractAssetReferences(content)
    const tables = parseMarkdownTables(content)

    const before = diagnostics.length

    diagnostics.push(...checkSharedAssetReferenced(member, refs, sharedAssets))
    diagnostics.push(...(await checkSharedAssetResolvable(member, memberDir, refs)))
    diagnostics.push(...checkAgreement(member, tables, declaredConventions))

    if (declaredConventions.length === 0) {
      diagnostics.push(...(await checkUndeclaredConventions(absPath, member, tables, sharedAssets)))
    }

    const added = diagnostics.slice(before)
    if (added.some((d) => d.severity === 'error' || d.severity === 'warning')) {
      coherentMembers.delete(member)
    }
  }

  return {
    declaredConventions,
    diagnostics,
    membersChecked: embeddedSkills.length,
    membersCoherent: coherentMembers.size,
    passCount: diagnostics.filter((d) => d.severity === 'pass').length,
    warnCount: diagnostics.filter((d) => d.severity === 'warning').length,
    errorCount: diagnostics.filter((d) => d.severity === 'error').length,
  }
}

// --- Check: every member reaches for at least one skillset-level shared asset ---

function checkSharedAssetReferenced(
  member: string,
  refs: AssetReference[],
  sharedAssets: string[]
): CoherenceDiagnostic[] {
  if (sharedAssets.length === 0) return []

  const sharedRefs = refs.filter((r) => r.isSkillsetLevel)
  if (sharedRefs.length === 0) {
    return [
      {
        severity: 'warning',
        check: 'shared-asset-referenced',
        member,
        message: `"${member}" references no skillset-level shared asset (../${ASSETS_DIR}/…) — it is outside the skillset's convention guarantee`,
      },
    ]
  }

  return [
    {
      severity: 'pass',
      check: 'shared-asset-referenced',
      member,
      message: `"${member}" references ${sharedRefs.length} shared asset(s)`,
    },
  ]
}

// --- Check: referenced asset paths actually resolve ---

async function checkSharedAssetResolvable(
  member: string,
  memberDir: string,
  refs: AssetReference[]
): Promise<CoherenceDiagnostic[]> {
  const diagnostics: CoherenceDiagnostic[] = []

  for (const ref of refs) {
    const resolved = path.resolve(memberDir, ref.rawPath)
    try {
      await stat(resolved)
    } catch {
      diagnostics.push({
        severity: 'error',
        check: 'shared-asset-resolvable',
        member,
        line: ref.line,
        message: `"${member}" references "${ref.rawPath}" which does not exist`,
        assetFile: ref.rawPath,
      })
    }
  }

  if (diagnostics.length === 0 && refs.length > 0) {
    diagnostics.push({
      severity: 'pass',
      check: 'shared-asset-resolvable',
      member,
      message: `all ${refs.length} asset reference(s) in "${member}" resolve`,
    })
  }

  return diagnostics
}

// --- Check: restated conventions agree with the declaration ---

function checkAgreement(
  member: string,
  tables: MarkdownTable[],
  conventions: DeclaredConvention[]
): CoherenceDiagnostic[] {
  const diagnostics: CoherenceDiagnostic[] = []

  for (const convention of conventions) {
    const restatement = findRestatement(tables, convention)
    if (!restatement) continue

    const vocabulary = buildVocabulary(convention)
    let contradictions = 0
    let unverifiable = 0
    let compared = 0

    for (const [key, memberValue] of Object.entries(restatement.mapping)) {
      const declaredValue = convention.mapping[key]
      if (declaredValue === undefined) continue
      compared++

      const declaredNorm = normalizeValue(declaredValue)
      const memberNorm = resolveAgainstVocabulary(normalizeValue(memberValue), vocabulary)

      if (memberNorm === null) {
        unverifiable++
        diagnostics.push({
          severity: 'warning',
          check: 'shared-asset-agreement',
          member,
          line: restatement.line,
          conventionName: convention.name,
          key,
          declaredValue,
          memberValue,
          assetFile: convention.assetFile,
          assetLine: convention.line,
          message: `"${member}" restates "${convention.name}" but its value for \`${key}\` ("${memberValue}") does not match any value the declaration uses — cannot verify agreement`,
        })
      } else if (memberNorm !== declaredNorm) {
        contradictions++
        diagnostics.push({
          severity: 'error',
          check: 'shared-asset-agreement',
          member,
          line: restatement.line,
          conventionName: convention.name,
          key,
          declaredValue,
          memberValue,
          assetFile: convention.assetFile,
          assetLine: convention.line,
          message: `"${member}" contradicts "${convention.name}": \`${key}\` is "${memberValue}" here but "${declaredValue}" in ${convention.assetFile}:${convention.line}`,
        })
      }
    }

    if (contradictions === 0 && unverifiable === 0) {
      diagnostics.push({
        severity: 'pass',
        check: 'shared-asset-agreement',
        member,
        conventionName: convention.name,
        message: `"${member}" restates "${convention.name}" consistently (${compared} of ${Object.keys(convention.mapping).length} declared key(s) checked)`,
      })
    }
  }

  return diagnostics
}

// --- Check: a convention appears duplicated but was never declared ---

async function checkUndeclaredConventions(
  skillsetPath: string,
  member: string,
  memberTables: MarkdownTable[],
  sharedAssets: string[]
): Promise<CoherenceDiagnostic[]> {
  if (memberTables.length === 0) return []

  for (const asset of sharedAssets) {
    let assetContent: string
    try {
      assetContent = await readFile(path.join(skillsetPath, asset), 'utf8')
    } catch {
      continue
    }

    const assetTables = parseMarkdownTables(assetContent)

    for (const memberTable of memberTables) {
      for (const assetTable of assetTables) {
        const overlap = countKeyOverlap(memberTable, assetTable)
        if (overlap >= RESTATEMENT_KEY_THRESHOLD) {
          return [
            {
              severity: 'warning',
              check: 'undeclared-convention',
              member,
              line: memberTable.line,
              assetFile: asset,
              assetLine: assetTable.line,
              message: `"${member}" appears to restate a table from ${asset}:${assetTable.line} (${overlap} shared keys) but that convention is not declared — add a \`\`\`yaml ${CONVENTIONS_INFO_TAG}\`\`\` block to ${asset} so agreement can be enforced`,
            },
          ]
        }
      }
    }
  }

  return []
}

// --- Declared conventions ---

async function listSharedAssets(skillsetPath: string): Promise<string[]> {
  const assetsPath = path.join(skillsetPath, ASSETS_DIR)
  try {
    const entries = await readdir(assetsPath, { withFileTypes: true })
    return entries
      .filter((e) => e.isFile() && e.name.endsWith('.md'))
      .map((e) => path.posix.join(ASSETS_DIR, e.name))
  } catch {
    return []
  }
}

async function collectDeclaredConventions(
  skillsetPath: string,
  sharedAssets: string[]
): Promise<DeclaredConvention[]> {
  const conventions: DeclaredConvention[] = []

  for (const asset of sharedAssets) {
    let content: string
    try {
      content = await readFile(path.join(skillsetPath, asset), 'utf8')
    } catch {
      continue
    }
    conventions.push(...parseDeclaredConventions(content, asset))
  }

  return conventions
}

/** Extracts ```yaml skilldex-conventions fenced blocks. Exported for tests. */
export function parseDeclaredConventions(content: string, assetFile: string): DeclaredConvention[] {
  const conventions: DeclaredConvention[] = []
  const lines = content.split('\n')

  for (let i = 0; i < lines.length; i++) {
    const fence = lines[i].match(/^(\s*)(`{3,}|~{3,})\s*(.*)$/)
    if (!fence) continue

    const [, indent, marker, info] = fence
    if (!info.split(/\s+/).includes(CONVENTIONS_INFO_TAG)) continue

    const closer = new RegExp(`^\\s{0,${indent.length}}${marker[0]}{${marker.length},}\\s*$`)
    let end = -1
    for (let j = i + 1; j < lines.length; j++) {
      if (closer.test(lines[j])) {
        end = j
        break
      }
    }
    if (end === -1) continue

    const body = lines.slice(i + 1, end).join('\n')
    const blockLine = i + 1

    try {
      const doc = parseDocument(body)
      if (doc.errors.length > 0) continue

      const parsed = doc.toJS() as Record<string, unknown> | null
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) continue

      for (const [name, value] of Object.entries(parsed)) {
        const mapping = toFlatMapping(value)
        if (mapping === null || Object.keys(mapping).length === 0) continue
        conventions.push({ name, assetFile, line: blockLine, mapping })
      }
    } catch {
      // unparseable block — skip; structural validation reports malformed YAML separately
    }

    i = end
  }

  return conventions
}

function toFlatMapping(value: unknown): Record<string, string> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null

  const mapping: Record<string, string> = {}
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    if (v === null || typeof v === 'object') return null
    mapping[normalizeKey(k)] = String(v)
  }
  return mapping
}

// --- Asset references ---

interface AssetReference {
  rawPath: string
  line: number
  isSkillsetLevel: boolean
}

/** Finds backticked paths pointing into assets/ or references/. Exported for tests. */
export function extractAssetReferences(content: string): AssetReference[] {
  const refs: AssetReference[] = []
  const seen = new Set<string>()
  const lines = content.split('\n')

  const pattern = /`((?:\.\.\/)?(?:assets|references)\/[^`\s]+)`/g

  for (let i = 0; i < lines.length; i++) {
    for (const match of lines[i].matchAll(pattern)) {
      const rawPath = match[1]
      if (seen.has(rawPath)) continue
      seen.add(rawPath)
      refs.push({
        rawPath,
        line: i + 1,
        isSkillsetLevel: rawPath.startsWith('../'),
      })
    }
  }

  return refs
}

// --- Markdown tables ---

/** Parses pipe tables into header + rows. Exported for tests. */
export function parseMarkdownTables(content: string): MarkdownTable[] {
  const tables: MarkdownTable[] = []
  const lines = content.split('\n')

  for (let i = 0; i < lines.length - 1; i++) {
    if (!isTableRow(lines[i]) || !isSeparatorRow(lines[i + 1])) continue

    const header = splitRow(lines[i])
    const rows: string[][] = []
    let j = i + 2
    for (; j < lines.length && isTableRow(lines[j]); j++) {
      rows.push(splitRow(lines[j]))
    }

    if (rows.length > 0) {
      tables.push({ line: i + 1, header, rows })
    }
    i = j - 1
  }

  return tables
}

function isTableRow(line: string): boolean {
  return line.trim().startsWith('|') && line.includes('|', line.indexOf('|') + 1)
}

function isSeparatorRow(line: string): boolean {
  const trimmed = line.trim()
  if (!trimmed.startsWith('|')) return false
  return splitRow(line).every((cell) => /^:?-{1,}:?$/.test(cell.trim()))
}

function splitRow(line: string): string[] {
  const trimmed = line.trim().replace(/^\|/, '').replace(/\|$/, '')
  return trimmed.split('|').map((c) => c.trim())
}

// --- Restatement matching ---

interface Restatement {
  line: number
  mapping: Record<string, string>
}

/**
 * A member restates a convention when one of its tables projects onto the convention's key space.
 * Tables carry more than two columns (`| Type | Use when | Changelog section |`), so every
 * (first column -> column j) projection is tried and the best one wins.
 *
 * Key overlap alone does not identify the value column: in `| Type | Notes | Section |` both
 * projections share exactly the same keys, and picking the wrong one compares prose against the
 * convention and reports nothing useful. Ties therefore break on how many values land in the
 * convention's own vocabulary — the value column is the one speaking the convention's language.
 */
function findRestatement(
  tables: MarkdownTable[],
  convention: DeclaredConvention
): Restatement | null {
  const vocabulary = buildVocabulary(convention)

  let best: Restatement | null = null
  let bestOverlap = 0
  let bestResolvable = -1

  for (const table of tables) {
    const columnCount = Math.max(...table.rows.map((r) => r.length), table.header.length)

    for (let col = 1; col < columnCount; col++) {
      const mapping = projectTable(table, col)
      const sharedKeys = Object.keys(mapping).filter((k) => k in convention.mapping)
      if (sharedKeys.length < RESTATEMENT_KEY_THRESHOLD) continue

      const resolvable = sharedKeys.filter(
        (k) => resolveAgainstVocabulary(normalizeValue(mapping[k]), vocabulary) !== null
      ).length

      const better =
        sharedKeys.length > bestOverlap ||
        (sharedKeys.length === bestOverlap && resolvable > bestResolvable)

      if (better) {
        bestOverlap = sharedKeys.length
        bestResolvable = resolvable
        best = { line: table.line, mapping }
      }
    }
  }

  return best
}

function projectTable(table: MarkdownTable, valueColumn: number): Record<string, string> {
  const mapping: Record<string, string> = {}

  for (const row of table.rows) {
    if (row.length <= valueColumn) continue
    const value = row[valueColumn].trim()
    if (value === '') continue

    for (const key of splitKeyCell(row[0])) {
      mapping[key] = value
    }
  }

  return mapping
}

/** `fix`, `revert` in one cell means two keys sharing a value. */
function splitKeyCell(cell: string): string[] {
  const backticked = [...cell.matchAll(/`([^`]+)`/g)].map((m) => normalizeKey(m[1]))
  if (backticked.length > 0) return backticked

  const bare = normalizeKey(cell)
  return bare === '' ? [] : [bare]
}

function countKeyOverlap(a: MarkdownTable, b: MarkdownTable): number {
  const keysOf = (t: MarkdownTable) =>
    new Set(t.rows.flatMap((row) => (row.length > 0 ? splitKeyCell(row[0]) : [])))

  const aKeys = keysOf(a)
  const bKeys = keysOf(b)
  let overlap = 0
  for (const key of aKeys) {
    if (bKeys.has(key)) overlap++
  }
  return overlap
}

// --- Normalization ---

function normalizeKey(raw: string): string {
  return raw
    .replace(/`/g, '')
    .replace(/\*\*?/g, '')
    .trim()
    .toLowerCase()
}

/**
 * Strips the decoration authors put around table values so that "**Added**", "`Added`" and
 * "Added" compare equal. Leading dashes are dropped because "— (omit from changelog)" is a
 * conventional way to write an empty cell.
 */
function normalizeValue(raw: string): string {
  return raw
    .replace(/`/g, '')
    .replace(/\*\*?/g, '')
    .replace(/^[\s—–-]+/, '')
    .replace(/[()]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase()
}

function buildVocabulary(convention: DeclaredConvention): string[] {
  const vocabulary = new Set<string>()
  for (const value of Object.values(convention.mapping)) {
    vocabulary.add(normalizeValue(value))
  }
  // Longest first so "omit from changelog" resolves to "omit" rather than a shorter prefix.
  return [...vocabulary].sort((a, b) => b.length - a.length)
}

/**
 * Resolves a member's phrasing to a declared value, or null when it matches none.
 *
 * Null is deliberately *not* treated as a contradiction. "— (omit from changelog)" and "Omit"
 * are the same rule in different prose, and reporting that as a conflict would make the check
 * fire on correct skillsets. Only a value that resolves to a *different* declared value is an
 * error; anything unrecognized is a warning the author can fix by matching the declaration.
 */
function resolveAgainstVocabulary(normalized: string, vocabulary: string[]): string | null {
  for (const candidate of vocabulary) {
    if (normalized === candidate) return candidate
  }
  for (const candidate of vocabulary) {
    if (normalized.startsWith(`${candidate} `)) return candidate
  }
  return null
}
