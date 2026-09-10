import Anthropic from '@anthropic-ai/sdk'
import type { ScopeLevel } from '../types/scope.js'
import {
  gatherProjectProfile,
  renderProjectContext,
  type ProjectProfile,
} from './project-context.js'
import type { CandidatePool, SkillCandidate } from './suggest-retrieval.js'

/**
 * A skill the registry actually holds, proposed for this project.
 *
 * The previous shape was `{ skillName, reason, suggestedScope, available }`, where `skillName` was
 * whatever the model invented and `available` was hardcoded `true` at the point of return — a
 * field that existed, was typed, and was never once computed. Every proposal claimed to be
 * installable and none was.
 *
 * `qualifiedName` replaces `skillName` because a bare name does not identify a skill: the registry
 * keys on (owner, name), and `terraform` alone is claimed by ten owners. `available` is gone
 * rather than fixed — a proposal now originates from a search result, so existence is a property
 * of where it came from and not a claim to be asserted.
 */
export interface SuggestionProposal {
  /** `owner/name`. Installable as-is: `skillpm install <qualifiedName>`. */
  qualifiedName: string
  name: string
  owner: string | null
  reason: string
  suggestedScope: ScopeLevel
  trustTier: SkillCandidate['trustTier']
  score: number | null
  sourceUrl: string
}

export interface ProjectContext {
  profile: ProjectProfile
  /** The profile rendered for a prompt. Never send this to a model when `profile.isEmpty`. */
  text: string
}

/**
 * What we know about the project, and how it reads as prompt text.
 *
 * The profile comes back alongside the text rather than being discarded, for two reasons: the
 * caller has to decide whether there is enough here to ask a model anything at all, and the facts
 * in it — dependency names, tooling — are what registry queries get built from, which re-parsing
 * our own rendered prose could only lose.
 */
export async function gatherProjectContext(projectRoot: string): Promise<ProjectContext> {
  const profile = await gatherProjectProfile(projectRoot)
  return { profile, text: renderProjectContext(profile) }
}

/**
 * One model round trip, returning raw text.
 *
 * Injectable so the two calls below can be tested without an API key or a network. The parsing,
 * validation and prompt construction are where the defects live, and none of them need a model to
 * exercise.
 */
export type Complete = (system: string, user: string) => Promise<string>

/**
 * The context guard.
 *
 * The original defect: the gatherer returned '' for any project it did not recognise, the caller
 * passed it through, and the model was asked to suggest skills for a project it had been told
 * nothing about. It complied every time. Callers check `profile.isEmpty` and report properly; this
 * is the backstop against a future caller reintroducing it.
 */
function requireContext(context: string): void {
  if (!context.trim()) {
    throw new Error(
      'Refusing to generate suggestions with no project context — any result would be invented.'
    )
  }
}

async function defaultComplete(system: string, user: string): Promise<string> {
  const { getConfigValue } = await import('./config.js')
  const apiKey = await getConfigValue('anthropicApiKey')
  // Bearer-token auth for custom/proxy endpoints (e.g. a LiteLLM proxy).
  const authToken = process.env.ANTHROPIC_AUTH_TOKEN
  if (!apiKey && !authToken) {
    throw new Error(
      'ANTHROPIC_API_KEY is required for the suggest command. Set it via environment variable or run: skillpm config set anthropicApiKey <key>. For a custom endpoint, set ANTHROPIC_BASE_URL and ANTHROPIC_AUTH_TOKEN.'
    )
  }

  // Optional overrides so suggest can run against an Anthropic-compatible proxy
  // (defaults preserve first-party Anthropic behaviour).
  const baseURL = process.env.ANTHROPIC_BASE_URL
  const model = process.env.SKILLPM_SUGGEST_MODEL ?? 'claude-sonnet-4-6'

  const client = new Anthropic({
    ...(apiKey ? { apiKey } : {}),
    ...(authToken ? { authToken } : {}),
    ...(baseURL ? { baseURL } : {}),
  })

  const message = await client.messages.create({
    model,
    max_tokens: 1024,
    messages: [{ role: 'user', content: user }],
    system,
  })

  const textContent = message.content.find((c) => c.type === 'text')
  if (!textContent || textContent.type !== 'text') {
    throw new Error('No text response from AI')
  }
  return textContent.text
}

