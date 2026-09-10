import type { ProjectProfile } from './project-context.js'
import type { RegistrySkill } from '../registry/sources/registry.js'

/**
 * Finding real skills for a project, so suggestions can name things that exist.
 *
 * `suggest` asked a model for skill names with no registry in the loop at all, and the model
 * obliged — plausible, kebab-cased, installable nowhere. The fix is not a better prompt. It is to
 * search first and let the model choose only from what came back.
 *
 * Three measurements against production shaped what follows, and each rules out something that
 * looked reasonable in the abstract:
 *
 *   Retrieval is conjunctive. `toFtsQuery` joins terms with AND, so every extra word is another
 *   mandatory match: `commit` returns 10,000 and `help me write a conventional commit` returns 30.
 *   Queries here are therefore single tokens, which is what a project's dependency names already
 *   are.
 *
 *   Search is slow and sometimes fails. Single keywords measured 2.6s (`vitest`), 10.9s
 *   (`express`), 17.3s (`typescript`), 25.4s (`python`), against a 30s platform ceiling that
 *   `q=write` and `q=the` hit outright. Serial fan-out would be minutes, so queries run together
 *   and a straggler is dropped rather than allowed to sink the whole call.
 *
 *   Filtering to verified is not the answer to burial. Zero verified skills appear in the top ten
 *   for any of `express`, `typescript`, `vitest`, `terraform`, `python` — and asking for them
 *   directly is worse, not better: `tier=verified` returned 0 results for `terraform`, 1 for
 *   `python` (a spreadsheet skill), and 504'd for `typescript`. The verified corpus is too small
 *   to fall back on, so tier is carried through and preferred among what actually returns.
 */

/** Registry search is the slow path; a straggler past this is dropped, not waited on. */
const QUERY_TIMEOUT_MS = 25_000

/** Results per query. Enough to rank within, small enough to keep the response quick. */
const RESULTS_PER_QUERY = 10

/** Queries per fan-out. They run concurrently, so this bounds load rather than latency. */
const MAX_QUERIES = 8

export interface SkillCandidate {
  /** `owner/name` — unique by construction, since the registry keys skills on (owner, name). */
  qualifiedName: string
  name: string
  owner: string | null
  description: string
  trustTier: RegistrySkill['trust_tier']
  score: number | null
  installCount: number
  sourceUrl: string
  /** Which queries returned this skill. More than one is a signal that it fits the project. */
  matchedQueries: string[]
  /** Best (lowest, zero-based) position it reached in any single query's results. */
  bestRank: number
}

export interface QueryOutcome {
  query: string
  status: 'ok' | 'failed' | 'timeout'
  results: number
  ms: number
  error?: string
}

export interface CandidatePool {
  candidates: SkillCandidate[]
  queries: QueryOutcome[]
  /** Candidates dropped because the project already has a skill of that name. */
  alreadyInstalled: number
  elapsedMs: number
}

/**
 * Query seeds for a project, most specific first.
 *
 * Drawn from the profile's keywords, which are dependency names, tooling and languages in that
 * order — specific before generic, because a query for `express` says far more about a project
 * than one for `javascript`.
 *
 * A project with no dependency manifest yields very little here. That is a real limit rather than
 * a bug: this project's own research repo produces the single seed `python`. Callers that need
 * more have to derive it from prose, which needs a model, which is why this function does not.
 */
export function buildQueries(profile: ProjectProfile, limit: number = MAX_QUERIES): string[] {
  return profile.keywords.slice(0, limit)
}

/** One search, bounded in time, never throwing. */
async function runQuery(
  query: string,
  search: typeof import('../registry/sources/registry.js').searchRegistry
): Promise<{ outcome: QueryOutcome; skills: RegistrySkill[] }> {
  const started = Date.now()
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), QUERY_TIMEOUT_MS)

  try {
    // `sort` is deliberately absent. The registry resolves an absent sort to relevance when a
    // query is present, and sending any explicit value opts out of that — the trap that made
    // `skillpm search` rank by install count across a corpus where the maximum was 4.
    const response = await search({
      q: query,
      limit: RESULTS_PER_QUERY,
      signal: controller.signal,
    })

    return {
      outcome: { query, status: 'ok', results: response.skills.length, ms: Date.now() - started },
      skills: response.skills,
    }
  } catch (e) {
    const aborted = controller.signal.aborted
    return {
      outcome: {
        query,
        status: aborted ? 'timeout' : 'failed',
        results: 0,
        ms: Date.now() - started,
        error: aborted ? `timed out after ${QUERY_TIMEOUT_MS}ms` : errorMessage(e),
      },
      skills: [],
    }
  } finally {
    clearTimeout(timer)
  }
}

function errorMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e)
}

/**
 * The registry's own identifier for a skill, or the best reconstruction of it.
 *
 * A deployment predating qualified names sends neither field, and two skills sharing a bare name
 * would then collapse into one pool entry — which is the ambiguity this whole area exists to
 * avoid. Falling back to `owner/name` keeps them apart wherever an owner is known at all.
 */
function identify(skill: RegistrySkill): string {
  return skill.qualified_name ?? (skill.owner ? `${skill.owner}/${skill.name}` : skill.name)
}

/**
 * Order candidates for a model to choose from.
 *
 * Coverage leads: a skill returned by several of a project's queries is relevant to the project
 * rather than to one of its dependencies. Tier comes next, which is where burial gets what
 * correction is available — not by filtering the search, which measurably does not work, but by
 * preferring a verified skill over a community one that ranked alongside it.
 */
function rank(a: SkillCandidate, b: SkillCandidate): number {
  if (a.matchedQueries.length !== b.matchedQueries.length) {
    return b.matchedQueries.length - a.matchedQueries.length
  }
  if (a.trustTier !== b.trustTier) return a.trustTier === 'verified' ? -1 : 1
  if (a.bestRank !== b.bestRank) return a.bestRank - b.bestRank
  if ((b.score ?? -1) !== (a.score ?? -1)) return (b.score ?? -1) - (a.score ?? -1)
  return a.qualifiedName.localeCompare(b.qualifiedName)
}

export interface RetrieveOptions {
  /** Bare names the project already has; candidates matching one are dropped. */
  installedSkills?: string[]
  /** Injected for tests, so the pool can be exercised without a registry. */
  search?: typeof import('../registry/sources/registry.js').searchRegistry
}

/**
 * Search the registry for each query and merge the results into one pool.
 *
 * Every query runs, every failure is recorded, and nothing throws: a fan-out where two of eight
 * queries time out should still produce six queries' worth of candidates. Reporting the failures
 * matters as much as the candidates — a pool that came back thin because half the searches died
 * looks exactly like a project with few relevant skills, and the caller must be able to tell the
 * difference.
 */
export async function retrieveCandidates(
  queries: string[],
  options: RetrieveOptions = {}
): Promise<CandidatePool> {
  const started = Date.now()

  if (queries.length === 0) {
    return { candidates: [], queries: [], alreadyInstalled: 0, elapsedMs: 0 }
  }

  const search =
    options.search ?? (await import('../registry/sources/registry.js')).searchRegistry

  const settled = await Promise.all(queries.map((query) => runQuery(query, search)))

  const installed = new Set((options.installedSkills ?? []).map((n) => n.toLowerCase()))
  const byId = new Map<string, SkillCandidate>()
  let alreadyInstalled = 0

  for (const { outcome, skills } of settled) {
    skills.forEach((skill, index) => {
      if (installed.has(skill.name.toLowerCase())) {
        alreadyInstalled++
        return
      }

      const id = identify(skill)
      const existing = byId.get(id)

      if (existing) {
        // Seen from another query. Record the coverage and keep the better position.
        if (!existing.matchedQueries.includes(outcome.query)) {
          existing.matchedQueries.push(outcome.query)
        }
        existing.bestRank = Math.min(existing.bestRank, index)
        return
      }

      byId.set(id, {
        qualifiedName: id,
        name: skill.name,
        owner: skill.owner ?? null,
        description: skill.description,
        trustTier: skill.trust_tier,
        score: skill.score,
        installCount: skill.install_count,
        sourceUrl: skill.source_url,
        matchedQueries: [outcome.query],
        bestRank: index,
      })
    })
  }

  return {
    candidates: [...byId.values()].sort(rank),
    queries: settled.map((s) => s.outcome),
    alreadyInstalled,
    elapsedMs: Date.now() - started,
  }
}

/** Convenience: derive queries from a profile and retrieve in one call. */
export async function retrieveForProject(
  profile: ProjectProfile,
  options: RetrieveOptions = {}
): Promise<CandidatePool> {
  return retrieveCandidates(buildQueries(profile), {
    installedSkills: profile.installedSkills,
    ...options,
  })
}
