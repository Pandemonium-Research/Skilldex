import { readFile, stat, readdir } from 'node:fs/promises'
import path from 'node:path'
import { parseDocument } from 'yaml'
import type { ValidationDiagnostic } from '../types/skill.js'
import type { SkillsetFrontmatter, SkillsetValidationResult, RemoteSkillRef } from '../types/skillset.js'

export const SKILLSET_SPEC_VERSION = '1.0'
const SKILLSET_MD = 'SKILLSET.md'
const MIN_DESCRIPTION_WORDS = 30

// Scoring weights (total 100)
const WEIGHTS = {
  frontmatterParseable: 25,
  namePresent: 10,
  descriptionPresent: 10,
  descriptionLength: 10,
  hasSkills: 20,
  allowedSubdirs: 10,
  validSourceUrls: 15,
} as const

export async function validateSkillset(skillsetPath: string): Promise<SkillsetValidationResult> {
  const diagnostics: ValidationDiagnostic[] = []
  let score = 0

  const absPath = path.resolve(skillsetPath)

  try {
    const s = await stat(absPath)
    if (!s.isDirectory()) {
      return fatal(skillsetPath, `Path is not a directory: ${absPath}`)
    }
  } catch {
    return fatal(skillsetPath, `Path does not exist: ${absPath}`)
  }

  const skillsetMdPath = path.join(absPath, SKILLSET_MD)
  let content: string
  try {
    content = await readFile(skillsetMdPath, 'utf8')
  } catch {
    return fatal(skillsetPath, `SKILLSET.md not found in ${absPath}`)
  }

  const lines = content.split('\n')

  // --- Check: YAML frontmatter parseable (25 pts) ---
  const { frontmatter, parseError } = extractFrontmatter(content, lines)

  if (parseError || frontmatter === null) {
    return {
      skillset: path.basename(absPath),
      score: 0,
      diagnostics: [
        {
          severity: 'error',
          line: 1,
          message: parseError ?? 'Missing YAML frontmatter — file must start with ---',
          check: 'yaml-frontmatter',
        },
      ],
      specVersion: SKILLSET_SPEC_VERSION,
      embeddedSkills: [],
      remoteSkills: [],
      passCount: 0,
      warnCount: 0,
      errorCount: 1,
    }
  }

  score += WEIGHTS.frontmatterParseable
  diagnostics.push({ severity: 'pass', message: 'YAML frontmatter valid', check: 'yaml-frontmatter' })

  // --- Check: name present (10 pts) ---
  if (!frontmatter.name || String(frontmatter.name).trim() === '') {
    diagnostics.push({
      severity: 'error',
      message: 'Required field "name" is missing or empty',
      check: 'name-present',
    })
  } else {
    score += WEIGHTS.namePresent
    diagnostics.push({ severity: 'pass', message: 'name field present', check: 'name-present' })
  }

  // --- Check: description present + length (20 pts total) ---
  if (!frontmatter.description || String(frontmatter.description).trim() === '') {
    diagnostics.push({
      severity: 'error',
      message: 'Required field "description" is missing or empty',
      check: 'description-length',
    })
  } else {
    score += WEIGHTS.descriptionPresent
    const wordCount = String(frontmatter.description).trim().split(/\s+/).length
    if (wordCount < MIN_DESCRIPTION_WORDS) {
      diagnostics.push({
        severity: 'error',
        message: `description too short (current: ${wordCount} words, recommended: ${MIN_DESCRIPTION_WORDS}+)`,
        check: 'description-length',
      })
    } else {
      score += WEIGHTS.descriptionLength
      diagnostics.push({
        severity: 'pass',
        message: `description meets length requirement (${wordCount} words)`,
        check: 'description-length',
      })
    }
  }

  // --- Discover embedded skills and collect remote refs ---
  const embeddedSkills = await discoverEmbeddedSkills(absPath)
  const remoteSkills: RemoteSkillRef[] = Array.isArray(frontmatter.skills)
    ? (frontmatter.skills as RemoteSkillRef[]).filter(
        (s) => s && typeof s.name === 'string' && typeof s.source_url === 'string'
      )
    : []

  // --- Check: at least 1 skill (20 pts) ---
  if (embeddedSkills.length === 0 && remoteSkills.length === 0) {
    diagnostics.push({
      severity: 'error',
      message: 'Skillset must contain at least one embedded skill (subdir with SKILL.md) or remote skill reference',
      check: 'has-skills',
    })
  } else {
    score += WEIGHTS.hasSkills
    diagnostics.push({
      severity: 'pass',
      message: `${embeddedSkills.length} embedded skill(s), ${remoteSkills.length} remote reference(s)`,
      check: 'has-skills',
    })
  }

  // --- Check: no unknown top-level dirs (10 pts) ---
  const unknownDirs = await checkUnknownDirs(absPath, embeddedSkills)
  if (unknownDirs.length > 0) {
    for (const dir of unknownDirs) {
      diagnostics.push({
        severity: 'warning',
        message: `Unknown subdirectory "${dir}" — only embedded skill dirs (with SKILL.md) and assets/ are allowed`,
        check: 'allowed-subdirs',
      })
    }
    const deduction = Math.min(WEIGHTS.allowedSubdirs, unknownDirs.length * 3)
    score += Math.max(0, WEIGHTS.allowedSubdirs - deduction)
  } else {
    score += WEIGHTS.allowedSubdirs
    diagnostics.push({ severity: 'pass', message: 'Folder structure matches convention', check: 'allowed-subdirs' })
  }

  // --- Check: remote source_url fields are valid GitHub URLs (15 pts) ---
  if (remoteSkills.length === 0) {
    // No remote refs to validate — full credit
    score += WEIGHTS.validSourceUrls
    diagnostics.push({ severity: 'pass', message: 'No remote skill references to validate', check: 'valid-source-urls' })
  } else {
    const invalidRefs = remoteSkills.filter((s) => !isValidGitHubUrl(s.source_url))
    if (invalidRefs.length > 0) {
      for (const ref of invalidRefs) {
        diagnostics.push({
          severity: 'error',
          message: `Remote skill "${ref.name}" has invalid source_url: "${ref.source_url}" — must be a GitHub URL`,
          check: 'valid-source-urls',
        })
      }
    } else {
      score += WEIGHTS.validSourceUrls
      diagnostics.push({
        severity: 'pass',
        message: `All ${remoteSkills.length} remote source URL(s) are valid`,
        check: 'valid-source-urls',
      })
    }
  }

  score = Math.min(100, Math.max(0, Math.round(score)))

  return {
    skillset: path.basename(absPath),
    score,
    diagnostics,
    specVersion: SKILLSET_SPEC_VERSION,
    embeddedSkills,
    remoteSkills,
    passCount: diagnostics.filter((d) => d.severity === 'pass').length,
    warnCount: diagnostics.filter((d) => d.severity === 'warning').length,
    errorCount: diagnostics.filter((d) => d.severity === 'error').length,
  }
}

