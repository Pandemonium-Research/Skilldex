import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { parseGitUrl } from '../../src/registry/sources/github.js'
import { mkdtemp, mkdir, writeFile, rm, cp } from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'

// Hoisted so the vi.mock factory can reference them
const mocks = vi.hoisted(() => ({
  cloneFn: vi.fn(),
  installFromPath: vi.fn(),
}))

vi.mock('simple-git', () => ({
  simpleGit: () => ({ clone: mocks.cloneFn }),
}))

vi.mock('../../src/core/installer.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/core/installer.js')>()
  return { ...actual, installFromPath: mocks.installFromPath }
})

// parseGitUrl is pure — no mocking needed
describe('parseGitUrl', () => {
  it('strips git+ prefix', () => {
    const result = parseGitUrl('git+https://github.com/user/repo')
    expect(result.repoUrl).toBe('https://github.com/user/repo')
    expect(result.branch).toBeUndefined()
    expect(result.subPath).toBeUndefined()
  })

  it('parses tree/branch/subpath syntax', () => {
    const result = parseGitUrl('git+https://github.com/user/repo/tree/main/my-skill')
    expect(result.repoUrl).toBe('https://github.com/user/repo')
    expect(result.branch).toBe('main')
    expect(result.subPath).toBe('my-skill')
  })

  it('parses tree/branch without subpath', () => {
    const result = parseGitUrl('git+https://github.com/user/repo/tree/feature-branch')
    expect(result.repoUrl).toBe('https://github.com/user/repo')
    expect(result.branch).toBe('feature-branch')
    expect(result.subPath).toBeUndefined()
  })

  it('handles URL without git+ prefix', () => {
    const result = parseGitUrl('https://github.com/user/repo')
    expect(result.repoUrl).toBe('https://github.com/user/repo')
  })
})

// installFromGitUrl multi-skill onMultipleSkills callback
describe('installFromGitUrl — onMultipleSkills callback', () => {
  let fakeRepo: string
  let tmpScope: string

  beforeEach(async () => {
    fakeRepo = await mkdtemp(path.join(os.tmpdir(), 'skilldex-github-test-'))
    tmpScope = await mkdtemp(path.join(os.tmpdir(), 'skilldex-scope-'))

    // Build a fake repo with two skill folders
    await mkdir(path.join(fakeRepo, 'skill-a'))
    await writeFile(path.join(fakeRepo, 'skill-a', 'SKILL.md'), '---\nname: skill-a\ndescription: ' + 'a'.repeat(40) + '\n---\n')
    await mkdir(path.join(fakeRepo, 'skill-b'))
    await writeFile(path.join(fakeRepo, 'skill-b', 'SKILL.md'), '---\nname: skill-b\ndescription: ' + 'b'.repeat(40) + '\n---\n')

    // clone mock: copy fakeRepo into dest
    mocks.cloneFn.mockImplementation(async (_url: string, dest: string) => {
      await cp(fakeRepo, dest, { recursive: true })
    })

    mocks.installFromPath.mockResolvedValue({
      skillName: 'skill-a',
      scope: 'project',
      installedPath: path.join(tmpScope, 'skills', 'skill-a'),
      validation: { score: 80, skill: 'skill-a', specVersion: '1.0', diagnostics: [], errorCount: 0, warnCount: 0 },
      alreadyExisted: false,
    })
  })

  afterEach(async () => {
    await rm(fakeRepo, { recursive: true, force: true })
    await rm(tmpScope, { recursive: true, force: true })
    mocks.cloneFn.mockReset()
    mocks.installFromPath.mockReset()
  })

  it('calls onMultipleSkills with all found skill folder names', async () => {
    const { installFromGitUrl } = await import('../../src/registry/sources/github.js')

    const scopeConfig = {
      level: 'project' as const,
      rootPath: tmpScope,
      manifestPath: path.join(tmpScope, 'skilldex.json'),
      skillsDir: path.join(tmpScope, 'skills'),
      skillsetsDir: path.join(tmpScope, 'skillsets'),
    }

    const onMultipleSkills = vi.fn(async (names: string[]) => names[0])

    await installFromGitUrl('git+https://github.com/user/repo', scopeConfig, {
      scope: 'project',
      onMultipleSkills,
    })

    expect(onMultipleSkills).toHaveBeenCalledOnce()
    const [names] = onMultipleSkills.mock.calls[0]
    expect(names).toContain('skill-a')
    expect(names).toContain('skill-b')
  })

  it('auto-selects first skill when no onMultipleSkills callback provided', async () => {
    const { installFromGitUrl } = await import('../../src/registry/sources/github.js')

    const scopeConfig = {
      level: 'project' as const,
      rootPath: tmpScope,
      manifestPath: path.join(tmpScope, 'skilldex.json'),
      skillsDir: path.join(tmpScope, 'skills'),
      skillsetsDir: path.join(tmpScope, 'skillsets'),
    }

    await installFromGitUrl('git+https://github.com/user/repo', scopeConfig, {
      scope: 'project',
      // no onMultipleSkills
    })

    expect(mocks.installFromPath).toHaveBeenCalledOnce()
    const calledPath: string = mocks.installFromPath.mock.calls[0][0]
    // Should have picked one of the two skill folders (first found)
    expect(calledPath).toMatch(/skill-[ab]/)
  })
})