/** Pull the JSON object out of a reply that may be wrapped in prose or a code fence. */
function parseJsonReply<T>(reply: string): T {
  const match = reply.match(/\{[\s\S]*\}/)
  if (!match) throw new Error('Could not parse AI response as JSON')
  return JSON.parse(match[0]) as T
}

// --- Call one: what to search the registry for ---

const MAX_PROPOSED_QUERIES = 6

/**
 * A term the registry can actually match.
 *
 * Retrieval is conjunctive — the registry ANDs every term in a query — so a two-word query asks
 * for documents containing both words and a sentence asks for the intersection of all of them.
 * Measured: `commit` returns 10,000 matches and `help me write a conventional commit` returns 30.
 * A model asked for search terms will happily return phrases, so anything with whitespace or
 * punctuation is dropped here rather than sent.
 */
const SEARCHABLE_TERM = /^[a-z0-9][a-z0-9._-]*$/

const QUERY_SYSTEM_PROMPT = `You are helping search a registry of Claude Code skills for a project.

Skills are packages that give an AI coding agent a specific capability — writing conventional
commits, reviewing Terraform, drafting LaTeX papers, generating changelogs.

Given a project's context, propose search terms that would find skills useful to someone working
on THIS project.

Respond ONLY with valid JSON:
{ "queries": ["term", "term", "term"] }

Rules:
- Each term must be a SINGLE word: lowercase letters, digits, dots, hyphens or underscores. No
  spaces, no phrases, no sentences. The search engine requires every word in a query to match, so
  a phrase finds almost nothing.
- Propose what the project DOES, not only what it depends on. A repo full of experiment scripts
  and a paper wants "latex", "citations", "figures" — not just "python".
- Prefer specific terms over generic ones. "changelog" is useful; "code" is not.
- At most 6 terms.`

/**
 * Ask the model what this project should search for.
 *
 * This exists because the deterministic seeds are not enough, in two distinct ways measured on
 * real repos. A project with no dependency manifest yields almost nothing — this CLI's own
 * research repo produces the single seed `python`, and when that one query timed out the pool was
 * empty. And dependency names retrieve dependency-named skills: querying `ora` finds
 * `cameronmpalmer/ora-usage` and `synmux/ora-skilld`, not "how to write good CLI output". What a
 * project depends on is a poor proxy for what it does, and only the prose says what it does.
 *
 * Returned terms are filtered, not trusted: the model is asked for single tokens and will
 * sometimes return phrases anyway.
 */
export async function proposeQueries(
  context: string,
  options: { complete?: Complete } = {}
): Promise<string[]> {
  requireContext(context)

  const complete = options.complete ?? defaultComplete
  const reply = await complete(
    QUERY_SYSTEM_PROMPT,
    `Project context:\n\n${context}\n\nPropose search terms for finding skills useful to this project.`
  )

  const parsed = parseJsonReply<{ queries?: unknown }>(reply)
  const raw = Array.isArray(parsed.queries) ? parsed.queries : []

  const seen = new Set<string>()
  const queries: string[] = []
  for (const entry of raw) {
    if (typeof entry !== 'string') continue
    const term = entry.trim().toLowerCase()
    if (!SEARCHABLE_TERM.test(term) || seen.has(term)) continue
    seen.add(term)
    queries.push(term)
    if (queries.length >= MAX_PROPOSED_QUERIES) break
  }

  return queries
}

/**
 * A skill this project wants that the registry does not have.
 *
 * Deliberately not a `SuggestionProposal`: it names nothing installable, and conflating the two is
 * how the original defect read to a user — a list where some entries existed and some did not,
 * with nothing to tell them apart. A gap is a proposal to *write* something, and the UI says so.
 */
export interface SkillGap {
  /** kebab-case, validator-legal. Becomes the directory and the frontmatter `name`. */
  name: string
  purpose: string
  reason: string
}

