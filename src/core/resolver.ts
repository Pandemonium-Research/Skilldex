import { stat, readdir } from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import type { ScopeLevel, ScopeConfig } from '../types/scope.js'

const SKILLDEX_DIR = '.skilldex'
const MANIFEST_FILE = 'skilldex.json'
const SKILLS_DIR = 'skills'

function globalBase(): string {
  return path.join(os.homedir(), '.skilldex', 'global')
}

function sharedBase(): string {
  return path.join(os.homedir(), '.skilldex', 'shared')
}

function makeScopeConfig(level: ScopeLevel, rootPath: string): ScopeConfig {
  return {
    level,
    rootPath,
    manifestPath: path.join(rootPath, MANIFEST_FILE),
    skillsDir: path.join(rootPath, SKILLS_DIR),
  }
}

export async function resolveScope(level: ScopeLevel, cwd?: string): Promise<ScopeConfig> {
  switch (level) {
    case 'global':
      return makeScopeConfig('global', globalBase())
    case 'shared':
      return makeScopeConfig('shared', sharedBase())
    case 'project': {
      const projectRoot = await findProjectRoot(cwd ?? process.cwd())
      return makeScopeConfig('project', path.join(projectRoot, SKILLDEX_DIR))
    }
  }
}

export async function resolveAllScopes(cwd?: string): Promise<ScopeConfig[]> {
  return Promise.all([
    resolveScope('global', cwd),
    resolveScope('shared', cwd),
    resolveScope('project', cwd),
  ])
}

export async function findProjectRoot(cwd: string): Promise<string> {
  let current = path.resolve(cwd)
  const root = path.parse(current).root

  while (true) {
    // Check for git root
    try {
      await stat(path.join(current, '.git'))
      return current
    } catch {
      // not a git root
    }

    // Check for package.json (also a project root indicator)
    try {
      await stat(path.join(current, 'package.json'))
      return current
    } catch {
      // not a package.json root
    }

    const parent = path.dirname(current)
    if (parent === current || current === root) {
      // Reached filesystem root — use cwd as fallback
      return path.resolve(cwd)
    }
    current = parent
  }
}
