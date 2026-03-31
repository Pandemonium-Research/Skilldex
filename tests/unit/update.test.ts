import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mkdtemp, rm, mkdir } from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import type { InstalledSkill } from '../../src/types/manifest.js'
import type { ScopeConfig } from '../../src/types/scope.js'

// Hoisted so vi.mock factories can reference them
const mocks = vi.hoisted(() => ({
  installFromGitUrl: vi.fn(),
  resolveScope: vi.fn(),
}))

vi.mock('../../src/registry/sources/github.js', () => ({
  installFromGitUrl: mocks.installFromGitUrl,
}))

vi.mock('../../src/core/resolver.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/core/resolver.js')>()
  return { ...actual, resolveScope: mocks.resolveScope }
})

let tmpDir: string

beforeEach(async () => {
  tmpDir = await mkdtemp(path.join(os.tmpdir(), 'skilldex-update-test-'))
  vi.resetModules()
  mocks.installFromGitUrl.mockReset()
  mocks.resolveScope.mockReset()
})

afterEach(async () => {
  await rm(tmpDir, { recursive: true, force: true })
  vi.restoreAllMocks()
})

function makeScopeConfig(level: 'global' | 'shared' | 'project'): ScopeConfig {
  return {
    level,
    rootPath: path.join(tmpDir, level),
    manifestPath: path.join(tmpDir, level, 'skilldex.json'),
    skillsDir: path.join(tmpDir, level, 'skills'),
    skillsetsDir: path.join(tmpDir, level, 'skillsets'),
  }
}

function makeSkill(overrides: Partial<InstalledSkill> = {}): InstalledSkill {
  return {
    name: 'test-skill',
    version: '1.0.0',
    source: 'community',
    sourceUrl: 'https://github.com/user/test-skill',
    installedAt: new Date().toISOString(),
    specVersion: '1.0',
    score: 85,
    path: 'skills/test-skill',
    ...overrides,
  }
}

async function setupManifestWithSkill(skill: InstalledSkill) {
  const scopeConfig = makeScopeConfig('project')
  await mkdir(scopeConfig.rootPath, { recursive: true })
  const { writeManifest, createEmptyManifest } = await import('../../src/core/manifest.js')
  const manifest = createEmptyManifest('project')
  manifest.skills[skill.name] = skill
  await writeManifest(scopeConfig, manifest)
  return scopeConfig
}

describe('runUpdate', () => {
  it('re-installs a skill that has a sourceUrl', async () => {
    const skill = makeSkill()
    const scopeConfig = await setupManifestWithSkill(skill)

    mocks.resolveScope.mockResolvedValue(scopeConfig)
    mocks.installFromGitUrl.mockResolvedValue({
      skillName: skill.name,
      scope: 'project',
      installedPath: path.join(tmpDir, 'project', 'skills', skill.name),
      validation: { score: 90, skill: skill.name, specVersion: '1.0', diagnostics: [], errorCount: 0, warnCount: 0 },
      alreadyExisted: true,
    })

    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
    const consoleErr = vi.spyOn(console, 'error').mockImplementation(() => {})

    const { runUpdate } = await import('../../src/cli/commands/update-action.js')
    await runUpdate(skill.name, { scope: 'project', all: false, json: true })

    expect(mocks.installFromGitUrl).toHaveBeenCalledWith(
      `git+${skill.sourceUrl}`,
      expect.objectContaining({ level: 'project' }),
      expect.objectContaining({ force: true, sourceUrl: skill.sourceUrl })
    )

    consoleSpy.mockRestore()
    consoleErr.mockRestore()
  })

  it('skips a skill without a sourceUrl', async () => {
    const skill = makeSkill({ source: 'local', sourceUrl: undefined })
    const scopeConfig = await setupManifestWithSkill(skill)

    mocks.resolveScope.mockResolvedValue(scopeConfig)

    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
    const consoleErr = vi.spyOn(console, 'error').mockImplementation(() => {})

    const { runUpdate } = await import('../../src/cli/commands/update-action.js')
    await runUpdate(skill.name, { scope: 'project', all: false, json: true })

    expect(mocks.installFromGitUrl).not.toHaveBeenCalled()

    consoleSpy.mockRestore()
    consoleErr.mockRestore()
  })

  it('exits with error when skill name not found in scope', async () => {
    const skill = makeSkill()
    const scopeConfig = await setupManifestWithSkill(skill)

    mocks.resolveScope.mockResolvedValue(scopeConfig)

    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
    const consoleErr = vi.spyOn(console, 'error').mockImplementation(() => {})
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => { throw new Error('process.exit') }) as () => never)

    const { runUpdate } = await import('../../src/cli/commands/update-action.js')
    await expect(
      runUpdate('nonexistent-skill', { scope: 'project', all: false, json: true })
    ).rejects.toThrow('process.exit')

    exitSpy.mockRestore()
    consoleSpy.mockRestore()
    consoleErr.mockRestore()
  })
})
