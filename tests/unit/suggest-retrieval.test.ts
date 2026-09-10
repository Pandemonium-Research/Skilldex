// Building a pool of real registry skills for suggest to choose from.
//
// The behaviour under test is mostly about what happens when the registry misbehaves, because it
// measurably does: single-keyword queries took between 2.6s and 25.4s against production, and
// common words hit the 30s platform ceiling and 504. A fan-out has to survive that — six queries'
// worth of candidates is a good answer, and silently reporting it as if all eight succeeded is
// not.
//
// The search function is injected rather than mocked through the module registry, so these tests
// state their own timings and failures instead of inheriting a real one.

import { describe, it, expect, vi } from 'vitest'
import {
  retrieveCandidates,
  retrieveForProject,
  buildQueries,
  type SkillCandidate,
} from '../../src/core/suggest-retrieval.js'
import type { ProjectProfile } from '../../src/core/project-context.js'
import type { RegistrySkill } from '../../src/registry/sources/registry.js'

function skill(over: Partial<RegistrySkill> = {}): RegistrySkill {
  return {
    name: 'terraform',
    owner: 'mauromedda',
    qualified_name: 'mauromedda/terraform',
    description: 'Production-quality Terraform.',
    author: 'mauromedda',
    source_url: 'https://github.com/mauromedda/agent-toolkit',
    trust_tier: 'community',
    score: 93,
    spec_version: '1.0',
    tags: [],
    install_count: 0,
    published_at: '2026-09-09T00:00:00.000Z',
    ...over,
  }
}

/** A search that answers each query from a table, and fails or hangs where told to. */
function fakeSearch(
  table: Record<string, RegistrySkill[] | { throws: string } | { hangs: true }>
) {
  return vi.fn(async (opts: { q?: string; signal?: AbortSignal }) => {
    const entry = table[opts.q ?? ''] ?? []

    if ('throws' in entry) throw new Error(entry.throws)

    if ('hangs' in entry) {
      // Never resolves on its own; only the caller's abort ends it.
      return new Promise<never>((_resolve, reject) => {
        opts.signal?.addEventListener('abort', () => reject(new Error('The operation was aborted')))
      })
    }

    return { skills: entry, total: entry.length, limit: 10, offset: 0 }
  })
}

const profile = (over: Partial<ProjectProfile> = {}): ProjectProfile => ({
  root: '/project',
  manifests: [],
  languages: [],
  tooling: [],
  docs: [],
  installedSkills: [],
  keywords: [],
  isEmpty: false,
  scanned: { files: 0, walkTruncated: false },
  ...over,
})

describe('deriving queries', () => {
  it('takes the profile keywords, most specific first', () => {
    const p = profile({ keywords: ['express', 'zod', 'typescript', 'javascript'] })
    expect(buildQueries(p)).toEqual(['express', 'zod', 'typescript', 'javascript'])
  })

  it('caps how many queries a fan-out will run', () => {
    const p = profile({ keywords: Array.from({ length: 30 }, (_, i) => `dep${i}`) })
    expect(buildQueries(p)).toHaveLength(8)
  })

  it('returns nothing for a project with no keywords', () => {
    // A repo with no dependency manifest genuinely yields nothing here. Inventing a query would
    // put the fabrication back one layer.
    expect(buildQueries(profile())).toEqual([])
  })
})

describe('the request itself', () => {
  it('sends one single-token query per keyword and never names a sort', async () => {
    // Absent sort is not the same as choosing one: the registry resolves absent to relevance when
    // a query is present, and any explicit value opts out of it.
    const search = fakeSearch({ express: [skill()], zod: [] })

    await retrieveCandidates(['express', 'zod'], { search })

    expect(search).toHaveBeenCalledTimes(2)
    for (const [args] of search.mock.calls) {
      expect(args.q).not.toContain(' ')
      expect('sort' in args).toBe(false)
    }
  })

  it('runs the queries together rather than one after another', async () => {
    let inFlight = 0
    let peak = 0
    const search = vi.fn(async () => {
      peak = Math.max(peak, ++inFlight)
      await new Promise((r) => setTimeout(r, 10))
      inFlight--
      return { skills: [], total: 0, limit: 10, offset: 0 }
    })

    await retrieveCandidates(['a', 'b', 'c', 'd'], { search: search as never })

    // Serially this is four round trips; against production that was over a minute.
    expect(peak).toBe(4)
  })

  it('makes no request at all when there are no queries', async () => {
    const search = fakeSearch({})
    const pool = await retrieveCandidates([], { search })

    expect(search).not.toHaveBeenCalled()
    expect(pool.candidates).toEqual([])
  })
})

