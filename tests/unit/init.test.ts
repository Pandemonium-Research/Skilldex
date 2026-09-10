// `skillpm init` — scaffolding a skill by hand.
//
// Skillsets could be scaffolded and skills could not, so anyone writing one started from a blank
// file and met the validator's rules by failing them. The rule that matters most is the one that
// looks like formatting: the description must be quoted, because an unquoted value containing a
// colon parses as a nested mapping and takes the whole frontmatter with it. That is not a
// hypothetical — it is the exact failure a model hit generating a draft in this repo.
//
// So the load-bearing assertion here is that the scaffold VALIDATES. A template that fails its own
// validator on the first run teaches the wrong lesson, and asserting on the text of the template
// instead would pass while the file was unparseable.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mkdtemp, rm, readFile, mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { Command } from 'commander'
import { registerInit } from '../../src/cli/commands/init.js'
import { validateSkill } from '../../src/core/validator.js'

let tmpDir: string
/** A kebab-named working directory, since a no-name init takes its name from the directory. */
let projectDir: string
let cwd: string
let printed: string[] = []
let exitCode: number | null = null

beforeEach(async () => {
  tmpDir = await mkdtemp(path.join(os.tmpdir(), 'skilldex-init-'))
  // mkdtemp produces names like `skilldex-init-8C1WK2`, which is not kebab-case — and a no-name
  // init is named after the directory, so it would be refused for the wrong reason.
  projectDir = path.join(tmpDir, 'my-project')
  await mkdir(projectDir)
  cwd = process.cwd()
  process.chdir(projectDir)
  printed = []
  exitCode = null

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

async function init(...args: string[]) {
  const program = new Command()
  program.exitOverride()
  registerInit(program)
  try {
    await program.parseAsync(['init', ...args], { from: 'user' })
  } catch (e) {
    if (!(e instanceof Error) || e.message !== '__exit__') throw e
  }
}

const output = () => printed.join('\n')

describe('scaffolding', () => {
  it('creates a directory with SKILL.md', async () => {
    await init('my-skill')

    const content = await readFile(path.join(projectDir, 'my-skill', 'SKILL.md'), 'utf8')
    expect(content).toContain('name: my-skill')
    expect(content.startsWith('---')).toBe(true)
  })

  it('scaffolds into the current directory when given no name', async () => {
    await init()

    // Named after the directory, matching `skillpm skillset init`.
    const content = await readFile(path.join(projectDir, 'SKILL.md'), 'utf8')
    expect(content).toContain('name: my-project')
  })

  it('produces a file that passes validation as written', async () => {
    // The point of the whole command. A scaffold that fails its own validator is worse than none.
    await init('my-skill')

    const result = await validateSkill(path.join(projectDir, 'my-skill'))

    expect(result.errorCount).toBe(0)
    expect(result.score).toBeGreaterThan(0)
  })

  it('quotes the description, so a colon in it cannot break the frontmatter', async () => {
    // The trap this template exists to close. Asserted through the parser rather than by looking
    // for a quote character, because what matters is that YAML accepts it.
    await init('my-skill')

    const content = await readFile(path.join(projectDir, 'my-skill', 'SKILL.md'), 'utf8')
    const descriptionLine = content.split('\n').find((l) => l.startsWith('description:'))

    expect(descriptionLine).toMatch(/^description: ".*"$/)
    expect(descriptionLine).toContain(':')

    const result = await validateSkill(path.join(projectDir, 'my-skill'))
    expect(result.diagnostics.some((d) => d.check === 'yaml-frontmatter' && d.severity === 'pass'))
      .toBe(true)
  })

  it('interpolates the spec version rather than hardcoding it', async () => {
    const { SPEC_VERSION } = await import('../../src/core/validator.js')
    await init('my-skill')

    const content = await readFile(path.join(projectDir, 'my-skill', 'SKILL.md'), 'utf8')
    expect(content).toContain(`spec_version: "${SPEC_VERSION}"`)
  })
})

describe('refusing bad input', () => {
  it('rejects a name the validator would reject, before creating anything', async () => {
    // Scaffolding a directory around an unusable name leaves a broken skill and an error that
    // arrives a command later.
    await init('My Skill')

    expect(exitCode).toBe(1)
    expect(output()).toMatch(/kebab-case/)
    await expect(readFile(path.join(projectDir, 'My Skill', 'SKILL.md'), 'utf8')).rejects.toThrow()
  })

  it('says where a rejected name came from when it was derived', async () => {
    // `skillpm init` inside `~/MyProject` reporting that "MyProject" is not kebab-case, with no
    // hint that the name came from the directory or that it can be overridden, is a dead end.
    const awkward = path.join(tmpDir, 'My Project')
    await mkdir(awkward)
    process.chdir(awkward)

    await init()

    expect(exitCode).toBe(1)
    expect(output()).toMatch(/kebab-case/)
    expect(output()).toMatch(/came from the current directory/)
    expect(output()).toMatch(/skillpm init <name>/)
  })

  it('does not blame the directory when the name was given explicitly', async () => {
    await init('My Skill')

    expect(output()).not.toMatch(/came from the current directory/)
  })

  it('rejects reserved words in the name', async () => {
    await init('claude-helper')

    expect(exitCode).toBe(1)
    expect(output()).toMatch(/reserved/)
  })

  it('refuses to overwrite an existing directory', async () => {
    await mkdir(path.join(projectDir, 'taken'))
    await writeFile(path.join(projectDir, 'taken', 'keep.txt'), 'do not clobber', 'utf8')

    await init('taken')

    expect(exitCode).toBe(1)
    expect(output()).toMatch(/already exists/)
    await expect(readFile(path.join(projectDir, 'taken', 'keep.txt'), 'utf8')).resolves.toBe(
      'do not clobber'
    )
  })

  it('refuses to overwrite a SKILL.md in the current directory', async () => {
    await writeFile(path.join(projectDir, 'SKILL.md'), 'mine', 'utf8')

    await init()

    expect(exitCode).toBe(1)
    expect(output()).toMatch(/already exists/)
    await expect(readFile(path.join(projectDir, 'SKILL.md'), 'utf8')).resolves.toBe('mine')
  })
})
