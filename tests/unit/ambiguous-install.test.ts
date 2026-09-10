// Installing a bare name that several owners claim.
//
// The registry answers 409 AMBIGUOUS_NAME, names the owners, and suggests — in prose — that the
// caller "use /skills/{owner}/<name>/install". That is an HTTP path. Nobody can type it into this
// CLI, and the CLI reprinted it verbatim as the entire remedy while discarding the `owners` array
// that came with it. The answer was in the response body and got thrown away one layer below.
//
// Three ways out, because the right one depends on who is asking: a terminal user gets a picker,
// a --json caller gets the list as data, and a piped invocation gets a command it can copy rather
// than a prompt that would hang.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { runInstall } from '../../src/cli/commands/install-action.js'

const hoisted = vi.hoisted(() => ({ select: vi.fn(), installFromGitUrl: vi.fn() }))

vi.mock('@inquirer/prompts', () => ({ select: hoisted.select }))

// Resolving the name is what is under test; fetching it is not. Left real, each terminal case
// cloned from GitHub, which made a unit test both slow and dependent on the network.
vi.mock('../../src/registry/sources/github.js', () => ({
  installFromGitUrl: hoisted.installFromGitUrl,
}))

let printed: string[] = []
let requested: string[] = []
let owners: string[] = []
let exitCode: number | null = null
let isTty: boolean

const OWNERS_10 = [
  'Shkirmantsev',
  'hashimiche',
  'lamhq',
  'bobmatnyc',
  'robert-chiniquy',
  'georgekhananaev',
  'mqtik',
  'jyasuu',
  'andreyk0',
  'jholhewres',
]

beforeEach(() => {
  printed = []
  requested = []
  owners = ['mauromedda', 'dennisonbertram']
  exitCode = null
  isTty = true
  hoisted.select.mockReset()
  hoisted.installFromGitUrl.mockReset()
  hoisted.installFromGitUrl.mockResolvedValue({
    skillName: 'terraform',
    scope: 'project',
    validation: { score: 93, warnCount: 0, errorCount: 0, diagnostics: [] },
    bridged: [],
  })

  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      const u = String(url)
      requested.push(u)

      // Only the bare name is ambiguous; a qualified one resolves.
      const bare = /\/skills\/terraform\/install$/.test(u)
      if (bare) {
        return new Response(
          JSON.stringify({
            error: `Skill name "terraform" is claimed by multiple owners; use /skills/{owner}/terraform/install`,
            code: 'AMBIGUOUS_NAME',
            owners,
          }),
          { status: 409, headers: { 'content-type': 'application/json' } }
        )
      }

      return new Response(
        JSON.stringify({
          name: 'terraform',
          owner: 'mauromedda',
          qualified_name: 'mauromedda/terraform',
          source_url: 'https://github.com/mauromedda/agent-toolkit/tree/HEAD/skills/terraform',
          score: 93,
          spec_version: '1.0',
          trust_tier: 'community',
        }),
        { status: 200, headers: { 'content-type': 'application/json' } }
      )
    })
  )

  // The install itself is out of scope here: these tests are about how the name is resolved, and
  // cloning a repo to prove it would only make them slow and networked.
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

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  if (ORIGINAL_ISTTY) Object.defineProperty(process.stdin, 'isTTY', ORIGINAL_ISTTY)
  else delete (process.stdin as any).isTTY
})

// isTTY is a plain data property, not a getter, so it cannot be spied on — and under vitest it is
// absent entirely, which is itself the piped case.
const ORIGINAL_ISTTY = Object.getOwnPropertyDescriptor(process.stdin, 'isTTY')

function setTty(value: boolean): void {
  Object.defineProperty(process.stdin, 'isTTY', { value, configurable: true, writable: true })
}

const output = () => printed.join('\n')

/**
 * The JSON payload, taken from the first console.log rather than from all of them.
 *
 * printJson emits the whole document in one call. Everything after it here is an artifact of
 * mocking process.exit as a throw: in production the process is gone at that point, but under the
 * mock the throw reaches the command's own catch, which prints again.
 */
const jsonPayload = () => JSON.parse(printed[0])

/** Run install, swallowing the process.exit our mock turns into a throw. */
async function install(name: string, json = false) {
  // Applied here rather than in beforeEach so a nested suite's own beforeEach has already set it.
  setTty(isTty)
  try {
    await runInstall(name, { scope: 'project', force: false, json })
  } catch (e) {
    if (!(e instanceof Error) || e.message !== '__exit__') throw e
  }
}

