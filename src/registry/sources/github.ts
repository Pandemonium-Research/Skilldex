import { mkdtemp, rm, readdir, stat } from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { simpleGit } from 'simple-git'
import type { InstallOptions, InstallResult } from '../../core/installer.js'
import { installFromPath } from '../../core/installer.js'

export interface ParsedGitUrl {
  repoUrl: string
  branch?: string
  subPath?: string
}

/**
 * A source URL with exactly one `git+` prefix, however many it arrived with.
 *
 * Every git install records the URL it was given, and callers add `git+` to what they read back:
 * `skillpm update` built `git+git+https://…` from a manifest that already held `git+https://…`,
 * git cannot clone that scheme, and every registry or GitHub install failed to update. Normalising
 * here repairs manifests that already hold the doubled form and stops it growing on each update.
 */
export function toGitSource(raw: string): string {
  return `git+${raw.replace(/^(?:git\+)+/, '')}`
}

export function parseGitUrl(raw: string): ParsedGitUrl {
  // Remove every git+ prefix — a doubled one reaches here from `update` (see toGitSource)
  const url = raw.replace(/^(?:git\+)+/, '')

  // Handle tree/branch/path syntax: https://github.com/user/repo/tree/branch/path
  const treeMatch = url.match(/^(https?:\/\/[^/]+\/[^/]+\/[^/]+)\/tree\/([^/]+)(\/.*)?$/)
  if (treeMatch) {
    return {
      repoUrl: treeMatch[1],
      // `HEAD` names the repository's default branch, and it is how the registry records every skill
      // imported from the GitSkills corpus — 1.61M of its rows (Skilldex-registry D14: the dataset
      // carries no default branch, and `main` would 404 on every master-default repository). git
      // takes HEAD as a ref almost everywhere, but not as `clone --branch`, which fails with "Remote
      // branch HEAD not found": no imported skill could be installed. Leaving the branch unset clones
      // the default branch, which is what HEAD means. Every clone site reads the branch from here.
      branch: treeMatch[2] === 'HEAD' ? undefined : treeMatch[2],
      subPath: treeMatch[3]?.replace(/^\//, ''),
    }
  }

  return { repoUrl: url }
}

export async function installFromGitUrl(
  rawUrl: string,
  options: InstallOptions
): Promise<InstallResult> {
  const parsed = parseGitUrl(rawUrl)
  const sourceUrl = toGitSource(rawUrl)
  const tmpDir = await mkdtemp(path.join(os.tmpdir(), 'skilldex-'))

  try {
    const git = simpleGit()
    const cloneOptions = parsed.branch ? ['--branch', parsed.branch, '--depth', '1'] : ['--depth', '1']
    await git.clone(parsed.repoUrl, tmpDir, cloneOptions)

    const searchRoot = parsed.subPath ? path.join(tmpDir, parsed.subPath) : tmpDir

    // Find skill folders (directories containing SKILL.md)
    const skillFolders = await findSkillFolders(searchRoot)

    if (skillFolders.length === 0) {
      throw new Error(`No skill folders (directories with SKILL.md) found in ${rawUrl}`)
    }

    // If exactly one skill found, install it directly
    if (skillFolders.length === 1) {
      // `await` is load-bearing: `finally` below removes the clone, and a bare `return` of the
      // promise lets that cleanup run before the copy has finished reading from it.
      return await installFromPath(skillFolders[0], { ...options, sourceUrl })
    }

    // Multiple skills found — prompt if interactive callback provided, else pick first
    const names = skillFolders.map(f => path.basename(f))
    let selectedName: string
    if (options.onMultipleSkills) {
      selectedName = await options.onMultipleSkills(names)
    } else {
      selectedName = names[0]
    }
    const selectedFolder = skillFolders.find(f => path.basename(f) === selectedName) ?? skillFolders[0]
    return await installFromPath(selectedFolder, { ...options, sourceUrl })
  } finally {
    await rm(tmpDir, { recursive: true, force: true })
  }
}

async function findSkillFolders(root: string): Promise<string[]> {
  const results: string[] = []

  // Check if root itself is a skill folder
  try {
    await stat(path.join(root, 'SKILL.md'))
    results.push(root)
    return results
  } catch {
    // root is not a skill folder itself — search children
  }

  try {
    const entries = await readdir(root, { withFileTypes: true })
    for (const entry of entries) {
      if (!entry.isDirectory()) continue
      if (entry.name.startsWith('.')) continue

      const childPath = path.join(root, entry.name)
      try {
        await stat(path.join(childPath, 'SKILL.md'))
        results.push(childPath)
      } catch {
        // not a skill folder
      }
    }
  } catch {
    // Can't read directory
  }

  return results
}
