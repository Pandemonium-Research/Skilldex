import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import {
  mkdtemp,
  mkdir,
  writeFile,
  rm,
  lstat,
  readlink,
  readFile,
  symlink,
} from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { bridgeTargets, applicableTargets, bridgeSkill, unbridgeSkill } from '../../src/core/harness-bridge.js'

// Bridging has three routes and no machine offers all of them: a symlink where the OS permits it,
// a junction on Windows where it does not, and a copy when neither is possible. Testing whichever
// the host happens to allow leaves the rest untested exactly where they matter — the copy path is
// Windows-shaped, so on Linux CI it would never run, while this file previously assumed symlinks
// and failed six ways on Windows, one of them while merely building a fixture.
//
// So: assertions are on observable behaviour rather than on mechanism; the copy path is forced
// with a mocked EPERM so it is covered on every platform; and the few genuinely link-specific
// tests are guarded on whether a link can be made at all, by either route, so they run on
// unprivileged Windows instead of silently skipping there.

const mocks = vi.hoisted(() => ({ forceEperm: false }))

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

/** Make a link the way bridgeSkill does: symlink first, junction where that is refused. */
async function makeLink(target: string, linkPath: string): Promise<void> {
  try {
    await symlink(target, linkPath, 'dir')
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== 'EPERM' || process.platform !== 'win32') throw e
    await symlink(target, linkPath, 'junction')
  }
}

/**
 * Can this machine produce a link at all, by either route?
 *
 * Probes both forms, because unprivileged Windows refuses a symlink and allows a junction — so
 * probing only the first would skip the link tests on exactly the machine where the fallback runs.
 */
const canLink = await (async () => {
  const probe = await mkdtemp(path.join(os.tmpdir(), 'skilldex-link-probe-'))
  try {
    await mkdir(path.join(probe, 'target'))
    await makeLink(path.join(probe, 'target'), path.join(probe, 'link'))
    return true
  } catch {
    return false
  } finally {
    await rm(probe, { recursive: true, force: true })
  }
})()

const MARKER = '.skilldex-bridge.json'

let tmp: string
let installed: string

beforeEach(async () => {
  mocks.forceEperm = false
  tmp = await mkdtemp(path.join(os.tmpdir(), 'skilldex-bridge-test-'))
  installed = path.join(tmp, '.skilldex', 'skills', 'demo-skill')
  await mkdir(installed, { recursive: true })
  await writeFile(path.join(installed, 'SKILL.md'), '---\nname: demo-skill\ndescription: x\n---\n')
})

afterEach(async () => {
  mocks.forceEperm = false
  await rm(tmp, { recursive: true, force: true })
})

/** What a harness would actually read at a bridged path, however it was bridged. */
async function readBridged(dir: string): Promise<string> {
  return readFile(path.join(tmp, dir, 'skills', 'demo-skill', 'SKILL.md'), 'utf8')
}

describe('bridgeTargets', () => {
  it('lists the two shared conventions unguarded, beside the project', () => {
    const shared = bridgeTargets('project', '/srv/app').filter((t) => !t.requires)
    expect(shared.map((t) => t.dir)).toEqual([
      path.join('/srv/app', '.agents', 'skills'),
      path.join('/srv/app', '.claude', 'skills'),
    ])
  })

  it('bridges global and shared into the home directory, not the project', () => {
    for (const scope of ['global', 'shared'] as const) {
      const shared = bridgeTargets(scope, '/srv/app').filter((t) => !t.requires)
      expect(shared.map((t) => t.dir)).toEqual([
        path.join(os.homedir(), '.agents', 'skills'),
        path.join(os.homedir(), '.claude', 'skills'),
      ])
    }
  })

  it('guards every vendor-private path on that harness being installed', () => {
    for (const scope of ['project', 'global'] as const) {
      for (const t of bridgeTargets(scope, '/srv/app')) {
        const isShared = t.dir.includes('.agents') || t.dir.includes(`.claude${path.sep}skills`)
        expect(Boolean(t.requires)).toBe(!isShared)
      }
    }
  })
})

