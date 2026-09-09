// Deciding whether an install source is a registry name or something on disk.
//
// This rule lived in three places — the skill installer, the skillset installer, and inline in the
// MCP server — spelled slightly differently in each and wrong the same way in all of them. They
// tested startsWith('/') and includes('://'), and a Windows absolute path satisfies neither:
// `C:/skills/demo` begins with a drive letter and contains ':/' but not '://', so it was sent to
// the registry, which answered 404 for a directory sitting on the user's own disk.
//
// The cases below are mostly Windows-shaped for that reason, and they are deliberately asserted on
// every platform rather than guarded behind process.platform: the rule is about the shape of the
// string, and a Linux CI run that skipped them would be testing the half that already worked.

import { describe, it, expect, vi, afterEach } from 'vitest'
import { isRegistryName, isLocalPath, isGitSource } from '../../src/core/source-kind.js'

// path.isAbsolute already recognises `C:/x` and `\\server\share` when running on Windows, so the
// explicit checks for those forms look redundant on a Windows box and are load-bearing on Linux.
// Testing them here would therefore prove nothing on the machine most of this was written on, and
// silently regress for everyone else. This makes isAbsolute answer the way it does on POSIX so the
// Windows-form checks have to carry the case on their own, whatever the host.
const mocks = vi.hoisted(() => ({ pretendPosix: false }))

vi.mock('node:path', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:path')>()
  const isAbsolute = (p: string) => (mocks.pretendPosix ? p.startsWith('/') : actual.isAbsolute(p))
  return { ...actual, isAbsolute, default: { ...actual, isAbsolute } }
})

afterEach(() => {
  mocks.pretendPosix = false
})

describe('isRegistryName', () => {
  it('accepts a bare name', () => {
    for (const name of ['developer', 'research', 'skillset-creator', 'my_skill', 'a1']) {
      expect(isRegistryName(name)).toBe(true)
    }
  })

  it('rejects a Windows absolute path in either slash direction', () => {
    // The reported bug. Both forms are absolute paths on Windows and neither was recognised.
    for (const p of ['C:/skills/demo', 'C:\\skills\\demo', 'c:/skills/demo', 'D:\\x']) {
      expect(isRegistryName(p)).toBe(false)
    }
  })

  it('rejects a UNC share', () => {
    expect(isRegistryName('\\\\fileserver\\team\\skills')).toBe(false)
  })

  it('rejects a POSIX absolute path', () => {
    expect(isRegistryName('/srv/skills/demo')).toBe(false)
  })

  it('rejects relative paths written with either separator', () => {
    // `.\demo` is how a Windows shell completes a local directory, and it was accepted as a name.
    for (const p of ['./demo', '.\\demo', '../demo', '..\\demo']) {
      expect(isRegistryName(p)).toBe(false)
    }
  })

  it('rejects git and protocol sources', () => {
    for (const p of ['git+https://github.com/a/b', 'https://example.com/x', 'file:///srv/x']) {
      expect(isRegistryName(p)).toBe(false)
    }
  })

  it('rejects a path to a markdown file', () => {
    expect(isRegistryName('SKILL.md')).toBe(false)
  })
})

describe('isLocalPath', () => {
  it('recognises Windows forms even when running on POSIX', () => {
    // Asserted unconditionally on purpose. A directory named `C:` is possible on Linux and would
    // now be read as a path there — the safer of the two misreadings, since a path that does not
    // exist fails immediately and names itself, where a registry lookup returns a 404 that blames
    // the wrong thing entirely.
    expect(isLocalPath('C:/skills/demo')).toBe(true)
    expect(isLocalPath('C:\\skills\\demo')).toBe(true)
    expect(isLocalPath('\\\\server\\share')).toBe(true)
  })

  it('does not treat a bare name as a path', () => {
    expect(isLocalPath('developer')).toBe(false)
  })
})

describe('Windows path forms, with isAbsolute answering as it does on POSIX', () => {
  // Without this, the drive-letter and UNC checks are dead weight on Windows and the only thing
  // standing between a Linux user and a misrouted path — so a Windows-only test run would call
  // them covered while they were free to be deleted.
  it('still recognises a drive-letter path', () => {
    mocks.pretendPosix = true

    for (const p of ['C:/skills/demo', 'C:\\skills\\demo', 'z:/x']) {
      expect(isLocalPath(p)).toBe(true)
      expect(isRegistryName(p)).toBe(false)
    }
  })

  it('still recognises a UNC share', () => {
    mocks.pretendPosix = true

    expect(isLocalPath('\\\\fileserver\\team\\skills')).toBe(true)
    expect(isRegistryName('\\\\fileserver\\team\\skills')).toBe(false)
  })

  it('still treats a bare name as a name', () => {
    mocks.pretendPosix = true

    expect(isRegistryName('developer')).toBe(true)
  })
})

describe('isGitSource', () => {
  it('matches only the git+ prefix', () => {
    expect(isGitSource('git+https://github.com/a/b')).toBe(true)
    expect(isGitSource('https://github.com/a/b')).toBe(false)
    expect(isGitSource('developer')).toBe(false)
  })
})