// --- Helpers ---

function fatal(skillsetPath: string, message: string): SkillsetValidationResult {
  return {
    skillset: path.basename(skillsetPath),
    score: 0,
    diagnostics: [{ severity: 'error', message, check: 'skillset-exists' }],
    specVersion: SKILLSET_SPEC_VERSION,
    embeddedSkills: [],
    remoteSkills: [],
    passCount: 0,
    warnCount: 0,
    errorCount: 1,
  }
}

interface FrontmatterResult {
  frontmatter: SkillsetFrontmatter | null
  parseError: string | null
}

function extractFrontmatter(content: string, lines: string[]): FrontmatterResult {
  if (!lines[0]?.trimEnd().startsWith('---')) {
    return { frontmatter: null, parseError: 'Missing YAML frontmatter — file must start with ---' }
  }

  let endIndex = -1
  for (let i = 1; i < lines.length; i++) {
    if (lines[i].trimEnd() === '---') {
      endIndex = i
      break
    }
  }

  if (endIndex === -1) {
    return { frontmatter: null, parseError: 'Unclosed YAML frontmatter — missing closing ---' }
  }

  const yamlContent = lines.slice(1, endIndex).join('\n')

  try {
    const doc = parseDocument(yamlContent)
    if (doc.errors.length > 0) {
      return { frontmatter: null, parseError: `YAML parse error: ${doc.errors[0].message}` }
    }
    return { frontmatter: doc.toJS() as SkillsetFrontmatter, parseError: null }
  } catch (e) {
    return {
      frontmatter: null,
      parseError: `YAML parse error: ${e instanceof Error ? e.message : String(e)}`,
    }
  }
}

async function discoverEmbeddedSkills(skillsetPath: string): Promise<string[]> {
  const embedded: string[] = []
  try {
    const entries = await readdir(skillsetPath, { withFileTypes: true })
    for (const entry of entries) {
      if (!entry.isDirectory()) continue
      try {
        await stat(path.join(skillsetPath, entry.name, 'SKILL.md'))
        embedded.push(entry.name)
      } catch {
        // no SKILL.md — not an embedded skill
      }
    }
  } catch {
    // ignore readdir errors
  }
  return embedded
}

async function checkUnknownDirs(skillsetPath: string, embeddedSkillNames: string[]): Promise<string[]> {
  const embeddedSet = new Set(embeddedSkillNames)
  const unknown: string[] = []
  try {
    const entries = await readdir(skillsetPath, { withFileTypes: true })
    for (const entry of entries) {
      if (!entry.isDirectory()) continue
      if (entry.name === 'assets') continue
      if (embeddedSet.has(entry.name)) continue
      unknown.push(entry.name)
    }
  } catch {
    // ignore
  }
  return unknown
}

function isValidGitHubUrl(url: string): boolean {
  try {
    const parsed = new URL(url)
    return parsed.hostname === 'github.com' && parsed.protocol === 'https:'
  } catch {
    return false
  }
}
