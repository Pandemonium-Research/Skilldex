import { describe, it, expect } from 'vitest'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { findProjectRoot, resolveScope } from '../../src/core/resolver.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
// The repo root has a .git directory, so walking up from tests/ should land there
const repoRoot = path.resolve(__dirname, '..', '..')

describe('findProjectRoot', () => {
  it('finds the git root from a subdirectory', async () => {
    const root = await findProjectRoot(__dirname)
    expect(root).toBe(repoRoot)
  })

  it('returns cwd when no git root is found', async () => {
    const root = await findProjectRoot(path.parse(__dirname).root)
    // Should not throw — returns the filesystem root or itself
    expect(typeof root).toBe('string')
  })
})

describe('resolveScope', () => {
  it('returns a config with correct level for global', async () => {
    const sc = await resolveScope('global')
    expect(sc.level).toBe('global')
    expect(sc.manifestPath).toMatch(/skilldex\.json$/)
    expect(sc.skillsDir).toMatch(/skills$/)
  })

  it('returns a config with correct level for shared', async () => {
    const sc = await resolveScope('shared')
    expect(sc.level).toBe('shared')
  })

  it('returns a project scope config rooted at project .skilldex dir', async () => {
    const sc = await resolveScope('project', __dirname)
    expect(sc.level).toBe('project')
    expect(sc.rootPath).toMatch(/\.skilldex$/)
  })
})