export interface SelectionResult {
  proposals: SuggestionProposal[]
  gaps: SkillGap[]
}

// --- Call two: which of the found skills to propose, and what is missing ---

const MAX_SELECTED = 7
const MAX_GAPS = 3

/**
 * How many candidates the selection prompt carries.
 *
 * Measured end to end against a real model, the whole 64-candidate pool inlined produced a
 * 37,800-character prompt, which dominates the cost of the run. The pool is already ranked, so
 * truncating costs very little — the entries beyond this are the ones a single query returned at
 * a poor position.
 */
const MAX_CANDIDATES_IN_PROMPT = 40

const SELECTION_SYSTEM_PROMPT = `You are recommending Claude Code skills for a project.

You will be given a project's context and a numbered list of skills that EXIST in the registry.

Respond ONLY with valid JSON:
{
  "proposals": [
    {
      "qualifiedName": "owner/name — copied EXACTLY from the list",
      "reason": "one sentence on why this skill fits this project",
      "suggestedScope": "project" | "shared" | "global"
    }
  ],
  "gaps": [
    {
      "name": "kebab-case-name",
      "purpose": "one sentence on what this skill would do",
      "reason": "one sentence on why this project needs it"
    }
  ]
}

Rules for "proposals" — skills that already exist:
- Choose ONLY from the list. Never invent a name, never alter one, never combine two.
- Copy qualifiedName character for character, including the owner prefix.
- Choose at most 7, and fewer is better. Many listed skills will be irrelevant — a skill merely
  named after one of the project's dependencies is usually not useful to a project that uses it.
- If nothing in the list genuinely fits, return an empty list. That is a valid and useful answer.
- suggestedScope is "project" unless there is a clear reason otherwise.

Rules for "gaps" — skills that do NOT exist and would have to be written:
- At most 3, and only where the need is specific to this project and genuinely unmet by the list.
- Do not restate something already covered by a proposal.
- "name" must be kebab-case: lowercase letters and digits separated by single hyphens. It must not
  contain the words "claude" or "anthropic", which are reserved.
- Return an empty list if the listed skills cover this project well. That is the common case.

Keep every reason and purpose to one sentence.`

function renderCandidates(candidates: SkillCandidate[]): string {
  return candidates
    .map(
      (c, i) =>
        `${i + 1}. ${c.qualifiedName}\n   ${c.description}\n   (found by: ${c.matchedQueries.join(', ')})`
    )
    .join('\n')
}

/**
 * Choose from what the registry actually returned.
 *
 * Every proposal is checked back against the pool by qualified name, and anything not found is
 * dropped. That check is the whole point: without it this is the old behaviour with extra steps,
 * since a model given a list can still produce a name that is not on it.
 *
 * Note what the prompt does *not* say: nothing about preferring verified skills. The tier is
 * effectively absent from search results — zero verified skills appeared in the top 15 for any of
 * five ordinary queries, and a fan-out of eight returned 64 candidates with none verified — so
 * instructing the model to prefer them would be instructing it to select on a feature the pool
 * does not contain.
 */
export async function selectSkills(
  context: string,
  candidates: SkillCandidate[],
  options: { complete?: Complete } = {}
): Promise<SelectionResult> {
  requireContext(context)
  if (candidates.length === 0) return { proposals: [], gaps: [] }

  const complete = options.complete ?? defaultComplete
  const reply = await complete(
    SELECTION_SYSTEM_PROMPT,
    `Project context:\n\n${context}\n\nSkills available in the registry:\n\n${renderCandidates(
      candidates.slice(0, MAX_CANDIDATES_IN_PROMPT)
    )}\n\nWhich of these fit this project, and what is missing?`
  )

  const parsed = parseJsonReply<{ proposals?: unknown; gaps?: unknown }>(reply)
  const raw = Array.isArray(parsed.proposals) ? parsed.proposals : []

  const byName = new Map(candidates.map((c) => [c.qualifiedName, c]))
  const chosen: SuggestionProposal[] = []
  const seen = new Set<string>()

  for (const entry of raw) {
    if (typeof entry !== 'object' || entry === null) continue
    const { qualifiedName, reason, suggestedScope } = entry as Record<string, unknown>
    if (typeof qualifiedName !== 'string') continue

    const candidate = byName.get(qualifiedName)
    // Not in the pool: invented, mangled, or hallucinated back into a bare name. Drop it.
    if (!candidate || seen.has(qualifiedName)) continue
    seen.add(qualifiedName)

    chosen.push({
      qualifiedName: candidate.qualifiedName,
      name: candidate.name,
      owner: candidate.owner,
      reason: typeof reason === 'string' && reason.trim() ? reason.trim() : candidate.description,
      suggestedScope: isScope(suggestedScope) ? suggestedScope : 'project',
      trustTier: candidate.trustTier,
      score: candidate.score,
      sourceUrl: candidate.sourceUrl,
    })

    if (chosen.length >= MAX_SELECTED) break
  }

  return { proposals: chosen, gaps: parseGaps(parsed.gaps, byName) }
}

