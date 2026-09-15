import { readFile, stat, readdir } from 'node:fs/promises'
import path from 'node:path'
import {
  SPEC_VERSION,
  skillNameErrors,
  validateSkill as validateSkillContent,
} from '@skilldex/validator'
import type { ValidationResult, ValidationDiagnostic } from '../types/skill.js'

/**
 * `skillpm validate` — the filesystem half of validation.
 *
 * The rubric itself is `@skilldex/validator`, shared with the registry. It was two
 * implementations until 2026-09-15: this one, and a hand-maintained mirror in the registry that
 * had drifted from it in four places, so the same skill scored differently depending on whether
 * its author ran `skillpm validate` or the registry scored it on publish. Nothing about the rules
 * lives here any more. What lives here is everything the registry cannot do: find the folder, read
 * SKILL.md, and list the files.
 */

export const SKILL_SPEC_VERSION = SPEC_VERSION
export { SPEC_VERSION, skillNameErrors }

const SKILL_MD = 'SKILL.md'

export async function validateSkill(skillPath: string): Promise<ValidationResult> {
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
  let skillMd: string
  try {
    skillMd = await readFile(path.join(absPath, SKILL_MD), 'utf8')
  } catch {
    return fatal(skillPath, `SKILL.md not found in ${absPath}`)
  }

  return validateSkillContent({
    skillMd,
    files: await listFiles(absPath),
    name: path.basename(absPath),
  })
}

/**
 * Every file in the skill folder, as POSIX paths relative to it.
 *
 * Dot-directories are walked rather than skipped: the rubric decides what to do with `.github/`,
 * and it is not this function's business to hide it. Unreadable directories are skipped, which is
 * the same thing the old readdir-per-check code did by swallowing its errors.
 */
async function listFiles(root: string, dir: string = root): Promise<string[]> {
  let entries
  try {
    entries = await readdir(dir, { withFileTypes: true })
  } catch {
    return []
  }

  const files: string[] = []
  for (const entry of entries) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      files.push(...(await listFiles(root, full)))
    } else {
      files.push(path.relative(root, full).split(path.sep).join('/'))
    }
  }
  return files
}

function fatal(skillPath: string, message: string): ValidationResult {
  const diagnostics: ValidationDiagnostic[] = [{ severity: 'error', message, check: 'skill-exists' }]
  return {
    skill: path.basename(skillPath),
    score: 0,
    diagnostics,
    specVersion: SPEC_VERSION,
    passCount: 0,
    warnCount: 0,
    errorCount: 1,
    // `skill-exists` is not a weighted check, so a caller reading the breakdown sees every row as
    // not evaluated rather than failed. The rubric owns that list, so an empty breakdown here
    // would be a second opinion about which checks exist; ask it instead.
    breakdown: validateSkillContent({ skillMd: '', files: [] }).breakdown.map((c) => ({
      ...c,
      earned: 0,
      status: 'skipped' as const,
    })),
  }
}