describe('applicableTargets', () => {
  it('omits a vendor path when the harness is not installed', async () => {
    const targets = await applicableTargets('project', tmp)
    expect(targets.map((t) => t.dir)).toEqual([
      path.join(tmp, '.agents', 'skills'),
      path.join(tmp, '.claude', 'skills'),
    ])
  })

  it('includes it once the harness config directory exists', async () => {
    await mkdir(path.join(tmp, '.qwen'), { recursive: true })
    const dirs = (await applicableTargets('project', tmp)).map((t) => t.dir)
    expect(dirs).toContain(path.join(tmp, '.qwen', 'skills'))
  })

  it('does not treat a file as an installed harness', async () => {
    await writeFile(path.join(tmp, '.qwen'), 'not a directory')
    const dirs = (await applicableTargets('project', tmp)).map((t) => t.dir)
    expect(dirs).not.toContain(path.join(tmp, '.qwen', 'skills'))
  })
})

describe('bridgeSkill', () => {
  it('serves the skill in both harness directories', async () => {
    const links = await bridgeSkill('demo-skill', installed, 'project', tmp)

    expect(links).toHaveLength(2) // vendor paths are guarded off — no harness installed here
    expect(links.every((l) => l.linked)).toBe(true)

    // Readable at the bridged path — the whole point, whichever mechanism was used.
    for (const dir of ['.agents', '.claude']) {
      expect(await readBridged(dir)).toContain('name: demo-skill')
    }
  })

  it.skipIf(!canLink)('links rather than copies wherever a link can be made', async () => {
    const links = await bridgeSkill('demo-skill', installed, 'project', tmp)

    expect(links.every((l) => l.mechanism === 'symlink')).toBe(true)
    for (const dir of ['.agents', '.claude']) {
      const link = path.join(tmp, dir, 'skills', 'demo-skill')
      expect((await lstat(link)).isSymbolicLink()).toBe(true)
      expect(path.resolve(path.dirname(link), await readlink(link))).toBe(installed)
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

  it('serves a vendor-private path once that harness is present', async () => {
    await mkdir(path.join(tmp, '.qwen'), { recursive: true })
    const links = await bridgeSkill('demo-skill', installed, 'project', tmp)

    const qwen = links.find((l) => l.target.includes('.qwen'))
    expect(qwen?.linked).toBe(true)
    expect(await readBridged('.qwen')).toContain('name: demo-skill')
  })

  it('creates nothing for a harness that is not installed', async () => {
    await bridgeSkill('demo-skill', installed, 'project', tmp)
    await expect(lstat(path.join(tmp, '.qwen'))).rejects.toThrow()
    await expect(lstat(path.join(tmp, '.cline'))).rejects.toThrow()
  })

  it('is idempotent — re-bridging an existing bridge of ours succeeds', async () => {
    await bridgeSkill('demo-skill', installed, 'project', tmp)
    const links = await bridgeSkill('demo-skill', installed, 'project', tmp)

    expect(links.every((l) => l.linked)).toBe(true)
    expect(links.every((l) => l.conflict === undefined)).toBe(true)
  })
})

describe('bridgeSkill — where symlinks are not permitted', () => {
  // Forced, so this runs everywhere. Left to the host it would only ever execute on an
  // unprivileged Windows machine, which is precisely where nobody was running the suite.
  beforeEach(() => {
    mocks.forceEperm = true
  })

  it('falls back to copying so the skill still loads', async () => {
    const links = await bridgeSkill('demo-skill', installed, 'project', tmp)

    expect(links.every((l) => l.linked)).toBe(true)
    expect(links.every((l) => l.mechanism === 'copy')).toBe(true)
    for (const dir of ['.agents', '.claude']) {
      expect(await readBridged(dir)).toContain('name: demo-skill')
      expect((await lstat(path.join(tmp, dir, 'skills', 'demo-skill'))).isDirectory()).toBe(true)
    }
  })

  it('marks the copy with the source it came from', async () => {
    // The marker is what makes a copy recognisable later. A symlink says where it points; a copy
    // says nothing, and that silence is what let a skill survive its own uninstall.
    await bridgeSkill('demo-skill', installed, 'project', tmp)

    const marker = path.join(tmp, '.agents', 'skills', 'demo-skill', MARKER)
    const parsed = JSON.parse(await readFile(marker, 'utf8')) as { source: string }
    expect(path.resolve(parsed.source)).toBe(path.resolve(installed))
  })

  it('re-bridging refreshes a stale copy', async () => {
    // A copy is a snapshot and does not follow the source. Every `skillpm update` reinstalls with
    // force, which re-bridges — so without this the command reported success while the harness
    // went on reading the old skill.
    await bridgeSkill('demo-skill', installed, 'project', tmp)
    await writeFile(
      path.join(installed, 'SKILL.md'),
      '---\nname: demo-skill\ndescription: UPDATED\n---\n'
    )

    await bridgeSkill('demo-skill', installed, 'project', tmp)

    expect(await readBridged('.agents')).toContain('UPDATED')
    expect(await readBridged('.claude')).toContain('UPDATED')
  })

  it('does not report our own copy as somebody else’s directory', async () => {
    // The false conflict: our copy was unrecognisable, so reinstalling accused Skilldex of
    // colliding with its own leftovers.
    await bridgeSkill('demo-skill', installed, 'project', tmp)
    const links = await bridgeSkill('demo-skill', installed, 'project', tmp)

    expect(links.every((l) => l.linked)).toBe(true)
    expect(links.some((l) => l.conflict)).toBe(false)
  })
})

describe('unbridgeSkill', () => {
  it('removes the bridges it created', async () => {
    await bridgeSkill('demo-skill', installed, 'project', tmp)
    const removed = await unbridgeSkill('demo-skill', installed, 'project', tmp)

    expect(removed).toHaveLength(2)
    for (const link of removed) {
      await expect(lstat(link)).rejects.toThrow()
    }
  })

  it('removes a copied bridge, not only a linked one', async () => {
    // A8 itself. Uninstall reported success and left the copy in place, so the skill stayed
    // loaded in every harness that read the directory.
    mocks.forceEperm = true
    await bridgeSkill('demo-skill', installed, 'project', tmp)
    mocks.forceEperm = false

    const removed = await unbridgeSkill('demo-skill', installed, 'project', tmp)

    expect(removed).toHaveLength(2)
    for (const dir of ['.agents', '.claude']) {
      await expect(lstat(path.join(tmp, dir, 'skills', 'demo-skill'))).rejects.toThrow()
    }
  })

  it.runIf(process.platform === 'win32')(
    'recognises its own bridge through a differently-cased path',
    async () => {
      // C:\Users\… and c:\users\… are one directory on Windows, so comparing the strings
      // literally would call our own bridge somebody else's and refuse to remove it. This is not
      // hypothetical: the same oversight elsewhere in this project produced a confident, wrong
      // claim about which install was in use.
      for (const copied of [false, true]) {
        mocks.forceEperm = copied
        await bridgeSkill('demo-skill', installed, 'project', tmp)
        mocks.forceEperm = false

        const removed = await unbridgeSkill('demo-skill', installed.toUpperCase(), 'project', tmp)

        expect(removed).toHaveLength(2)
      }
    }
  )

  it.skipIf(process.platform === 'win32')(
    'treats a differently-cased path as a different install where case matters',
    async () => {
      // The other half of the same rule. On a case-sensitive filesystem these really are two
      // directories, and folding them would delete a bridge belonging to something else.
      await bridgeSkill('demo-skill', installed, 'project', tmp)

      const removed = await unbridgeSkill('demo-skill', installed.toUpperCase(), 'project', tmp)

      expect(removed).toHaveLength(0)
    }
  )

  it('leaves a plain file at the bridge path alone', async () => {
    // Nothing here is ours: a file cannot be a bridge by either mechanism, and "cannot tell"
    // must mean "do not touch" for a function that removes recursively.
    const bridged = path.join(tmp, '.agents', 'skills', 'demo-skill')
    await mkdir(path.dirname(bridged), { recursive: true })
    await writeFile(bridged, 'not a skill directory at all')

    const removed = await unbridgeSkill('demo-skill', installed, 'project', tmp)

    expect(removed).toHaveLength(0)
    expect(await readFile(bridged, 'utf8')).toBe('not a skill directory at all')
  })

  it('leaves a directory it did not create alone', async () => {
    const claudeDir = path.join(tmp, '.claude', 'skills', 'demo-skill')
    await mkdir(claudeDir, { recursive: true })
    await writeFile(path.join(claudeDir, 'SKILL.md'), 'HAND WRITTEN\n')

    await bridgeSkill('demo-skill', installed, 'project', tmp)
    const removed = await unbridgeSkill('demo-skill', installed, 'project', tmp)

    // Only the .agents bridge was ours; the hand-written directory survives uninstall.
    expect(removed).toHaveLength(1)
    expect(removed[0]).toContain('.agents')
    expect(await readFile(path.join(claudeDir, 'SKILL.md'), 'utf8')).toBe('HAND WRITTEN\n')
  })

  it('removes a vendor-path bridge even after that harness is uninstalled', async () => {
    await mkdir(path.join(tmp, '.qwen'), { recursive: true })
    await bridgeSkill('demo-skill', installed, 'project', tmp)
    // The user removes Qwen; our bridge under it must still be cleaned up.
    await rm(path.join(tmp, '.qwen', 'marker'), { force: true })
    const removed = await unbridgeSkill('demo-skill', installed, 'project', tmp)
    expect(removed.some((r) => r.includes('.qwen'))).toBe(true)
  })

  it.skipIf(!canLink)('does not remove a link pointing somewhere else', async () => {
    const other = path.join(tmp, 'other-install')
    await mkdir(other, { recursive: true })
    const link = path.join(tmp, '.agents', 'skills', 'demo-skill')
    await mkdir(path.dirname(link), { recursive: true })
    await makeLink(other, link)

    const removed = await unbridgeSkill('demo-skill', installed, 'project', tmp)

    expect(removed).not.toContain(link)
    expect((await lstat(link)).isSymbolicLink()).toBe(true)
  })

  it('does not remove a copy belonging to a different install', async () => {
    // The same safety property as the test above, reachable without symlink permission: a marker
    // naming another source is somebody else's bridge, not ours to delete.
    const bridged = path.join(tmp, '.agents', 'skills', 'demo-skill')
    await mkdir(bridged, { recursive: true })
    await writeFile(path.join(bridged, 'SKILL.md'), 'SOMEONE ELSE\n')
    await writeFile(
      path.join(bridged, MARKER),
      JSON.stringify({ source: path.join(tmp, 'a-different-install'), createdAt: 'x' })
    )

    const removed = await unbridgeSkill('demo-skill', installed, 'project', tmp)

    expect(removed).not.toContain(bridged)
    expect(await readFile(path.join(bridged, 'SKILL.md'), 'utf8')).toBe('SOMEONE ELSE\n')
  })

  it('ignores a directory with an unreadable marker rather than deleting it', async () => {
    // A corrupt marker proves nothing, and "cannot tell" must mean "do not touch" for anything
    // this function removes recursively.
    const bridged = path.join(tmp, '.agents', 'skills', 'demo-skill')
    await mkdir(bridged, { recursive: true })
    await writeFile(path.join(bridged, MARKER), 'not json at all')

    const removed = await unbridgeSkill('demo-skill', installed, 'project', tmp)

    expect(removed).toHaveLength(0)
    await expect(lstat(bridged)).resolves.toBeTruthy()
  })
})