describe('surviving a registry that fails', () => {
  it('keeps the results of the queries that worked', async () => {
    const search = fakeSearch({
      express: [skill({ name: 'express-helper', qualified_name: 'a/express-helper' })],
      typescript: { throws: 'Registry error 504' },
    })

    const pool = await retrieveCandidates(['express', 'typescript'], { search })

    expect(pool.candidates.map((c) => c.qualifiedName)).toEqual(['a/express-helper'])
  })

  it('reports which query failed and why, rather than looking like a thin corpus', async () => {
    // A pool that came back small because half the searches died is indistinguishable from a
    // project with few relevant skills unless the failures are reported.
    const search = fakeSearch({
      express: [skill()],
      typescript: { throws: 'Registry error 504' },
    })

    const pool = await retrieveCandidates(['express', 'typescript'], { search })
    const failed = pool.queries.find((q) => q.query === 'typescript')

    expect(failed?.status).toBe('failed')
    expect(failed?.error).toContain('504')
    expect(pool.queries.find((q) => q.query === 'express')?.status).toBe('ok')
  })

  it('aborts a query that outlives its timeout and marks it as such', async () => {
    vi.useFakeTimers()
    try {
      const search = fakeSearch({ python: { hangs: true }, vitest: [skill()] })
      const pending = retrieveCandidates(['python', 'vitest'], { search })

      await vi.advanceTimersByTimeAsync(25_000)
      const pool = await pending

      const timedOut = pool.queries.find((q) => q.query === 'python')
      expect(timedOut?.status).toBe('timeout')
      expect(timedOut?.error).toContain('timed out')
      // The query that answered still contributed.
      expect(pool.candidates).toHaveLength(1)
    } finally {
      vi.useRealTimers()
    }
  })

  it('does not leave a timer holding the process open after a query answers', async () => {
    vi.useFakeTimers()
    try {
      const search = fakeSearch({ vitest: [skill()] })
      await retrieveCandidates(['vitest'], { search })

      expect(vi.getTimerCount()).toBe(0)
    } finally {
      vi.useRealTimers()
    }
  })
})

describe('merging results into a pool', () => {
  it('keys candidates on owner/name so two skills sharing a name stay apart', async () => {
    // The registry keys skills on (owner, name); `terraform` alone is claimed by ten owners.
    const search = fakeSearch({
      terraform: [
        skill({ owner: 'mauromedda', qualified_name: 'mauromedda/terraform' }),
        skill({ owner: 'dennisonbertram', qualified_name: 'dennisonbertram/terraform' }),
      ],
    })

    const pool = await retrieveCandidates(['terraform'], { search })

    expect(pool.candidates.map((c) => c.qualifiedName)).toEqual([
      'mauromedda/terraform',
      'dennisonbertram/terraform',
    ])
  })

  it('builds owner/name itself when the registry sends no qualified name', async () => {
    const search = fakeSearch({
      terraform: [
        skill({ owner: 'a', qualified_name: undefined }),
        skill({ owner: 'b', qualified_name: undefined }),
      ],
    })

    const pool = await retrieveCandidates(['terraform'], { search })

    expect(pool.candidates.map((c) => c.qualifiedName).sort()).toEqual([
      'a/terraform',
      'b/terraform',
    ])
  })

  it('records every query that found the same skill, without duplicating it', async () => {
    const shared = skill({ name: 'iac', qualified_name: 'x/iac' })
    const search = fakeSearch({ terraform: [shared], aws: [shared] })

    const pool = await retrieveCandidates(['terraform', 'aws'], { search })

    expect(pool.candidates).toHaveLength(1)
    expect(pool.candidates[0].matchedQueries.sort()).toEqual(['aws', 'terraform'])
  })

  it('keeps the best position a skill reached in any query, whichever query that was', async () => {
    // Both orderings, because only one of them discriminates. If the later query happens to carry
    // the better position, plain assignment gives the same answer as keeping the minimum — so a
    // single case here passes against an implementation that simply overwrites.
    const shared = skill({ name: 'iac', qualified_name: 'x/iac' })
    const padded = [skill({ qualified_name: 'other/a' }), skill({ qualified_name: 'other/b' }), shared]

    const bestFirst = await retrieveCandidates(['aws', 'terraform'], {
      search: fakeSearch({ aws: [shared], terraform: padded }),
    })
    const bestLast = await retrieveCandidates(['terraform', 'aws'], {
      search: fakeSearch({ terraform: padded, aws: [shared] }),
    })

    expect(bestFirst.candidates.find((c) => c.qualifiedName === 'x/iac')?.bestRank).toBe(0)
    expect(bestLast.candidates.find((c) => c.qualifiedName === 'x/iac')?.bestRank).toBe(0)
  })

  it('carries the fields a caller needs to install and to judge', async () => {
    const search = fakeSearch({ terraform: [skill()] })

    const [candidate] = (await retrieveCandidates(['terraform'], { search })).candidates

    expect(candidate).toMatchObject<Partial<SkillCandidate>>({
      qualifiedName: 'mauromedda/terraform',
      name: 'terraform',
      owner: 'mauromedda',
      trustTier: 'community',
      score: 93,
      sourceUrl: 'https://github.com/mauromedda/agent-toolkit',
    })
    expect(candidate.description).toContain('Terraform')
  })
})

