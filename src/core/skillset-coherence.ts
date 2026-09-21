import { readFile, readdir } from 'node:fs/promises'
import path from 'node:path'
import {
  checkSkillsetCoherence as checkCoherence,
  type CoherenceSource,
  type SkillsetCoherenceResult,
} from '@skilldex/validator'

/**
 * Coherence, backed by the working tree.
 *
 * The checks themselves are `@skilldex/validator`, shared with the registry, which reads the same
 * skillset as fetched GitHub blobs instead. They used to be two implementations that had to be
 * diffed function by function to stay equal; now the only thing that differs between the two
 * surfaces is where the bytes come from, which is all this file supplies.
 */

export {
  parseDeclaredConventions,
  extractAssetReferences,
  parseMarkdownTables,
} from '@skilldex/validator'

export type {
  AssetReference,
  CoherenceCheck,
  CoherenceDiagnostic,
  CoherenceSource,
  DeclaredConvention,
  MarkdownTable,
  SkillsetCoherenceResult,
} from '@skilldex/validator'

export async function checkSkillsetCoherence(
  skillsetPath: string,
  embeddedSkills: string[],
  memberDirs: Record<string, string> = {}
): Promise<SkillsetCoherenceResult> {
  return checkCoherence(await workingTreeSource(path.resolve(skillsetPath), memberDirs), embeddedSkills)
}

/**
 * A CoherenceSource over a directory.
 *
 * The listing is read once, up front — the interface asks for it synchronously, and a listing that
 * changed halfway through would make the result depend on the order the checks happened to run in.
 * Reads are memoized: collecting declared conventions and hunting undeclared ones both walk every
 * shared asset.
 *
 * `memberDirs` maps a member's name to where its files actually live. An *installed* skillset keeps
 * its members in `<root>/skills/<name>` rather than inside itself, so without this the coherence check
 * would be handed a skillset with no members and pass having compared nothing (A17).
 */
async function workingTreeSource(
  root: string,
  memberDirs: Record<string, string> = {}
): Promise<CoherenceSource> {
  const own = await listFiles(root)
  const external = await Promise.all(
    Object.entries(memberDirs).map(async ([name, dir]) =>
      (await listFiles(dir)).map((f) => `${name}/${f}`)
    )
  )
  const files = [...own, ...external.flat()]
  const cache = new Map<string, string | null>()

  const resolve = (relPath: string): string => {
    const [head, ...rest] = relPath.split('/')
    const dir = memberDirs[head]
    return dir && rest.length > 0 ? path.join(dir, ...rest) : path.join(root, ...relPath.split('/'))
  }

  return {
    listFiles: () => files,
    async readFile(relPath: string): Promise<string | null> {
      const hit = cache.get(relPath)
      if (hit !== undefined) return hit

      let content: string | null
      try {
        content = await readFile(resolve(relPath), 'utf8')
      } catch {
        content = null
      }
      cache.set(relPath, content)
      return content
    },
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
