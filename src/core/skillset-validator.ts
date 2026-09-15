import { readFile, readdir, stat } from 'node:fs/promises'
import path from 'node:path'
import {
  SKILLSET_SPEC_VERSION,
  validateSkillset as validateSkillsetContent,
} from '@skilldex/validator'
import type { SkillsetValidationResult, SkillsetCoherenceResult } from '../types/skillset.js'
import { checkSkillsetCoherence } from './skillset-coherence.js'

/**
 * `skillpm skillset validate` — the filesystem half.
 *
 * The rubric is `@skilldex/validator`, shared with the registry. What is left here is finding the
 * skillset, reading SKILLSET.md, listing the files, and attaching coherence — which is reported as
 * an independent dimension and deliberately does not move `score`. Structural conformance answers
 * "is this skillset well-formed"; coherence answers "do its members agree with each other". Folding
 * the second into the first would let a high aggregate hide a contradiction, which is the failure
 * mode the split exists to prevent.
 */

export { SKILLSET_SPEC_VERSION }

const SKILLSET_MD = 'SKILLSET.md'

export async function validateSkillset(skillsetPath: string): Promise<SkillsetValidationResult> {
  const absPath = path.resolve(skillsetPath)

  try {
    const s = await stat(absPath)
    if (!s.isDirectory()) {
      return fatal(skillsetPath, `Path is not a directory: ${absPath}`)
    }
  } catch {
    return fatal(skillsetPath, `Path does not exist: ${absPath}`)
  }

  let skillsetMd: string
  try {
    skillsetMd = await readFile(path.join(absPath, SKILLSET_MD), 'utf8')
  } catch {
    return fatal(skillsetPath, `SKILLSET.md not found in ${absPath}`)
  }

  const result = validateSkillsetContent({
    skillsetMd,
    files: await listFiles(absPath),
    name: path.basename(absPath),
  })

  // Unconditionally, including for a memberless skillset: the check still reports what the shared
  // assets declare, and short-circuiting here would make that depend on whether anyone had added a
  // member yet.
  return { ...result, coherence: await checkSkillsetCoherence(absPath, result.embeddedSkills) }
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
    coherence: emptyCoherence(),
  }
}

/** Nothing to check when the skillset has no members to disagree with each other. */
function emptyCoherence(): SkillsetCoherenceResult {
  return {
    declaredConventions: [],
    diagnostics: [],
    membersChecked: 0,
    membersCoherent: 0,
    passCount: 0,
    warnCount: 0,
    errorCount: 0,
  }
}

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
