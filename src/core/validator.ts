import { readFile, stat, readdir } from 'node:fs/promises'
import path from 'node:path'
import { parseDocument } from 'yaml'
import type { ValidationResult, ValidationDiagnostic, SkillFrontmatter } from '../types/skill.js'

export const SPEC_VERSION = '1.0'
const SKILL_MD = 'SKILL.md'
const ALLOWED_SUBDIRS = new Set(['scripts', 'references', 'assets'])
const MAX_LINES = 500
const WARN_LINES = 400
const MIN_DESCRIPTION_WORDS = 30
const MAX_DESCRIPTION_CHARS = 1024
// name must be kebab-case: lowercase letters/digits separated by single hyphens
const KEBAB_CASE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/
// "claude" and "anthropic" are reserved and cannot appear in a skill name
const RESERVED_NAME_WORDS = ['claude', 'anthropic']

// Scoring weights — derived from a 2-axis spec rubric (mandate x failure impact),
// normalized to 100. See docs/validation.md "How the weights were derived".
const WEIGHTS = {
  frontmatterParseable: 16,
  namePresent: 16,
  nameFormat: 11,
  descriptionPresent: 16,
  descriptionLength: 6,
  descriptionFormat: 11,
  lineCount: 7,
  allowedSubdirs: 4,
  noReadme: 4,
  referencedResourcesExist: 7,
  bundledResourcesCorrect: 2,
} as const

