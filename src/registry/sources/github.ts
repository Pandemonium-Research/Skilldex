import { mkdtemp, rm, readdir, stat } from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { simpleGit } from 'simple-git'
import type { ScopeConfig } from '../../types/scope.js'
import type { InstallOptions, InstallResult } from '../../core/installer.js'
import { installFromPath } from '../../core/installer.js'

export interface ParsedGitUrl {
  repoUrl: string
  branch?: string
  subPath?: string
}

export function parseGitUrl(raw: string): ParsedGitUrl {
  // Remove git+ prefix
  let url = raw.replace(/^git\+/, '')

  // Handle tree/branch/path syntax: https://github.com/user/repo/tree/branch/path
  const treeMatch = url.match(/^(https?:\/\/[^/]+\/[^/]+\/[^/]+)\/tree\/([^/]+)(\/.*)?$/)
  if (treeMatch) {
    return {
      repoUrl: treeMatch[1],
      branch: treeMatch[2],
      subPath: treeMatch[3]?.replace(/^\//, ''),
    }
  }

  return { repoUrl: url }
}

export async function installFromGitUrl(
  rawUrl: string,
  targetScopeConfig: ScopeConfig,
  options: InstallOptions
): Promise<InstallResult> {
  const parsed = parseGitUrl(rawUrl)
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
      return installFromPath(skillFolders[0], { ...options, sourceUrl: rawUrl })
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
    return installFromPath(selectedFolder, { ...options, sourceUrl: rawUrl })
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
