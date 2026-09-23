import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mkdtemp, mkdir, writeFile, rm, readFile, realpath, lstat } from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { installSkillsetFromPath, uninstallSkillset } from '../../src/core/skillset-installer.js'

// A skillset's members reach its shared conventions as `../assets/…`. Installed, the members live in
// .skilldex/skills/<name> and in every harness directory they are linked into, while the assets live
// in .skilldex/skillsets/<name>/assets — so until 1.5.6 `../assets` resolved to nothing, and an agent
// following a member's own instruction to load the shared file could not find it. These tests read
// the file the way an agent would, from each place a member is served.

const FIXTURE = path.resolve(__dirname, '../fixtures/coherent-skillset')
const MEMBER = 'commit-writer'
const ASSET = 'commit-conventions.md'

const mocks = vi.hoisted(() => ({ project: '', forceEperm: false }))

vi.mock('../../src/core/resolver.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/core/resolver.js')>()
  return {
    ...actual,
    resolveScope: async (level: string) => {
      const rootPath = path.join(mocks.project, '.skilldex')
      return {
        level,
        rootPath,
        manifestPath: path.join(rootPath, 'skilldex.json'),
        skillsDir: path.join(rootPath, 'skills'),
        skillsetsDir: path.join(rootPath, 'skillsets'),
      }
    },
  }
})

// As in harness-bridge.test.ts: force the copy fallback on any platform when asked.
vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>()
  return {
    ...actual,
    default: actual,
    symlink: async (...args: Parameters<typeof actual.symlink>) => {
      if (mocks.forceEperm) {
        throw Object.assign(new Error('EPERM: operation not permitted, symlink'), { code: 'EPERM' })
      }
      return actual.symlink(...args)
    },
  }
})

/** Every directory an installed member is served from at project scope. */
const servedFrom = () => [
  path.join(mocks.project, '.skilldex', 'skills'),
  path.join(mocks.project, '.agents', 'skills'),
  path.join(mocks.project, '.claude', 'skills'),
]

const exists = async (p: string) =>
  lstat(p).then(
    () => true,
    () => false
  )

let expected: string

beforeEach(async () => {
  mocks.project = await mkdtemp(path.join(os.tmpdir(), 'skilldex-skillset-assets-'))
  mocks.forceEperm = false
  expected = await readFile(path.join(FIXTURE, 'assets', ASSET), 'utf8')
})

afterEach(async () => {
  await rm(mocks.project, { recursive: true, force: true })
})

describe('skillset install — shared assets beside the members', () => {
  it('resolves ../assets from every place a member is served, as text', async () => {
    await installSkillsetFromPath(FIXTURE, { scope: 'project' })
    for (const dir of servedFrom()) {
      // path.join normalises `..` lexically — the path an agent builds from where it found the skill
      const asText = path.join(dir, MEMBER, '..', 'assets', ASSET)
      expect(await readFile(asText, 'utf8')).toBe(expected)
    }
  })

  it('resolves ../assets through the member’s link as well', async () => {
    await installSkillsetFromPath(FIXTURE, { scope: 'project' })
    for (const dir of servedFrom()) {
      const real = await realpath(path.join(dir, MEMBER))
      expect(await readFile(path.join(path.dirname(real), 'assets', ASSET), 'utf8')).toBe(expected)
    }
  })

  it('reports where the assets are served', async () => {
    const result = await installSkillsetFromPath(FIXTURE, { scope: 'project' })
    const targets = result.assetLinks.map((l) => l.target)
    for (const dir of servedFrom()) expect(targets).toContain(path.join(dir, 'assets'))
    expect(result.assetLinks.every((l) => l.linked)).toBe(true)
  })

  it('removes them on uninstall', async () => {
    const result = await installSkillsetFromPath(FIXTURE, { scope: 'project' })
    await uninstallSkillset(result.skillsetName, 'project')
    for (const dir of servedFrom()) expect(await exists(path.join(dir, 'assets'))).toBe(false)
  })

  it('never replaces an assets directory it did not create', async () => {
    const theirs = path.join(mocks.project, '.agents', 'skills', 'assets')
    await mkdir(theirs, { recursive: true })
    await writeFile(path.join(theirs, 'notes.md'), 'hand-written\n')

    const result = await installSkillsetFromPath(FIXTURE, { scope: 'project' })

    const conflict = result.assetLinks.find((l) => l.target === theirs)
    expect(conflict?.linked).toBe(false)
    expect(conflict?.conflict).toBeTruthy()
    expect(await readFile(path.join(theirs, 'notes.md'), 'utf8')).toBe('hand-written\n')
    expect(await exists(path.join(theirs, ASSET))).toBe(false)

    await uninstallSkillset(result.skillsetName, 'project')
    expect(await readFile(path.join(theirs, 'notes.md'), 'utf8')).toBe('hand-written\n')
  })

  it('serves them by copy where links cannot be made, and removes the copies on uninstall', async () => {
    mocks.forceEperm = true
    const result = await installSkillsetFromPath(FIXTURE, { scope: 'project' })
    for (const dir of servedFrom()) {
      expect(await readFile(path.join(dir, MEMBER, '..', 'assets', ASSET), 'utf8')).toBe(expected)
    }
    await uninstallSkillset(result.skillsetName, 'project')
    for (const dir of servedFrom()) expect(await exists(path.join(dir, 'assets'))).toBe(false)
  })
})
