// Grounding suggestions in the registry: propose queries, search, choose from what was found.
//
// The defect being closed is that `suggest` never consulted the registry at all. It asked a model
// for skill names, the model produced plausible kebab-cased ones, and every proposal was stamped
// `available: true` by a hardcoded literal. Nothing existed and nothing could be installed.
//
// So the tests that matter here are the ones about not trusting the model: a proposed query that
// is a phrase cannot survive conjunctive retrieval, and a selected name that is not in the pool is
// the original bug wearing a costume. Both are checked by feeding a deliberately misbehaving model.
//
// The completion function is injected, so none of this needs an API key, a network, or inference.

import { describe, it, expect, vi } from 'vitest'
import {
  proposeQueries,
  selectSkills,
  suggestForProject,
  type Complete,
} from '../../src/core/suggest-agent.js'
import type { ProjectProfile } from '../../src/core/project-context.js'
import type { SkillCandidate } from '../../src/core/suggest-retrieval.js'
import type { RegistrySkill } from '../../src/registry/sources/registry.js'

const CONTEXT = '## Project\nRoot: billing-api\nLanguages: TypeScript (40 files)'

/** A model that always replies with the given text, whatever it is asked. */
const replying = (text: string): Complete => vi.fn(async () => text)

/** A model that replies differently to the query call and the selection call. */
function scripted(queries: string, selection: string): Complete {
  return vi.fn(async (system: string) =>
    system.includes('propose search terms') || system.includes('search terms') ? queries : selection
  )
}

