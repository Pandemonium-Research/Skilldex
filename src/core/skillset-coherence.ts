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
  embeddedSkills: string[]
): Promise<SkillsetCoherenceResult> {
  return checkCoherence(await workingTreeSource(path.resolve(skillsetPath)), embeddedSkills)
}

/**
 * A CoherenceSource over a directory.
 *
 * The listing is read once, up front — the interface asks for it synchronously, and a listing that
 * changed halfway through would make the result depend on the order the checks happened to run in.
 * Reads are memoized: collecting declared conventions and hunting undeclared ones both walk every
 * shared asset.
 */
async function workingTreeSource(root: string): Promise<CoherenceSource> {
  const files = await listFiles(root)
  const cache = new Map<string, string | null>()

  return {
    listFiles: () => files,
    async readFile(relPath: string): Promise<string | null> {
      const hit = cache.get(relPath)
      if (hit !== undefined) return hit

      let content: string | null
      try {
        content = await readFile(path.join(root, ...relPath.split('/')), 'utf8')
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