describe('--json: the owners come back as data', () => {
  it('reports the code, the owners and ready-to-use qualified names', async () => {
    await install('terraform', true)

    const payload = jsonPayload()
    expect(payload.code).toBe('AMBIGUOUS_NAME')
    expect(payload.installed).toBe(false)
    expect(payload.owners).toEqual(['mauromedda', 'dennisonbertram'])
    expect(payload.candidates).toEqual(['mauromedda/terraform', 'dennisonbertram/terraform'])
    expect(exitCode).toBe(1)
  })

  it('flags that ten owners may not be all of them', async () => {
    // getSkillByBareName selects LIMIT 11 and returns the first ten, so exactly ten is
    // indistinguishable from a hundred. Reporting it as the complete set would be a lie.
    owners = OWNERS_10
    await install('terraform', true)

    const payload = jsonPayload()
    expect(payload.owners_truncated).toBe(true)
    expect(payload.owners).toHaveLength(10)
  })

  it('does not flag truncation when fewer than ten owners came back', async () => {
    await install('terraform', true)
    expect(jsonPayload().owners_truncated).toBe(false)
  })

  it('never prompts in json mode', async () => {
    await install('terraform', true)
    expect(hoisted.select).not.toHaveBeenCalled()
  })
})

describe('a terminal: pick an owner and carry on', () => {
  it('offers every claimant as a qualified name', async () => {
    hoisted.select.mockResolvedValue('dennisonbertram/terraform')

    await install('terraform')

    expect(hoisted.select).toHaveBeenCalledTimes(1)
    const choices = hoisted.select.mock.calls[0][0].choices
    expect(choices.map((c: { value: string }) => c.value)).toEqual([
      'mauromedda/terraform',
      'dennisonbertram/terraform',
    ])
  })

  it('retries the lookup with the chosen qualified name', async () => {
    hoisted.select.mockResolvedValue('dennisonbertram/terraform')

    await install('terraform')

    // The separator must survive into the retried URL — a %2F here would 404, which is the
    // defect the qualified-name fix addressed one layer down.
    expect(requested.some((u) => u.endsWith('/skills/dennisonbertram/terraform/install'))).toBe(
      true
    )
    expect(requested.every((u) => !u.includes('%2F'))).toBe(true)
  })

  it('says "several" rather than a count when the list may be truncated', async () => {
    owners = OWNERS_10
    hoisted.select.mockResolvedValue('lamhq/terraform')

    await install('terraform')

    expect(hoisted.select.mock.calls[0][0].message).toContain('several')
  })

  it('gives the exact count when the list is complete', async () => {
    hoisted.select.mockResolvedValue('mauromedda/terraform')

    await install('terraform')

    expect(hoisted.select.mock.calls[0][0].message).toContain('2 owners')
  })
})

describe('piped, no terminal: print something copyable', () => {
  beforeEach(() => {
    isTty = false
  })

  it('lists qualified install commands instead of prompting', async () => {
    await install('terraform')

    expect(hoisted.select).not.toHaveBeenCalled()
    expect(output()).toContain('skillpm install mauromedda/terraform')
    expect(output()).toContain('skillpm install dennisonbertram/terraform')
    expect(exitCode).toBe(1)
  })

  it('never repeats the registry HTTP path as advice', async () => {
    // The whole point: `/skills/{owner}/terraform/install` is not a command.
    await install('terraform')

    expect(output()).not.toContain('/skills/{owner}')
  })

  it('admits the list may be incomplete at ten', async () => {
    owners = OWNERS_10
    await install('terraform')

    expect(output()).toContain('and possibly others')
  })
})

describe('errors that are not ambiguity', () => {
  it('treats an ambiguity carrying no owners as an ordinary failure', async () => {
    // A picker with nothing to pick is worse than the error. The code says AMBIGUOUS_NAME but the
    // list is empty, so there is nothing to offer and the registry's own message has to stand.
    owners = []

    await install('terraform')

    expect(hoisted.select).not.toHaveBeenCalled()
    expect(output()).toContain('claimed by multiple owners')
    expect(exitCode).toBe(1)
  })

  it('passes an unrelated failure straight through', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(JSON.stringify({ error: 'Skill not found', code: 'NOT_FOUND' }), {
            status: 404,
            headers: { 'content-type': 'application/json' },
          })
      )
    )

    await install('nonexistent-skill')

    expect(hoisted.select).not.toHaveBeenCalled()
    expect(output()).toContain('Skill not found')
    expect(exitCode).toBe(1)
  })
})
