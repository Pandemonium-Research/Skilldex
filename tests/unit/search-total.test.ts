// How search reports how many results there are.
//
// The registry stops counting at a cap — 1,000 since its decision D27 — and says so with
// `total_relation: "gte"`: `total` is then a floor, not a count. The CLI ignored the relation and
// printed the number, so a search matching tens of thousands of skills read "Found 1000 skills", a
// total nobody computed. These tests pin both halves: a capped count reads "1,000+", and an exact
// one — or one from a registry too old to send a relation — reads as the plain number.

import { stripVTControlCharacters } from 'node:util'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { Command } from 'commander'
import { registerSearch } from '../../src/cli/commands/search.js'
import { registerSkillset } from '../../src/cli/commands/skillset.js'
import { formatTotal, pluralFor } from '../../src/cli/ui/output.js'

let body: Record<string, unknown> = {}
let printed: string[] = []

const skill = {
  name: 'pdf-tools',
  owner: 'acme',
  qualified_name: 'acme/pdf-tools',
  description: 'Work with PDF files.',
  author: 'acme',
  source_url: 'https://github.com/acme/skills/tree/main/pdf-tools',
  trust_tier: 'community',
  score: 90,
  spec_version: '1.0',
  tags: [],
  install_count: 0,
  published_at: '2026-09-01T00:00:00.000Z',
  updated_at: '2026-09-01T00:00:00.000Z',
}

const skillset = {
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
  coherence: null,
}

beforeEach(() => {
  printed = []
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } }))
  )
  vi.spyOn(console, 'log').mockImplementation((...args: unknown[]) => {
    printed.push(stripVTControlCharacters(args.map(String).join(' ')))
  })
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

async function run(register: (p: Command) => void, argv: string[]) {
  const program = new Command()
  program.exitOverride()
  register(program)
  await program.parseAsync(argv, { from: 'user' })
  return printed.find((line) => line.includes('Found')) ?? ''
}

describe('formatTotal', () => {
  it('marks a capped count as a floor', () => {
    expect(formatTotal(1000, 'gte')).toBe('1,000+')
  })

  it('prints an exact count, or one with no relation, as the number', () => {
    expect(formatTotal(4261, 'eq')).toBe('4,261')
    expect(formatTotal(4261, undefined)).toBe('4,261')
  })

  it('never makes a capped count singular', () => {
    expect(pluralFor(1, 'eq', 'skill')).toBe('skill')
    expect(pluralFor(1, 'gte', 'skill')).toBe('skills')
    expect(pluralFor(1000, 'gte', 'skill')).toBe('skills')
  })
})

describe('skillpm search — the count it prints', () => {
  it('says "1,000+" when the registry stopped counting', async () => {
    body = { skills: [skill], total: 1000, total_relation: 'gte', has_more: true, limit: 10, offset: 0, max_offset: 1000 }
    expect(await run(registerSearch, ['search', 'pdf'])).toContain('Found 1,000+ skills for "pdf" (showing 1)')
  })

  it('prints an exact count as the number', async () => {
    body = { skills: [skill], total: 4261, total_relation: 'eq', has_more: true, limit: 10, offset: 0, max_offset: 1000 }
    expect(await run(registerSearch, ['search', 'pdf'])).toContain('Found 4,261 skills for "pdf"')
  })

  it('still reads a registry that sends no relation', async () => {
    body = { skills: [skill], total: 1, limit: 10, offset: 0 }
    expect(await run(registerSearch, ['search', 'pdf'])).toContain('Found 1 skill for "pdf"')
  })
})

describe('skillpm skillset search — the count it prints', () => {
  it('says "1,000+" when the registry stopped counting', async () => {
    body = { skillsets: [skillset], total: 1000, total_relation: 'gte', has_more: true, limit: 10, offset: 0 }
    expect(await run(registerSkillset, ['skillset', 'search', 'dev'])).toContain('Found 1,000+ skillsets for "dev"')
  })
})