describe('ordering the pool', () => {
  it('puts a skill found by several queries above one found by a single query', async () => {
    const broad = skill({ name: 'iac', qualified_name: 'x/iac' })
    const narrow = skill({ name: 'tf-only', qualified_name: 'y/tf-only', score: 100 })
    const search = fakeSearch({ terraform: [narrow, broad], aws: [broad] })

    const pool = await retrieveCandidates(['terraform', 'aws'], { search })

    // Even though `narrow` ranked first and scores higher, fitting two of the project's queries
    // says more about the project than either.
    expect(pool.candidates[0].qualifiedName).toBe('x/iac')
  })

  it('prefers a verified skill over a community one with the same coverage', async () => {
    // The only correction available for burial. Filtering the search to verified measurably does
    // not work — tier=verified returned 0 results for terraform and 504'd for typescript — so the
    // preference is applied to whatever the unfiltered search returned.
    const search = fakeSearch({
      terraform: [
        skill({ qualified_name: 'community/tf', trust_tier: 'community', score: 100 }),
        skill({ qualified_name: 'anthropics/tf', trust_tier: 'verified', score: 50 }),
      ],
    })

    const pool = await retrieveCandidates(['terraform'], { search })

    expect(pool.candidates[0].qualifiedName).toBe('anthropics/tf')
  })

  it('orders identically ranked candidates deterministically', async () => {
    const search = fakeSearch({
      terraform: [
        skill({ qualified_name: 'z/tf', score: 90 }),
        skill({ qualified_name: 'a/tf', score: 90 }),
      ],
    })

    const first = await retrieveCandidates(['terraform'], { search })
    const second = await retrieveCandidates(['terraform'], { search })

    expect(first.candidates.map((c) => c.qualifiedName)).toEqual(
      second.candidates.map((c) => c.qualifiedName)
    )
  })
})

describe('skills the project already has', () => {
  it('drops them and says how many', async () => {
    const search = fakeSearch({
      terraform: [skill({ name: 'terraform' }), skill({ name: 'other', qualified_name: 'x/other' })],
    })

    const pool = await retrieveCandidates(['terraform'], {
      search,
      installedSkills: ['terraform'],
    })

    expect(pool.candidates.map((c) => c.name)).toEqual(['other'])
    expect(pool.alreadyInstalled).toBe(1)
  })

  it('matches an installed name regardless of case', async () => {
    const search = fakeSearch({ terraform: [skill({ name: 'Terraform' })] })

    const pool = await retrieveCandidates(['terraform'], {
      search,
      installedSkills: ['terraform'],
    })

    expect(pool.candidates).toEqual([])
  })
})

describe('retrieveForProject', () => {
  it('derives queries from the profile and excludes what is already installed', async () => {
    const search = fakeSearch({
      express: [skill({ name: 'express-helper', qualified_name: 'a/express-helper' })],
      zod: [skill({ name: 'installed-one', qualified_name: 'b/installed-one' })],
    })

    const pool = await retrieveForProject(
      profile({ keywords: ['express', 'zod'], installedSkills: ['installed-one'] }),
      { search }
    )

    expect(pool.queries.map((q) => q.query)).toEqual(['express', 'zod'])
    expect(pool.candidates.map((c) => c.name)).toEqual(['express-helper'])
    expect(pool.alreadyInstalled).toBe(1)
  })

  it('returns an empty pool for a profile with nothing to search on', async () => {
    const search = fakeSearch({})

    const pool = await retrieveForProject(profile(), { search })

    expect(search).not.toHaveBeenCalled()
    expect(pool.candidates).toEqual([])
    expect(pool.queries).toEqual([])
  })
})
