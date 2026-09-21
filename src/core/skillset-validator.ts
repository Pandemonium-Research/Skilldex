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
const SKILL_MD = 'SKILL.md'

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

  // An installed skillset holds only SKILLSET.md and assets/: `skillset install` puts the members in
  // <root>/skills/<name> and records them in the manifest. Validating it as it sits on disk would find no
  // members — losing the points for having any, and passing coherence having compared nothing (A17). The
  // manifest says which skills are its members and where they are, so read them from there.
  const memberDirs = await installedMemberDirs(absPath)
  const files = [
    ...(await listFiles(absPath)),
    ...(await Promise.all(
      Object.entries(memberDirs).map(async ([name, dir]) =>
        (await listFiles(dir)).map((f) => `${name}/${f}`)
      )
    )).flat(),
  ]

  const result = validateSkillsetContent({
    skillsetMd,
    files,
    name: path.basename(absPath),
  })

  // Unconditionally, including for a memberless skillset: the check still reports what the shared
  // assets declare, and short-circuiting here would make that depend on whether anyone had added a
  // member yet.
  return {
    ...result,
    coherence: await checkSkillsetCoherence(absPath, result.embeddedSkills, memberDirs),
  }
}

/**
 * Where an installed skillset's members really are, from the manifest, or `{}` for a source directory.
 *
 * Recognised by layout: `<root>/skillsets/<name>` beside a `<root>/skilldex.json` that lists the skillset.
 * Each member is taken from its own manifest entry's path, falling back to `skills/<name>`, and only if it
 * has a SKILL.md — a member uninstalled by hand is simply missing, which the checks should then say.
 */
async function installedMemberDirs(absPath: string): Promise<Record<string, string>> {
  if (path.basename(path.dirname(absPath)) !== 'skillsets') return {}
  const root = path.dirname(path.dirname(absPath))

  let manifest: {
    skills?: Record<string, { path?: string }>
    skillsets?: Record<string, { embeddedSkills?: string[] }>
  }
  try {
    manifest = JSON.parse(await readFile(path.join(root, 'skilldex.json'), 'utf8'))
  } catch {
    return {}
  }

  const entry = manifest.skillsets?.[path.basename(absPath)]
  if (!entry?.embeddedSkills?.length) return {}

  const dirs: Record<string, string> = {}
  for (const name of entry.embeddedSkills) {
    const rel = manifest.skills?.[name]?.path ?? path.join('skills', name)
    const dir = path.resolve(root, rel)
    try {
      await stat(path.join(dir, SKILL_MD))
      dirs[name] = dir
    } catch {
      // not installed any more; leave it out and let the member checks report it
    }
  }
  return dirs
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
