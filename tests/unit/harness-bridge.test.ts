import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtemp, mkdir, writeFile, rm, lstat, readlink, readFile } from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { bridgeTargets, bridgeSkill, unbridgeSkill } from '../../src/core/harness-bridge.js'

let tmp: string
let installed: string

beforeEach(async () => {
  tmp = await mkdtemp(path.join(os.tmpdir(), 'skilldex-bridge-test-'))
  installed = path.join(tmp, '.skilldex', 'skills', 'demo-skill')
  await mkdir(installed, { recursive: true })
  await writeFile(path.join(installed, 'SKILL.md'), '---\nname: demo-skill\ndescription: x\n---\n')
})

afterEach(async () => {
  await rm(tmp, { recursive: true, force: true })
})

describe('bridgeTargets', () => {
  it('bridges project scope beside the project', () => {
    const dirs = bridgeTargets('project', '/srv/app').map((t) => t.dir)
    expect(dirs).toEqual([
      path.join('/srv/app', '.agents', 'skills'),
      path.join('/srv/app', '.claude', 'skills'),
    ])
  })

  it('bridges global and shared into the home directory, not the project', () => {
    for (const scope of ['global', 'shared'] as const) {
      const dirs = bridgeTargets(scope, '/srv/app').map((t) => t.dir)
      expect(dirs).toEqual([
        path.join(os.homedir(), '.agents', 'skills'),
        path.join(os.homedir(), '.claude', 'skills'),
      ])
    }
  })
})

describe('bridgeSkill', () => {
  it('links into both harness directories', async () => {
    const links = await bridgeSkill('demo-skill', installed, 'project', tmp)

    expect(links).toHaveLength(2)
    expect(links.every((l) => l.linked)).toBe(true)

    for (const dir of ['.agents', '.claude']) {
      const link = path.join(tmp, dir, 'skills', 'demo-skill')
      expect((await lstat(link)).isSymbolicLink()).toBe(true)
      expect(path.resolve(path.dirname(link), await readlink(link))).toBe(installed)
      // Readable *through* the link — that is the whole point of bridging.
      expect(await readFile(path.join(link, 'SKILL.md'), 'utf8')).toContain('name: demo-skill')
    }
  })

  it('refuses to overwrite a directory it did not create', async () => {
    const claudeDir = path.join(tmp, '.claude', 'skills', 'demo-skill')
    await mkdir(claudeDir, { recursive: true })
    await writeFile(path.join(claudeDir, 'SKILL.md'), 'HAND WRITTEN — must survive\n')

    const links = await bridgeSkill('demo-skill', installed, 'project', tmp)

    const claude = links.find((l) => l.target === claudeDir)
    expect(claude?.linked).toBe(false)
    expect(claude?.conflict).toMatch(/not created by skilldex/)

    // The user's own file is untouched...
    expect(await readFile(path.join(claudeDir, 'SKILL.md'), 'utf8')).toBe('HAND WRITTEN — must survive\n')
    // ...and the conflict does not prevent the other harness from being served.
    expect(links.find((l) => l.target.includes('.agents'))?.linked).toBe(true)
  })

  it('is idempotent — re-bridging an existing link of ours succeeds', async () => {
    await bridgeSkill('demo-skill', installed, 'project', tmp)
    const links = await bridgeSkill('demo-skill', installed, 'project', tmp)
    expect(links.every((l) => l.linked)).toBe(true)
  })
})

describe('unbridgeSkill', () => {
  it('removes the links it created', async () => {
    await bridgeSkill('demo-skill', installed, 'project', tmp)
    const removed = await unbridgeSkill('demo-skill', installed, 'project', tmp)

    expect(removed).toHaveLength(2)
    for (const link of removed) {
      await expect(lstat(link)).rejects.toThrow()
    }
  })

  it('leaves a directory it did not create alone', async () => {
    const claudeDir = path.join(tmp, '.claude', 'skills', 'demo-skill')
    await mkdir(claudeDir, { recursive: true })
    await writeFile(path.join(claudeDir, 'SKILL.md'), 'HAND WRITTEN\n')

    await bridgeSkill('demo-skill', installed, 'project', tmp)
    const removed = await unbridgeSkill('demo-skill', installed, 'project', tmp)

    // Only the .agents link was ours; the hand-written directory survives uninstall.
    expect(removed).toHaveLength(1)
    expect(removed[0]).toContain('.agents')
    expect(await readFile(path.join(claudeDir, 'SKILL.md'), 'utf8')).toBe('HAND WRITTEN\n')
  })

  it('does not remove a link pointing somewhere else', async () => {
    const other = path.join(tmp, 'other-install')
    await mkdir(other, { recursive: true })
    const { symlink } = await import('node:fs/promises')
    const link = path.join(tmp, '.agents', 'skills', 'demo-skill')
    await mkdir(path.dirname(link), { recursive: true })
    await symlink(other, link, 'dir')

    const removed = await unbridgeSkill('demo-skill', installed, 'project', tmp)
    expect(removed).not.toContain(link)
    expect((await lstat(link)).isSymbolicLink()).toBe(true)
  })
})
