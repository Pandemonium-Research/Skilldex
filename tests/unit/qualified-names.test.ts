// Owner-qualified skill names — `owner/name` — through the registry client and `skillpm search`.
//
// Skill names are not unique in the registry. Measured against production: `terraform` is claimed
// by ten owners, and `GET /v1/skills/terraform/install` answers 409 AMBIGUOUS_NAME naming them and
// telling the caller to use `/skills/{owner}/terraform/install` instead.
//
// Both ways out of that were shut. The client escaped the whole name with encodeURIComponent, so
// `mauromedda/terraform` went out as `mauromedda%2Fterraform` and came back 404 "Skill not found"
// for a skill that answers 200 when the slash survives. And RegistrySkill declared no owner or
// qualified_name at all, so search printed ten identical rows with one identical install command
// underneath each.
//
// The URL assertions below are the point of this file: they are what a mocked fetch can prove and
// a type cannot.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { Command } from 'commander'
import { getSkill, getSkillInstallInfo, getSkillset } from '../../src/registry/sources/registry.js'
import { registerSearch } from '../../src/cli/commands/search.js'

let requested: string[] = []
let printed: string[] = []
let body: Record<string, unknown> = {}

function skill(over: Record<string, unknown> = {}) {
  return {
    name: 'terraform',
    owner: 'mauromedda',
    qualified_name: 'mauromedda/terraform',
    display_name: 'terraform',
    description: 'Guide for writing production-quality Terraform.',
    author: 'mauromedda',
    source_url: 'https://github.com/mauromedda/agent-toolkit/tree/HEAD/skills/terraform',
    trust_tier: 'community',
    score: 93,
    spec_version: '1.0',
    tags: [],
    install_count: 0,
    published_at: '2026-09-09T00:00:00.000Z',
    ...over,
  }
}

beforeEach(() => {
  requested = []
  printed = []
  body = { skills: [skill()], total: 1, limit: 10, offset: 0 }

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
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

const output = () => printed.join('\n')

describe('encoding a qualified skill name into the path', () => {
  it('keeps the owner separator a real path segment', async () => {
    await getSkillInstallInfo('mauromedda/terraform')

    expect(requested[0]).toContain('/skills/mauromedda/terraform/install')
    // The defect: %2F reaches no route and answers 404 for a skill that exists.
    expect(requested[0]).not.toContain('%2F')
    expect(requested[0]).not.toContain('%2f')
  })

  it('applies to the plain skill lookup too, not only to install', async () => {
    await getSkill('mauromedda/terraform')

    expect(requested[0]).toMatch(/\/skills\/mauromedda\/terraform$/)
  })

  it('leaves an unqualified name exactly as it was', async () => {
    await getSkillInstallInfo('terraform')

    expect(requested[0]).toContain('/skills/terraform/install')
  })

  it('still escapes characters inside a segment', async () => {
    // Only the separator is exempt. A space in a segment must not travel raw into the URL.
    await getSkill('some owner/odd name')

    expect(requested[0]).toContain('/skills/some%20owner/odd%20name')
  })

  it('does not treat a slash in a skillset name as an owner separator', async () => {
    // Skillsets are not owner-qualified — the registry sends no owner or qualified_name for them
    // — so splitting on the slash would build a URL it does not serve.
    body = { name: 'devset' }
    await getSkillset('a/b')

    expect(requested[0]).toContain('/skillsets/a%2Fb')
  })
})

describe('skillpm search — telling ten identical names apart', () => {
  async function run(argv: string[]) {
    const program = new Command()
    program.exitOverride()
    registerSearch(program)
    await program.parseAsync(argv, { from: 'user' })
  }

  it('titles a result by owner/name and offers an install command that resolves', async () => {
    await run(['search', 'terraform'])

    expect(output()).toContain('mauromedda/terraform')
    expect(output()).toContain('skillpm install mauromedda/terraform')
  })

  it('distinguishes two results that share a name', async () => {
    // The reported symptom: ten rows titled `terraform`, each suggesting the same install command,
    // which installs none of them.
    body = {
      skills: [
        skill(),
        skill({ owner: 'dennisonbertram', qualified_name: 'dennisonbertram/terraform', score: 94 }),
      ],
      total: 2,
      limit: 10,
      offset: 0,
    }

    await run(['search', 'terraform'])

    expect(output()).toContain('skillpm install mauromedda/terraform')
    expect(output()).toContain('skillpm install dennisonbertram/terraform')
  })

  it('falls back to the bare name when the registry sends no qualified name', async () => {
    // A deployment older than qualified names still has to render.
    body = {
      skills: [skill({ owner: undefined, qualified_name: undefined })],
      total: 1,
      limit: 10,
      offset: 0,
    }

    await run(['search', 'terraform'])

    expect(output()).toContain('skillpm install terraform')
  })

  it('builds owner/name itself when only the owner is sent', async () => {
    body = {
      skills: [skill({ qualified_name: undefined })],
      total: 1,
      limit: 10,
      offset: 0,
    }

    await run(['search', 'terraform'])

    expect(output()).toContain('skillpm install mauromedda/terraform')
  })
})
