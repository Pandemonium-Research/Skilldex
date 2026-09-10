// `skillpm skillset init` — the overwrite guards.
//
// This command had no tests at all, which is how it kept a bug that `skillpm init` had already
// been fixed for. Both of its "does this already exist?" checks were written as
//
//   try { await stat(p); printError(...); process.exit(1) } catch { proceed }
//
// where the catch means "not there". `process.exit` throws before it terminates, so the bail is
// caught by the handler for the opposite case and execution continues — straight into the
// writeFile that clobbers the file the check was protecting.
//
// So the assertions below are deliberately about the FILE, not about the exit code. Checking only
// that exit was called with 1 passes on the buggy version: it does call exit, and then overwrites
// anyway. What distinguishes the two is whether the user's content survived.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mkdtemp, rm, readFile, mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { Command } from 'commander'
import { registerSkillset } from '../../src/cli/commands/skillset.js'
import { SKILLSET_SPEC_VERSION } from '../../src/core/skillset-validator.js'

let tmpDir: string
/** A kebab-named working directory, since a no-name init takes its name from the directory. */
let projectDir: string
let cwd: string
let printed: string[] = []
let exitCode: number | null = null

beforeEach(async () => {
  tmpDir = await mkdtemp(path.join(os.tmpdir(), 'skilldex-skillset-init-'))
  projectDir = path.join(tmpDir, 'my-project')
  await mkdir(projectDir)
  cwd = process.cwd()
  process.chdir(projectDir)
  printed = []
  exitCode = null

  // Stubbing exit as a throw is what a test harness has to do — the process cannot actually be
  // torn down mid-suite. It is also precisely the condition the bug needed: real `process.exit`
  // terminates and papers over the mistake, so the defect is invisible until something stops the
  // process from dying. That makes this stub the bug's detector, not an artefact of testing.
  vi.spyOn(process, 'exit').mockImplementation(((code?: number) => {
    exitCode = code ?? 0
    throw new Error('__exit__')
  }) as never)
  vi.spyOn(console, 'log').mockImplementation((...a: unknown[]) => {
    printed.push(a.join(' '))
  })
  vi.spyOn(console, 'error').mockImplementation((...a: unknown[]) => {
    printed.push(a.join(' '))
  })
})

afterEach(async () => {
  process.chdir(cwd)
  vi.restoreAllMocks()
  await rm(tmpDir, { recursive: true, force: true })
})

async function skillsetInit(...args: string[]) {
  const program = new Command()
  program.exitOverride()
  registerSkillset(program)
  try {
    await program.parseAsync(['skillset', 'init', ...args], { from: 'user' })
  } catch (e) {
    if (!(e instanceof Error) || e.message !== '__exit__') throw e
  }
}

const output = () => printed.join('\n')

describe('scaffolding', () => {
  it('creates a directory with SKILLSET.md', async () => {
    await skillsetInit('my-skillset')

    const content = await readFile(
      path.join(projectDir, 'my-skillset', 'SKILLSET.md'),
      'utf8'
    )
    expect(content).toContain('name: my-skillset')
    expect(content.startsWith('---')).toBe(true)
  })

  it('scaffolds into the current directory when given no name', async () => {
    await skillsetInit()

    const content = await readFile(path.join(projectDir, 'SKILLSET.md'), 'utf8')
    expect(content).toContain('name: my-project')
  })

  it('creates the assets directory alongside it', async () => {
    await skillsetInit('my-skillset')

    // Written as a file probe rather than a stat on the directory, so it fails the same way if
    // `assets` is created as something other than a usable directory.
    await writeFile(path.join(projectDir, 'my-skillset', 'assets', 'probe.txt'), 'x', 'utf8')
    await expect(
      readFile(path.join(projectDir, 'my-skillset', 'assets', 'probe.txt'), 'utf8')
    ).resolves.toBe('x')
  })

  it('interpolates the spec version rather than hardcoding it', async () => {
    await skillsetInit('my-skillset')

    const content = await readFile(path.join(projectDir, 'my-skillset', 'SKILLSET.md'), 'utf8')
    expect(content).toContain(`spec_version: "${SKILLSET_SPEC_VERSION}"`)
  })
})

describe('refusing to overwrite', () => {
  it('does not touch an existing directory, and leaves its contents alone', async () => {
    await mkdir(path.join(projectDir, 'taken'))
    await writeFile(path.join(projectDir, 'taken', 'keep.txt'), 'do not clobber', 'utf8')

    await skillsetInit('taken')

    expect(exitCode).toBe(1)
    expect(output()).toMatch(/already exists/)
    await expect(readFile(path.join(projectDir, 'taken', 'keep.txt'), 'utf8')).resolves.toBe(
      'do not clobber'
    )
    // The load-bearing one. On the buggy version the directory check falls through to mkdir
    // (harmless, recursive) and then writes a fresh SKILLSET.md into the user's directory.
    await expect(
      readFile(path.join(projectDir, 'taken', 'SKILLSET.md'), 'utf8')
    ).rejects.toThrow()
  })

  it('does not overwrite a SKILLSET.md in the current directory', async () => {
    await writeFile(path.join(projectDir, 'SKILLSET.md'), 'mine', 'utf8')

    await skillsetInit()

    expect(exitCode).toBe(1)
    expect(output()).toMatch(/already exists/)
    // The second occurrence of the same shape, and the one that actually destroys user content:
    // the catch there is empty, so the exit throw is swallowed whole and writeFile replaces a
    // hand-written skillset with the template.
    await expect(readFile(path.join(projectDir, 'SKILLSET.md'), 'utf8')).resolves.toBe('mine')
  })

  it('does not overwrite a SKILLSET.md inside a named directory that already exists', async () => {
    // Both guards on one path. The first should stop it; if the first is bypassed the second is
    // the last thing standing between the template and the user's file.
    await mkdir(path.join(projectDir, 'taken'))
    await writeFile(path.join(projectDir, 'taken', 'SKILLSET.md'), 'hand written', 'utf8')

    await skillsetInit('taken')

    expect(exitCode).toBe(1)
    await expect(readFile(path.join(projectDir, 'taken', 'SKILLSET.md'), 'utf8')).resolves.toBe(
      'hand written'
    )
  })

  it('stops before creating assets when it refuses', async () => {
    // A refusal that still leaves an `assets/` directory behind has not really refused.
    await writeFile(path.join(projectDir, 'SKILLSET.md'), 'mine', 'utf8')

    await skillsetInit()

    await expect(
      readFile(path.join(projectDir, 'assets', 'anything.txt'), 'utf8')
    ).rejects.toThrow()
  })
})
