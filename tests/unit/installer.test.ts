import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mkdtemp, rm, writeFile, mkdir } from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const fixturesDir = path.join(__dirname, '..', 'fixtures')

let tmpDir: string

beforeEach(async () => {
  tmpDir = await mkdtemp(path.join(os.tmpdir(), 'skilldex-installer-test-'))
})

afterEach(async () => {
  await rm(tmpDir, { recursive: true, force: true })
  vi.restoreAllMocks()
})

describe('installFromPath', () => {
  it('installs a valid skill to the specified scope directory', async () => {
    // We mock the resolver to use our tmpDir as the project root
    vi.mock('../../src/core/resolver.js', async (importOriginal) => {
      const actual = await importOriginal<typeof import('../../src/core/resolver.js')>()
      return {
        ...actual,
        resolveScope: async (level: string) => ({
          level,
          rootPath: path.join(tmpDir, level),
          manifestPath: path.join(tmpDir, level, 'skilldex.json'),
          skillsDir: path.join(tmpDir, level, 'skills'),
        }),
        resolveAllScopes: async () => [],
        findProjectRoot: actual.findProjectRoot,
      }
    })

    const { installFromPath } = await import('../../src/core/installer.js')
    const result = await installFromPath(path.join(fixturesDir, 'valid-skill'), {
      scope: 'project',
    })

    expect(result.skillName).toBe('valid-skill')
    expect(result.scope).toBe('project')
    expect(result.validation.score).toBeGreaterThan(0)
  })

  it('throws if skill already installed and no --force', async () => {
    vi.mock('../../src/core/resolver.js', async (importOriginal) => {
      const actual = await importOriginal<typeof import('../../src/core/resolver.js')>()
      return {
        ...actual,
        resolveScope: async (level: string) => ({
          level,
          rootPath: path.join(tmpDir, level),
          manifestPath: path.join(tmpDir, level, 'skilldex.json'),
          skillsDir: path.join(tmpDir, level, 'skills'),
        }),
        resolveAllScopes: async () => [],
        findProjectRoot: actual.findProjectRoot,
      }
    })

    const { installFromPath } = await import('../../src/core/installer.js')
    await installFromPath(path.join(fixturesDir, 'valid-skill'), { scope: 'project' })
    await expect(
      installFromPath(path.join(fixturesDir, 'valid-skill'), { scope: 'project' })
    ).rejects.toThrow(/already installed/)
  })
})