/**
 * Skill names the validator will accept: kebab-case, and not reserved.
 *
 * Checked here rather than after generation because a gap with an invalid name produces a draft
 * that cannot pass validation however good its content is, and the failure would surface three
 * steps later attached to the wrong cause.
 */
const KEBAB_CASE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/
const RESERVED_NAME_WORDS = ['claude', 'anthropic']

function parseGaps(raw: unknown, existing: Map<string, SkillCandidate>): SkillGap[] {
  if (!Array.isArray(raw)) return []

  const gaps: SkillGap[] = []
  const seen = new Set<string>()

  for (const entry of raw) {
    if (typeof entry !== 'object' || entry === null) continue
    const { name, purpose, reason } = entry as Record<string, unknown>
    if (typeof name !== 'string') continue

    const slug = name.trim().toLowerCase()
    if (!KEBAB_CASE.test(slug)) continue
    if (RESERVED_NAME_WORDS.some((w) => slug.includes(w))) continue
    if (seen.has(slug)) continue

    // A "gap" that names something already in the pool is not a gap. The model has the list in
    // front of it and still occasionally proposes writing one of them.
    if ([...existing.values()].some((c) => c.name.toLowerCase() === slug)) continue

    seen.add(slug)
    gaps.push({
      name: slug,
      purpose: typeof purpose === 'string' ? purpose.trim() : '',
      reason: typeof reason === 'string' ? reason.trim() : '',
    })

    if (gaps.length >= MAX_GAPS) break
  }

  return gaps
}

function isScope(value: unknown): value is ScopeLevel {
  return value === 'project' || value === 'shared' || value === 'global'
}

// --- Call three: write the skill that does not exist yet ---

/**
 * What the validator enforces, stated to the model rather than discovered by failing.
 *
 * These are read off `src/core/validator.ts` and must track it. The 30-word description floor is
 * the one a generator reliably misses — a model writes a crisp one-line description because that
 * reads better, and scores zero on `description-length` for it.
 */
const DRAFT_SYSTEM_PROMPT = `You are writing a Claude Code skill: a single SKILL.md file.

A skill gives an AI coding agent a specific capability. It is read into the agent's context, so it
must be direct, concrete and free of filler.

Respond with the COMPLETE file content and nothing else — no code fence, no commentary.

The file must be exactly this shape:

---
name: kebab-case-name
description: "what it does and when the agent should use it"
version: "1.0.0"
tags: []
spec_version: "1.0"
---

# Title

The actual instructions the agent should follow.

Hard requirements — the file is rejected otherwise:
- YAML frontmatter first, opened and closed with ---
- name: lowercase letters and digits separated by single hyphens. Must not contain "claude" or
  "anthropic", which are reserved.
- description: AT LEAST 30 WORDS and at most 1024 characters. Say what the skill does and when to
  use it. A single short sentence will be rejected.
- The description MUST be wrapped in double quotes, and must not contain a double quote, a colon
  followed by a space, or angle brackets (< >). Unquoted punctuation makes the frontmatter
  unparseable and the whole file scores zero.
- The whole file must be under 400 lines.

Write instructions an agent can act on: concrete steps, rules and examples. Do not describe the
skill in the third person, and do not pad it to reach a length.`

