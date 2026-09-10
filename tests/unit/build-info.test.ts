// `skillpm --version` reports the build, not the source tree.
//
// It read package.json at runtime, which in a linked checkout is the source tree: after a
// `git pull` the reported version moved and dist/ did not. A build from 2026-09-06 reported 1.4.0
// while missing everything 1.3.1 and 1.4.0 added, and an experiment would have recorded it under
// that label. The version now comes from dist/build-info.json, written at build time, and
// `--version` warns when a checkout has moved past its build.

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, realpathSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  parseBuildInfo,
  readBuildInfo,
  checkoutHead,
  stalenessWarning,
} from '../../src/core/build-info.js'
import { createCli } from '../../src/cli/index.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const SCRIPT = path.join(__dirname, '..', '..', 'scripts', 'write-build-info.mjs')

let tmp: string

beforeEach(() => {
  tmp = realpathSync(mkdtempSync(path.join(tmpdir(), 'skilldex-build-info-')))
})

afterEach(() => {
  rmSync(tmp, { recursive: true, force: true })
})

function writePackage(dir: string, version: string): void {
  mkdirSync(dir, { recursive: true })
  writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ name: 'probe', version }))
}

function writeRecord(dir: string, record: unknown): void {
  mkdirSync(path.join(dir, 'dist'), { recursive: true })
  writeFileSync(path.join(dir, 'dist', 'build-info.json'), JSON.stringify(record))
}

/** Commit everything in `dir` as a fresh repository; returns HEAD. */
function commitAll(dir: string): string {
  const git = (...args: string[]) =>
    execFileSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', ...args], {
      cwd: dir,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim()
  git('init', '-q')
  git('add', '-A')
  git('commit', '-q', '-m', 'init')
  return git('rev-parse', 'HEAD')
}

describe('readBuildInfo', () => {
  it('reports the version a build was built at, not what package.json says now', () => {
    writePackage(tmp, '1.4.0')
    writeRecord(tmp, { version: '1.2.0', commit: 'a'.repeat(40), dirty: false, builtAt: null })
    expect(readBuildInfo(path.join(tmp, 'dist')).version).toBe('1.2.0')
  })

  it('reports the source version when running from source, never the last build', () => {
    // A source run must not pick up dist/'s record — that would be the same bug inverted.
    writePackage(tmp, '1.4.0')
    writeRecord(tmp, { version: '1.2.0' })
    expect(readBuildInfo(path.join(tmp, 'src'))).toEqual({
      version: '1.4.0',
      commit: null,
      dirty: null,
      builtAt: null,
    })
  })

  it('falls back to package.json when the build record is malformed', () => {
    writePackage(tmp, '1.4.0')
    writeRecord(tmp, { commit: 5 })
    expect(readBuildInfo(path.join(tmp, 'dist')).version).toBe('1.4.0')
  })
})

describe('parseBuildInfo', () => {
  it('rejects a record without a version', () => {
    expect(parseBuildInfo({ commit: 'abc' })).toBeNull()
    expect(parseBuildInfo({ version: '' })).toBeNull()
    expect(parseBuildInfo(null)).toBeNull()
    expect(parseBuildInfo('1.4.0')).toBeNull()
  })

  it('keeps the version and nulls fields of the wrong type', () => {
    expect(parseBuildInfo({ version: '1.4.0', commit: 7, dirty: 'no', builtAt: 1 })).toEqual({
      version: '1.4.0',
      commit: null,
      dirty: null,
      builtAt: null,
    })
  })
})

describe('stalenessWarning', () => {
  const built = (commit: string | null) => ({ version: '1.4.0', commit, dirty: false, builtAt: null })

  it('is silent when the build matches the checkout', () => {
    expect(stalenessWarning(built('a'.repeat(40)), 'a'.repeat(40))).toBeNull()
  })

  it('is silent when either side is unknown', () => {
    // A published install has no checkout; a source run has no build commit.
    expect(stalenessWarning(built('a'.repeat(40)), null)).toBeNull()
    expect(stalenessWarning(built(null), 'b'.repeat(40))).toBeNull()
  })

  it('names both commits and the fix when the checkout has moved on', () => {
    const warning = stalenessWarning(built('a'.repeat(40)), 'b'.repeat(40))
    expect(warning).toContain('aaaaaaa')
    expect(warning).toContain('bbbbbbb')
    expect(warning).toContain('npm run build')
  })
})

describe('checkoutHead', () => {
  it('is null outside a git checkout', () => {
    writePackage(tmp, '1.4.0')
    expect(checkoutHead(path.join(tmp, 'dist'))).toBeNull()
  })

  it('returns HEAD of the checkout the code runs from', () => {
    writePackage(tmp, '1.4.0')
    const head = commitAll(tmp)
    expect(checkoutHead(path.join(tmp, 'dist'))).toBe(head)
  })
})

describe('scripts/write-build-info.mjs', () => {
  const run = (root: string) => execFileSync('node', [SCRIPT, root], { stdio: 'ignore' })
  const record = (root: string) =>
    JSON.parse(readFileSync(path.join(root, 'dist', 'build-info.json'), 'utf8'))

  it('records the version and the commit of its own checkout', () => {
    writePackage(tmp, '2.0.0')
    const head = commitAll(tmp)
    run(tmp)
    expect(record(tmp)).toMatchObject({ version: '2.0.0', commit: head, dirty: false })
  })

  it('marks a build from uncommitted tracked changes as dirty', () => {
    writePackage(tmp, '2.0.0')
    commitAll(tmp)
    writePackage(tmp, '2.0.1')
    run(tmp)
    expect(record(tmp)).toMatchObject({ version: '2.0.1', dirty: true })
  })

  it('records no commit outside a git checkout', () => {
    writePackage(tmp, '2.0.0')
    run(tmp)
    expect(record(tmp)).toMatchObject({ version: '2.0.0', commit: null, dirty: null })
  })

  it("does not borrow the HEAD of an enclosing repository", () => {
    // A package built inside someone else's repo, such as a git dependency cloned into a project.
    writeFileSync(path.join(tmp, 'README'), 'outer')
    commitAll(tmp)
    const inner = path.join(tmp, 'vendor', 'skilldex')
    writePackage(inner, '2.0.0')
    run(inner)
    expect(record(inner).commit).toBeNull()
  })
})

describe('skillpm --version', () => {
  it('prints the version of the code that is running', () => {
    let out = ''
    const program = createCli()
      .exitOverride()
      .configureOutput({ writeOut: (s) => void (out += s) })
    expect(() => program.parse(['node', 'skillpm', '--version'])).toThrow()
    expect(out).toBe(`${readBuildInfo().version}\n`)
  })
})
