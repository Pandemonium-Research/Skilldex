// What `skillpm search` asks the registry to order by.
//
// The registry resolves an absent sort to relevance when a query is present, and returns any
// explicit sort unchanged — so a caller that always sends one can never reach that branch. The
// CLI declared `.option('--sort <sort>', ..., 'installs')`, commander filled it in on every run,
// and every search silently opted out of BM25 ranking.
//
// The consequence was worse than a different order. The highest install_count in the 1.6M-row
// corpus is 4, so the sort key is constant across effectively every row and the `seq` tiebreaker
// decided the page — seed insertion order. Searching "commit" put security-scan and
// supabase-policy-guardrails above git-commit, and returned nothing in common with the website's
// first page for the same query.
//
// These tests assert on the URL rather than on results, because the bug was entirely in what was
// sent: a defaulted flag is invisible at every later layer, and the parameter's *absence* is the
// only way to ask the registry for its own default.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { Command } from 'commander'
import { registerSearch } from '../../src/cli/commands/search.js'
import { searchRegistry } from '../../src/registry/sources/registry.js'

let requested: string[] = []

beforeEach(() => {
  requested = []
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      requested.push(String(url))
      return new Response(
        JSON.stringify({
          skills: [],
          total: 0,
          total_relation: 'eq',
          has_more: false,
          limit: 10,
          offset: 0,
          max_offset: 1000,
        }),
        { status: 200, headers: { 'content-type': 'application/json' } }
      )
    })
  )
  // The action prints a summary; keep the suite output readable.
  vi.spyOn(console, 'log').mockImplementation(() => {})
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

/** Run the real command as a user would, so the commander default is what is under test. */
async function runCommand(argv: string[]) {
  const program = new Command()
  program.exitOverride()
  registerSearch(program)
  await program.parseAsync(argv, { from: 'user' })
  return new URL(requested[0])
}

describe('skillpm search — the sort it asks for', () => {
  it('sends no sort parameter when the user did not ask for one', async () => {
    // The regression this file exists for. A default here is not "the default" — it is an
    // override that the registry cannot distinguish from a deliberate choice.
    const url = await runCommand(['search', 'commit'])

    expect(url.searchParams.has('sort')).toBe(false)
    expect(url.searchParams.get('q')).toBe('commit')
  })

  it('sends the sort the user did ask for', async () => {
    const url = await runCommand(['search', 'commit', '--sort', 'installs'])

    expect(url.searchParams.get('sort')).toBe('installs')
  })

  it('can ask for relevance explicitly', async () => {
    // Undocumented before, and absent from the type, which is part of why the hardcoded default
    // went unnoticed: the one ordering a text query wants looked like an invalid value.
    const url = await runCommand(['search', 'commit', '--sort', 'relevance'])

    expect(url.searchParams.get('sort')).toBe('relevance')
  })

  it('omits sort at the client layer too, not just at the command layer', async () => {
    // searchRegistry builds the query string, so the guarantee has to hold there as well —
    // otherwise a future caller passing undefined would still emit `sort=undefined`.
    await searchRegistry({ q: 'commit' })

    const url = new URL(requested[0])
    expect(url.searchParams.has('sort')).toBe(false)
    expect(url.toString()).not.toContain('undefined')
  })
})