export async function validateSkill(skillPath: string): Promise<ValidationResult> {
  const diagnostics: ValidationDiagnostic[] = []
  let score = 0

  const absPath = path.resolve(skillPath)

  // Check that path exists and is a directory
  try {
    const s = await stat(absPath)
    if (!s.isDirectory()) {
      return fatal(skillPath, `Path is not a directory: ${absPath}`)
    }
  } catch {
    return fatal(skillPath, `Path does not exist: ${absPath}`)
  }

  // Check SKILL.md exists
  const skillMdPath = path.join(absPath, SKILL_MD)
  let content: string
  try {
    content = await readFile(skillMdPath, 'utf8')
  } catch {
    return fatal(skillPath, `SKILL.md not found in ${absPath}`)
  }

  const lines = content.split('\n')
  const lineCount = lines.length

  // --- Check: YAML frontmatter parseable (25 pts) ---
  const { frontmatter, frontmatterEndLine, parseError } = extractFrontmatter(content, lines)

  if (parseError || frontmatter === null) {
    // Frontmatter is fatal — no other checks make sense without it
    return {
      skill: path.basename(absPath),
      score: 0,
      diagnostics: [
        {
          severity: 'error',
          line: 1,
          message: parseError ?? 'Missing YAML frontmatter — file must start with ---',
          check: 'yaml-frontmatter',
        },
      ],
      specVersion: SPEC_VERSION,
      passCount: 0,
      warnCount: 0,
      errorCount: 1,
    }
  } else {
    score += WEIGHTS.frontmatterParseable
    diagnostics.push({
      severity: 'pass',
      message: 'YAML frontmatter valid',
      check: 'yaml-frontmatter',
    })

    // --- Check: name present (16 pts) ---
    const nameValue = frontmatter.name == null ? '' : String(frontmatter.name).trim()
    const nameLine = findFieldLine(lines, 'name', frontmatterEndLine)
    if (nameValue === '') {
      diagnostics.push({
        severity: 'error',
        line: nameLine,
        message: 'Required field "name" is missing or empty',
        check: 'name-present',
      })
    } else {
      score += WEIGHTS.namePresent
      diagnostics.push({
        severity: 'pass',
        message: 'name field present',
        check: 'name-present',
      })

      // --- Check: name format — kebab-case + not reserved (11 pts) ---
      const nameErrors: string[] = []
      if (!KEBAB_CASE.test(nameValue)) {
        nameErrors.push(
          `name "${nameValue}" is not kebab-case — use lowercase letters, digits, and hyphens only`
        )
      }
      const reserved = RESERVED_NAME_WORDS.find((w) => nameValue.toLowerCase().includes(w))
      if (reserved) {
        nameErrors.push(
          `name contains reserved word "${reserved}" — "claude" and "anthropic" are reserved`
        )
      }
      if (nameErrors.length > 0) {
        for (const message of nameErrors) {
          diagnostics.push({ severity: 'error', line: nameLine, message, check: 'name-format' })
        }
      } else {
        score += WEIGHTS.nameFormat
        diagnostics.push({
          severity: 'pass',
          message: 'name is kebab-case and uses no reserved words',
          check: 'name-format',
        })
      }
    }

    // --- Check: description present + length + format ---
    const descLine = findFieldLine(lines, 'description', frontmatterEndLine)
    const descValue = frontmatter.description == null ? '' : String(frontmatter.description).trim()
    if (descValue === '') {
      diagnostics.push({
        severity: 'error',
        line: descLine,
        message: 'Required field "description" is missing or empty',
        check: 'description-present',
      })
    } else {
      score += WEIGHTS.descriptionPresent
      const wordCount = descValue.split(/\s+/).length
      if (wordCount < MIN_DESCRIPTION_WORDS) {
        diagnostics.push({
          severity: 'error',
          line: descLine,
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

      // --- Check: description format — char limit + no XML tags (11 pts) ---
      const descErrors: string[] = []
      if (descValue.length > MAX_DESCRIPTION_CHARS) {
        descErrors.push(
          `description exceeds ${MAX_DESCRIPTION_CHARS} characters (current: ${descValue.length})`
        )
      }
      if (/[<>]/.test(descValue)) {
        descErrors.push('description contains XML angle brackets (< >) — not allowed in frontmatter')
      }
      if (descErrors.length > 0) {
        for (const message of descErrors) {
          diagnostics.push({ severity: 'error', line: descLine, message, check: 'description-format' })
        }
      } else {
        score += WEIGHTS.descriptionFormat
        diagnostics.push({
          severity: 'pass',
          message: 'description is within the character limit and free of XML tags',
          check: 'description-format',
        })
      }
    }
  }

  // --- Check: SKILL.md line count (15 pts) ---
  if (lineCount > MAX_LINES) {
    diagnostics.push({
      severity: 'error',
      message: `SKILL.md is ${lineCount} lines — exceeds ${MAX_LINES} line limit`,
      check: 'line-count',
    })
  } else if (lineCount > WARN_LINES) {
    score += WEIGHTS.lineCount
    diagnostics.push({
      severity: 'warning',
      message: `SKILL.md is ${lineCount} lines — approaching ${MAX_LINES} line limit`,
      check: 'line-count',
    })
  } else {
    score += WEIGHTS.lineCount
    diagnostics.push({
      severity: 'pass',
      message: `SKILL.md line count OK (${lineCount} lines)`,
      check: 'line-count',
    })
  }

  // --- Check: allowed subdirectories (4 pts) ---
  const subDirResult = await checkSubdirectories(absPath)
  if (subDirResult.unknownDirs.length > 0) {
    for (const dir of subDirResult.unknownDirs) {
      diagnostics.push({
        severity: 'warning',
        message: `Unknown subdirectory "${dir}" — only scripts/, references/, assets/ are allowed`,
        check: 'allowed-subdirs',
      })
    }
    // Partial credit: deduct per unknown dir but don't go below 0
    const deduction = Math.min(WEIGHTS.allowedSubdirs, subDirResult.unknownDirs.length * 2)
    score += Math.max(0, WEIGHTS.allowedSubdirs - deduction)
  } else {
    score += WEIGHTS.allowedSubdirs
    diagnostics.push({
      severity: 'pass',
      message: 'Folder structure matches convention',
      check: 'allowed-subdirs',
    })
  }

  // --- Check: no README.md inside the skill folder (4 pts) ---
  if (subDirResult.hasReadme) {
    diagnostics.push({
      severity: 'warning',
      message: 'README.md should not be inside the skill folder — put docs in SKILL.md or references/',
      check: 'no-readme',
    })
  } else {
    score += WEIGHTS.noReadme
    diagnostics.push({
      severity: 'pass',
      message: 'No README.md inside the skill folder',
      check: 'no-readme',
    })
  }

  // --- Check: referenced resources exist (7 pts) ---
  const brokenRefs = await checkBrokenReferences(content, absPath, lines)
  if (brokenRefs.length > 0) {
    for (const ref of brokenRefs) {
      diagnostics.push({
        severity: 'error',
        line: ref.line,
        message: `references ${ref.ref} but ${ref.reason}`,
        check: 'referenced-resources',
      })
    }
  } else {
    score += WEIGHTS.referencedResourcesExist
    diagnostics.push({
      severity: 'pass',
      message: 'All referenced resources exist',
      check: 'referenced-resources',
    })
  }

  // --- Check: bundled resources in correct subdirs (5 pts) ---
  const misplacedFiles = await checkBundledResourceStructure(absPath)
  if (misplacedFiles.length > 0) {
    for (const f of misplacedFiles) {
      diagnostics.push({
        severity: 'warning',
        message: `File "${f}" appears to be misplaced — check it belongs in scripts/, references/, or assets/`,
        check: 'bundled-resources',
      })
    }
  } else {
    score += WEIGHTS.bundledResourcesCorrect
    diagnostics.push({
      severity: 'pass',
      message: 'Bundled resources in correct subdirectories',
      check: 'bundled-resources',
    })
  }

  score = Math.min(100, Math.max(0, Math.round(score)))

  return {
    skill: path.basename(absPath),
    score,
    diagnostics,
    specVersion: SPEC_VERSION,
    passCount: diagnostics.filter((d) => d.severity === 'pass').length,
    warnCount: diagnostics.filter((d) => d.severity === 'warning').length,
    errorCount: diagnostics.filter((d) => d.severity === 'error').length,
  }
}

// --- Helpers ---

function fatal(skillPath: string, message: string): ValidationResult {
  return {
    skill: path.basename(skillPath),
    score: 0,
    diagnostics: [{ severity: 'error', message, check: 'skill-exists' }],
    specVersion: SPEC_VERSION,
    passCount: 0,
    warnCount: 0,
    errorCount: 1,
  }
}

interface FrontmatterResult {
  frontmatter: SkillFrontmatter | null
  frontmatterEndLine: number
  parseError: string | null
}

function extractFrontmatter(content: string, lines: string[]): FrontmatterResult {
  if (!lines[0]?.trimEnd().startsWith('---')) {
    return { frontmatter: null, frontmatterEndLine: 0, parseError: 'Missing YAML frontmatter — file must start with ---' }
  }

  let endIndex = -1
  for (let i = 1; i < lines.length; i++) {
    if (lines[i].trimEnd() === '---') {
      endIndex = i
      break
    }
  }

  if (endIndex === -1) {
    return { frontmatter: null, frontmatterEndLine: 0, parseError: 'Unclosed YAML frontmatter — missing closing ---' }
  }

  const yamlContent = lines.slice(1, endIndex).join('\n')

  try {
    const doc = parseDocument(yamlContent)
    if (doc.errors.length > 0) {
      const err = doc.errors[0]
      return {
        frontmatter: null,
        frontmatterEndLine: endIndex,
        parseError: `YAML parse error: ${err.message}`,
      }
    }
    const fm = doc.toJS() as SkillFrontmatter
    return { frontmatter: fm, frontmatterEndLine: endIndex, parseError: null }
  } catch (e) {
    return {
      frontmatter: null,
      frontmatterEndLine: endIndex,
      parseError: `YAML parse error: ${e instanceof Error ? e.message : String(e)}`,
    }
  }
}

function findFieldLine(lines: string[], field: string, maxLine: number): number | undefined {
  for (let i = 0; i < Math.min(maxLine, lines.length); i++) {
    if (lines[i].trimStart().startsWith(`${field}:`)) {
      return i + 1 // 1-indexed
    }
  }
  return undefined
}

interface SubdirResult {
  unknownDirs: string[]
  hasReadme: boolean
}

async function checkSubdirectories(skillPath: string): Promise<SubdirResult> {
  const unknownDirs: string[] = []
  let hasReadme = false
  try {
    const entries = await readdir(skillPath, { withFileTypes: true })
    for (const entry of entries) {
      if (entry.isDirectory() && !ALLOWED_SUBDIRS.has(entry.name)) {
        unknownDirs.push(entry.name)
      } else if (entry.isFile() && entry.name.toLowerCase() === 'readme.md') {
        hasReadme = true
      }
    }
  } catch {
    // ignore readdir errors
  }
  return { unknownDirs, hasReadme }
}

interface BrokenRef {
  line: number
  ref: string
  reason: string
}

async function checkBrokenReferences(
  content: string,
  skillPath: string,
  lines: string[]
): Promise<BrokenRef[]> {
  const broken: BrokenRef[] = []
  // Detect three reference forms:
  //   1. Markdown link/image: [text](path) or ![alt](path) — capture stops at ), #, or
  //      whitespace, so titles ([t](path "title")) and #anchors are captured as path-only.
  //   2 & 3. Bare or inline-code path to a known dir: scripts/, references/, assets/ — a
  //      backtick counts as a boundary so inline-code refs (`references/api-patterns.md`) match.
  // Not handled (rare, absent from the spec's examples): dot-relative paths (./scripts/…)
  // and reference-style link definitions ([ref]: path).
  const refPattern = /!?\[[^\]]*\]\(\s*([^)#\s]+)|(?:^|[\s`])((?:scripts|references|assets)\/[^\s`)]+)/gm

  let match: RegExpExecArray | null
  while ((match = refPattern.exec(content)) !== null) {
    const ref = (match[1] ?? match[2])?.trim()
    if (!ref || ref.startsWith('http://') || ref.startsWith('https://')) continue

    const refPath = path.resolve(skillPath, ref)
    try {
      await stat(refPath)
    } catch {
      // Find line number
      const lineIndex = findLineNumber(lines, match.index, content)
      broken.push({
        line: lineIndex,
        ref,
        reason: `${ref} not found`,
      })
    }
  }
  return broken
}

function findLineNumber(lines: string[], charIndex: number, _content: string): number {
  let count = 0
  for (let i = 0; i < lines.length; i++) {
    count += lines[i].length + 1 // +1 for \n
    if (count > charIndex) return i + 1
  }
  return lines.length
}

async function checkBundledResourceStructure(skillPath: string): Promise<string[]> {
  const misplaced: string[] = []
  // Check for executable-looking files in references/ (should be in scripts/)
  // Check for .md files in scripts/ (should be in references/)
  const checks: Array<{ dir: string; badExtensions: string[]; reason: string }> = [
    { dir: 'scripts', badExtensions: ['.md', '.txt', '.pdf'], reason: 'docs should go in references/' },
    { dir: 'references', badExtensions: ['.sh', '.py', '.js', '.ts', '.rb'], reason: 'scripts should go in scripts/' },
  ]

  for (const check of checks) {
    const dirPath = path.join(skillPath, check.dir)
    try {
      const entries = await readdir(dirPath)
      for (const entry of entries) {
        const ext = path.extname(entry).toLowerCase()
        if (check.badExtensions.includes(ext)) {
          misplaced.push(`${check.dir}/${entry} (${check.reason})`)
        }
      }
    } catch {
      // Directory doesn't exist, that's fine
    }
  }
  return misplaced
}
