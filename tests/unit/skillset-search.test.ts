// `skillpm skillset search` — what it asks the registry for, and what it prints back.
//
// The client function already existed; only the command was missing, so the risk here is not that
// the request fails but that it asks for the wrong thing, or reports a number that means something
// other than it appears to.
//
// Two properties are worth pinning. The sort must stay absent unless the user names one — the same
// trap that made `skillpm search` silently opt out of relevance ranking, and a new command is
// exactly where a "sensible default" gets reintroduced. And a skillset with no members checked
// must print no coherence at all: "0/0" reads as total failure where the truth is that nothing was
// measured, which is why the registry stores NULL rather than zero.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { Command } from 'commander'
import { registerSkillset } from '../../src/cli/commands/skillset.js'

let requested: string[] = []
let printed: string[] = []

function skillset(over: Record<string, unknown> = {}) {
  return {
    name: 'devset',
    description: 'A skillset used in tests.',
    author: 'testuser',
    source_url: 'https://github.com/testuser/sets/tree/main/devset',
    trust_tier: 'community',
    score: 100,
    spec_version: '1.1',
    tags: [],
    skill_count: 2,
    install_count: 0,
    published_at: '2026-09-09T00:00:00.000Z',
    skills: [],
    coherence: {
      members_checked: 2,
      members_coherent: 2,
      pct: 100,
      pass_count: 4,
      warn_count: 0,
      error_count: 0,
      declared_conventions: 1,
    },
    ...over,
  }
}

let body: Record<string, unknown> = {}

beforeEach(() => {
  requested = []
  printed = []
  body = { skillsets: [skillset()], total: 1, limit: 10, offset: 0 }

  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      requested.push(String(url))
      return new Response(JSON.stringify(body), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    })
  )
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
})

/** Drive the real command, so commander's own parsing and defaults are under test. */
async function run(argv: string[]) {
  const program = new Command()
  program.exitOverride()
  registerSkillset(program)
  await program.parseAsync(argv, { from: 'user' })
}

const url = () => new URL(requested[0])
const output = () => printed.join('\n')

describe('skillpm skillset search — the request', () => {
  it('hits the skillsets endpoint with no q when no query is given', async () => {
    // The query is optional here, unlike `skillpm search`: listing every published skillset is a
    // reasonable ask at this corpus size, and an absent q means "no text filter" to the registry.
    await run(['skillset', 'search'])

    expect(url().pathname).toMatch(/\/skillsets$/)
    expect(url().searchParams.has('q')).toBe(false)
  })

  it('passes the query through when one is given', async () => {
    await run(['skillset', 'search', 'commit'])

    expect(url().searchParams.get('q')).toBe('commit')
  })

  it('sends no sort unless the user names one', async () => {
    // Same guarantee as `skillpm search`. A default here would be an override, not a default:
    // the registry only resolves relevance when the parameter is absent.
    await run(['skillset', 'search', 'commit'])

    expect(url().searchParams.has('sort')).toBe(false)
  })

  it('accepts coherence as a sort, which the skills endpoint does not', async () => {
    await run(['skillset', 'search', '--sort', 'coherence'])

    expect(url().searchParams.get('sort')).toBe('coherence')
  })

  it('forwards --min-coherence', async () => {
    await run(['skillset', 'search', '--min-coherence', '80'])

    expect(url().searchParams.get('min_coherence')).toBe('80')
  })

  it('rejects a non-numeric --min-coherence without calling the registry', async () => {
    // Sent as-is the registry answers 400, and reporting that as a registry error would blame the
    // server for a typo in a flag. Nothing should leave the machine.
    const before = process.exitCode
    await run(['skillset', 'search', '--min-coherence', 'abc'])
    const code = process.exitCode
    process.exitCode = before

    expect(requested).toHaveLength(0)
    expect(code).toBe(1)
    expect(output()).toContain('between 0 and 100')
  })
})

describe('skillpm skillset search — the output', () => {
  it('shows coherence beside the format score', async () => {
    await run(['skillset', 'search'])

    expect(output()).toContain('Score: 100/100')
    expect(output()).toContain('Coherence: 2/2')
  })

  it('prints no coherence when no members were checked', async () => {
    // Not "0/0". Nothing was measured, which is not the same as everything failing — the same
    // reason the registry stores NULL and the web hides the bar entirely.
    body = {
      skillsets: [
        skillset({
          skill_count: 0,
          coherence: {
            members_checked: 0,
            members_coherent: 0,
            pct: null,
            pass_count: 0,
            warn_count: 0,
            error_count: 0,
            declared_conventions: 0,
          },
        }),
      ],
      total: 1,
      limit: 10,
      offset: 0,
    }

    await run(['skillset', 'search'])

    expect(output()).toContain('Score: 100/100')
    expect(output()).not.toContain('Coherence')
    expect(output()).not.toContain('0/0')
  })

  it('prints no coherence for a registry that does not send it', async () => {
    // The CLI runs ahead of the deployment it talks to; a registry predating skillset spec 1.1
    // omits the field entirely and that must not render as a failure either.
    body = {
      skillsets: [skillset({ coherence: undefined })],
      total: 1,
      limit: 10,
      offset: 0,
    }

    await run(['skillset', 'search'])

    expect(output()).toContain('Score: 100/100')
    expect(output()).not.toContain('Coherence')
  })

  it('emits camelCase coherence for --json, matching the rest of the CLI', async () => {
    await run(['skillset', 'search', '--json'])

    const parsed = JSON.parse(output())
    expect(parsed.skillsets[0].coherence).toEqual({
      membersChecked: 2,
      membersCoherent: 2,
      passCount: 4,
      warnCount: 0,
      errorCount: 0,
      declaredConventions: 1,
    })
  })
})