/**
 * Generate the content of a SKILL.md for a gap.
 *
 * `diagnostics` carries validator errors from a previous attempt. Feeding them back is worth one
 * retry and no more: a model that has been told the description is 12 words and must be 30 will
 * usually fix it, and one that fails twice is failing for a reason another round will not reach.
 */
export async function generateSkillDraft(
  context: string,
  gap: SkillGap,
  options: { complete?: Complete; diagnostics?: string[] } = {}
): Promise<string> {
  requireContext(context)

  const complete = options.complete ?? defaultComplete
  const repair = options.diagnostics?.length
    ? `\n\nA previous attempt was REJECTED for these reasons. Fix every one:\n${options.diagnostics
        .map((d) => `- ${d}`)
        .join('\n')}`
    : ''

  const reply = await complete(
    DRAFT_SYSTEM_PROMPT,
    `Project context:\n\n${context}\n\nWrite a skill named "${gap.name}".\n` +
      `What it should do: ${gap.purpose}\n` +
      `Why this project needs it: ${gap.reason}${repair}`
  )

  return stripCodeFence(reply)
}

/**
 * Models wrap file content in a fence despite being told not to. Unwrap rather than reject: the
 * content is right and the envelope is cosmetic, and a rejection here costs another generation.
 */
function stripCodeFence(reply: string): string {
  const trimmed = reply.trim()
  const fenced = trimmed.match(/^```(?:markdown|md|yaml)?\n([\s\S]*?)\n?```$/)
  return (fenced ? fenced[1] : trimmed).trim() + '\n'
}

// --- The whole pipeline ---

/**
 * Total queries per run.
 *
 * A fan-out finishes when its slowest member does, so adding queries raises the chance of drawing
 * one from the slow tail — more queries costs latency even though they run concurrently. Ten is
 * the compromise between covering a project and finishing this decade.
 */
const MAX_TOTAL_QUERIES = 10

export interface SuggestionRun {
  profile: ProjectProfile
  pool: CandidatePool
  queries: {
    /** Derived from manifests with no model involved. */
    deterministic: string[]
    /** Proposed by the model from the project's prose. */
    proposed: string[]
    /** What was actually searched, after merging and capping. */
    used: string[]
  }
  proposals: SuggestionProposal[]
  /** Skills this project wants that the registry does not have. Often empty. */
  gaps: SkillGap[]
}

/**
 * Context in, installable proposals out: propose queries, search, then choose from what was found.
 *
 * Two model calls, not a tool-use loop, and the reason is latency rather than taste. A loop is a
 * sequence of fan-outs, each ending when its slowest query does — measured at 3.3s to 21s per
 * query with a tail at the platform's 30s ceiling. Two or three rounds of that is minutes of a
 * user watching a spinner. Two discrete calls bound the cost at one fan-out, and make the thing
 * testable offline besides.
 *
 * Model-proposed queries go in front of the deterministic ones when the cap bites. Dependency
 * names are reliable but describe what a project imports; the proposed terms describe what it
 * does, which is what someone is actually looking for a skill to help with.
 */
export async function suggestForProject(
  profile: ProjectProfile,
  options: {
    complete?: Complete
    search?: typeof import('../registry/sources/registry.js').searchRegistry
  } = {}
): Promise<SuggestionRun> {
  const { buildQueries, retrieveCandidates } = await import('./suggest-retrieval.js')

  const context = renderProjectContext(profile)
  const deterministic = buildQueries(profile)
  const proposed = await proposeQueries(context, options)

  const used: string[] = []
  const seen = new Set<string>()
  for (const query of [...proposed, ...deterministic]) {
    if (seen.has(query)) continue
    seen.add(query)
    used.push(query)
    if (used.length >= MAX_TOTAL_QUERIES) break
  }

  const pool = await retrieveCandidates(used, {
    installedSkills: profile.installedSkills,
    search: options.search,
  })

  const { proposals, gaps } = await selectSkills(context, pool.candidates, options)

  return { profile, pool, queries: { deterministic, proposed, used }, proposals, gaps }
}
