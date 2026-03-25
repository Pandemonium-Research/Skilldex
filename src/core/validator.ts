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

// Scoring weights
const WEIGHTS = {
  frontmatterParseable: 25,
  namePresent: 10,
  descriptionPresent: 10,
  descriptionLength: 10,
  lineCount: 15,
  allowedSubdirs: 10,
  referencedResourcesExist: 15,
  bundledResourcesCorrect: 5,
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

    // --- Check: name present (10 pts) ---
    if (!frontmatter.name || String(frontmatter.name).trim() === '') {
      diagnostics.push({
        severity: 'error',
        line: findFieldLine(lines, 'name', frontmatterEndLine),
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
    }

    // --- Check: description present + length (20 pts total) ---
    if (!frontmatter.description || String(frontmatter.description).trim() === '') {
      diagnostics.push({
        severity: 'error',
        line: findFieldLine(lines, 'description', frontmatterEndLine),
        message: 'Required field "description" is missing or empty',
        check: 'description-length',
      })
    } else {
      score += WEIGHTS.descriptionPresent
      const wordCount = String(frontmatter.description).trim().split(/\s+/).length
      if (wordCount < MIN_DESCRIPTION_WORDS) {
        diagnostics.push({
          severity: 'error',
          line: findFieldLine(lines, 'description', frontmatterEndLine),
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

  // --- Check: allowed subdirectories (10 pts) ---
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
    const deduction = Math.min(WEIGHTS.allowedSubdirs, subDirResult.unknownDirs.length * 3)
    score += Math.max(0, WEIGHTS.allowedSubdirs - deduction)
  } else {
    score += WEIGHTS.allowedSubdirs
    diagnostics.push({
      severity: 'pass',
      message: 'Folder structure matches convention',
      check: 'allowed-subdirs',
    })
  }

  // --- Check: referenced resources exist (15 pts) ---
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
}

async function checkSubdirectories(skillPath: string): Promise<SubdirResult> {
  const unknownDirs: string[] = []
  try {
    const entries = await readdir(skillPath, { withFileTypes: true })
    for (const entry of entries) {
      if (entry.isDirectory() && !ALLOWED_SUBDIRS.has(entry.name)) {
        unknownDirs.push(entry.name)
      }
    }
  } catch {
    // ignore readdir errors
  }
  return { unknownDirs }
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
  // Match markdown links, image refs, and plain relative paths referencing known dirs
  const refPattern = /(?:(?:\[.*?\]\()|(?:!\[.*?\]\())([^)#\s]+)\)|(?:^|\s)((?:scripts|references|assets)\/[^\s)]+)/gm

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

function findLineNumber(lines: string[], charIndex: number, content: string): number {
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