function candidate(over: Partial<SkillCandidate> = {}): SkillCandidate {
  return {
    qualifiedName: 'mauromedda/terraform',
    name: 'terraform',
    owner: 'mauromedda',
    description: 'Production-quality Terraform.',
    trustTier: 'community',
    score: 93,
    installCount: 0,
    sourceUrl: 'https://github.com/mauromedda/agent-toolkit',
    matchedQueries: ['terraform'],
    bestRank: 0,
    ...over,
  }
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

describe('proposing queries', () => {
  it('accepts single searchable tokens', async () => {
    const complete = replying('{"queries": ["changelog", "terraform", "latex"]}')

    expect(await proposeQueries(CONTEXT, { complete })).toEqual([
      'changelog',
      'terraform',
      'latex',
    ])
  })

  it('drops phrases, because retrieval ANDs every word', async () => {
    // `commit` matches 10,000 skills and `help me write a conventional commit` matches 30. A model
    // asked for search terms will return phrases regardless of instructions, so they are filtered
    // rather than sent.
    const complete = replying(
      '{"queries": ["conventional commits", "changelog", "how to write a good PR"]}'
    )

    expect(await proposeQueries(CONTEXT, { complete })).toEqual(['changelog'])
  })

  it('normalises case rather than discarding capitalised terms', async () => {
    // Discriminating on its own: the searchable-term pattern is lowercase-only, so without
    // normalisation `Terraform` fails it and is dropped rather than searched. A list that also
    // contained a lowercase copy would hide that — the copy would survive and the result would
    // look right.
    const complete = replying('{"queries": ["Terraform", "Docker"]}')

    expect(await proposeQueries(CONTEXT, { complete })).toEqual(['terraform', 'docker'])
  })

  it('removes duplicates that differ only in case', async () => {
    const complete = replying('{"queries": ["Terraform", "terraform", "TERRAFORM", "docker"]}')

    expect(await proposeQueries(CONTEXT, { complete })).toEqual(['terraform', 'docker'])
  })

  it('caps how many it will take', async () => {
    const many = Array.from({ length: 20 }, (_, i) => `term${i}`)
    const complete = replying(JSON.stringify({ queries: many }))

    expect(await proposeQueries(CONTEXT, { complete })).toHaveLength(6)
  })

  it('survives a reply wrapped in prose or a code fence', async () => {
    const complete = replying('Sure!\n```json\n{"queries": ["changelog"]}\n```\nHope that helps.')

    expect(await proposeQueries(CONTEXT, { complete })).toEqual(['changelog'])
  })

  it('returns nothing when the model returns nothing usable', async () => {
    expect(await proposeQueries(CONTEXT, { complete: replying('{"queries": []}') })).toEqual([])
    expect(await proposeQueries(CONTEXT, { complete: replying('{"other": 1}') })).toEqual([])
  })

  it('refuses to run without project context', async () => {
    const complete = replying('{"queries": ["anything"]}')

    await expect(proposeQueries('   ', { complete })).rejects.toThrow(/no project context/i)
    expect(complete).not.toHaveBeenCalled()
  })
})

describe('selecting from the pool', () => {
  it('takes every field but the reason from the registry record', async () => {
    // The model supplies its own values for fields it has no business setting. All of them must be
    // ignored in favour of the pool entry — `sourceUrl` above all, since that is what gets cloned
    // and installed. Only the reason is the model's to write.
    const complete = replying(
      JSON.stringify({
        proposals: [
          {
            qualifiedName: 'mauromedda/terraform',
            reason: 'IaC in this repo',
            suggestedScope: 'project',
            sourceUrl: 'https://elsewhere.example/not-the-registry',
            score: 100,
            trustTier: 'verified',
            owner: 'someone-else',
            name: 'something-else',
          },
        ],
      })
    )

    const [proposal] = await selectSkills(CONTEXT, [candidate()], { complete })

    expect(proposal).toEqual({
      qualifiedName: 'mauromedda/terraform',
      name: 'terraform',
      owner: 'mauromedda',
      reason: 'IaC in this repo',
      suggestedScope: 'project',
      trustTier: 'community',
      score: 93,
      sourceUrl: 'https://github.com/mauromedda/agent-toolkit',
    })
  })

  it('drops a name that is not in the pool', async () => {
    // The original bug: a confident, plausible, non-existent skill. Being handed a list is not the
    // same as being constrained to it.
    const complete = replying(
      '{"proposals": [{"qualifiedName": "acme/invented-skill", "reason": "made up"}]}'
    )

    expect(await selectSkills(CONTEXT, [candidate()], { complete })).toEqual([])
  })

  it('drops a bare name even when a skill of that name is in the pool', async () => {
    // `terraform` is claimed by ten owners, so the bare form identifies nothing and would 409 on
    // install. Reattaching it to an arbitrary pool entry would pick an owner at random.
    const complete = replying('{"proposals": [{"qualifiedName": "terraform", "reason": "IaC"}]}')

    expect(await selectSkills(CONTEXT, [candidate()], { complete })).toEqual([])
  })

  it('keeps the valid choices when only some are invented', async () => {
    const complete = replying(
      '{"proposals": [' +
        '{"qualifiedName": "acme/invented", "reason": "no"},' +
        '{"qualifiedName": "mauromedda/terraform", "reason": "yes"}]}'
    )

    const chosen = await selectSkills(CONTEXT, [candidate()], { complete })

    expect(chosen.map((c) => c.qualifiedName)).toEqual(['mauromedda/terraform'])
  })

  it('deduplicates a name chosen twice', async () => {
    const complete = replying(
      '{"proposals": [' +
        '{"qualifiedName": "mauromedda/terraform", "reason": "one"},' +
        '{"qualifiedName": "mauromedda/terraform", "reason": "two"}]}'
    )

    expect(await selectSkills(CONTEXT, [candidate()], { complete })).toHaveLength(1)
  })

  it('falls back to the registry description when no reason is given', async () => {
    const complete = replying('{"proposals": [{"qualifiedName": "mauromedda/terraform"}]}')

    const [proposal] = await selectSkills(CONTEXT, [candidate()], { complete })

    expect(proposal.reason).toBe('Production-quality Terraform.')
  })

  it('defaults an invalid scope to project rather than passing it on', async () => {
    const complete = replying(
      '{"proposals": [{"qualifiedName": "mauromedda/terraform", "suggestedScope": "everywhere"}]}'
    )

    const [proposal] = await selectSkills(CONTEXT, [candidate()], { complete })

    expect(proposal.suggestedScope).toBe('project')
  })

  it('honours a valid non-default scope', async () => {
    const complete = replying(
      '{"proposals": [{"qualifiedName": "mauromedda/terraform", "suggestedScope": "global"}]}'
    )

    const [proposal] = await selectSkills(CONTEXT, [candidate()], { complete })

    expect(proposal.suggestedScope).toBe('global')
  })

  it('accepts an empty selection as a real answer', async () => {
    // "None of these fit" is useful and must not be turned into a suggestion.
    const complete = replying('{"proposals": []}')

    expect(await selectSkills(CONTEXT, [candidate()], { complete })).toEqual([])
  })

  it('does not call the model at all when the pool is empty', async () => {
    const complete = replying('{"proposals": []}')

    expect(await selectSkills(CONTEXT, [], { complete })).toEqual([])
    expect(complete).not.toHaveBeenCalled()
  })

  it('never tells the model to prefer verified skills', async () => {
    // Zero verified skills appeared in the top 15 for any of five ordinary queries, and a fan-out
    // of eight returned 64 candidates with none verified. Instructing a preference for them would
    // be selecting on a feature the pool does not contain.
    const complete = vi.fn(async () => '{"proposals": []}')

    await selectSkills(CONTEXT, [candidate()], { complete })

    const [system] = complete.mock.calls[0]
    expect(system.toLowerCase()).not.toContain('verified')
  })
})

describe('the whole pipeline', () => {
  function fakeSearch(table: Record<string, RegistrySkill[]>) {
    return vi.fn(async (opts: { q?: string }) => {
      const skills = table[opts.q ?? ''] ?? []
      return { skills, total: skills.length, limit: 10, offset: 0 }
    })
  }

  const registrySkill = (over: Partial<RegistrySkill> = {}): RegistrySkill => ({
    name: 'changelog-writer',
    owner: 'acme',
    qualified_name: 'acme/changelog-writer',
    description: 'Writes changelogs.',
    author: 'acme',
    source_url: 'https://github.com/acme/skills',
    trust_tier: 'community',
    score: 90,
    spec_version: '1.0',
    tags: [],
    install_count: 0,
    published_at: '2026-09-09T00:00:00.000Z',
    ...over,
  })

  it('searches for model-proposed terms as well as manifest keywords', async () => {
    const search = fakeSearch({ changelog: [registrySkill()], express: [] })
    const complete = scripted(
      '{"queries": ["changelog"]}',
      '{"proposals": [{"qualifiedName": "acme/changelog-writer", "reason": "fits"}]}'
    )

    const run = await suggestForProject(profile({ keywords: ['express'] }), { complete, search })

    expect(run.queries.proposed).toEqual(['changelog'])
    expect(run.queries.deterministic).toEqual(['express'])
    expect(run.queries.used.sort()).toEqual(['changelog', 'express'])
    expect(run.proposals.map((p) => p.qualifiedName)).toEqual(['acme/changelog-writer'])
  })

  it('puts model-proposed terms first when the cap bites', async () => {
    // Dependency names describe what a project imports; the proposed terms describe what it does,
    // which is what someone wants a skill for. When something has to be dropped, drop the former.
    const search = fakeSearch({})
    const complete = scripted(
      '{"queries": ["latex", "citations", "figures"]}',
      '{"proposals": []}'
    )

    const run = await suggestForProject(
      profile({ keywords: Array.from({ length: 12 }, (_, i) => `dep${i}`) }),
      { complete, search }
    )

    expect(run.queries.used).toHaveLength(10)
    expect(run.queries.used.slice(0, 3)).toEqual(['latex', 'citations', 'figures'])
  })

  it('still works when the model proposes no queries', async () => {
    const search = fakeSearch({ express: [registrySkill()] })
    const complete = scripted(
      '{"queries": []}',
      '{"proposals": [{"qualifiedName": "acme/changelog-writer", "reason": "fits"}]}'
    )

    const run = await suggestForProject(profile({ keywords: ['express'] }), { complete, search })

    expect(run.queries.used).toEqual(['express'])
    expect(run.proposals).toHaveLength(1)
  })

  it('reports the failed searches alongside the proposals', async () => {
    const search = vi.fn(async (opts: { q?: string }) => {
      if (opts.q === 'express') throw new Error('Registry error 504')
      return { skills: [registrySkill()], total: 1, limit: 10, offset: 0 }
    })
    const complete = scripted(
      '{"queries": ["changelog"]}',
      '{"proposals": [{"qualifiedName": "acme/changelog-writer", "reason": "fits"}]}'
    )

    const run = await suggestForProject(profile({ keywords: ['express'] }), {
      complete,
      search: search as never,
    })

    expect(run.pool.queries.find((q) => q.query === 'express')?.status).toBe('failed')
    expect(run.proposals).toHaveLength(1)
  })

  it('excludes skills the project already has', async () => {
    const search = fakeSearch({ express: [registrySkill({ name: 'changelog-writer' })] })
    const complete = scripted('{"queries": []}', '{"proposals": []}')

    const run = await suggestForProject(
      profile({ keywords: ['express'], installedSkills: ['changelog-writer'] }),
      { complete, search }
    )

    expect(run.pool.candidates).toEqual([])
    expect(run.pool.alreadyInstalled).toBe(1)
  })
})
