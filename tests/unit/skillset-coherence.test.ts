import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtemp, rm, writeFile, mkdir } from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import {
  checkSkillsetCoherence,
  parseDeclaredConventions,
  extractAssetReferences,
  parseMarkdownTables,
} from '../../src/core/skillset-coherence.js'

let tmpDir: string

beforeEach(async () => {
  tmpDir = await mkdtemp(path.join(os.tmpdir(), 'skilldex-coherence-test-'))
})

afterEach(async () => {
  await rm(tmpDir, { recursive: true, force: true })
})

// --- Fixture builder ---

const DECLARED_ASSET = `# Commit Conventions

Shared source of truth for this skillset.

\`\`\`yaml skilldex-conventions
commit-type-to-changelog-section:
  feat: Added
  fix: Fixed
  revert: Fixed
  refactor: Changed
  perf: Changed
  docs: omit
  chore: omit
\`\`\`

| Type | Use when | Changelog section |
|------|----------|------------------|
| \`feat\` | new feature | Added |
| \`fix\` | a bug | Fixed |
| \`perf\` | speed | Changed |
`

async function buildSkillset(opts: {
  asset?: string
  members: Record<string, string>
}): Promise<string[]> {
  if (opts.asset !== undefined) {
    await mkdir(path.join(tmpDir, 'assets'), { recursive: true })
    await writeFile(path.join(tmpDir, 'assets', 'commit-conventions.md'), opts.asset)
  }
  for (const [name, content] of Object.entries(opts.members)) {
    await mkdir(path.join(tmpDir, name), { recursive: true })
    await writeFile(path.join(tmpDir, name, 'SKILL.md'), content)
  }
  return Object.keys(opts.members)
}

function member(body: string): string {
  return `---\nname: m\ndescription: d\n---\n\n${body}\n`
}

// --- Unit: declaration parsing ---

describe('parseDeclaredConventions', () => {
  it('extracts a mapping from a tagged fence', () => {
    const conventions = parseDeclaredConventions(DECLARED_ASSET, 'assets/commit-conventions.md')
    expect(conventions).toHaveLength(1)
    expect(conventions[0].name).toBe('commit-type-to-changelog-section')
    expect(conventions[0].mapping.feat).toBe('Added')
    expect(conventions[0].mapping.docs).toBe('omit')
    expect(conventions[0].assetFile).toBe('assets/commit-conventions.md')
  })

  it('reports the 1-indexed line of the declaring fence', () => {
    const conventions = parseDeclaredConventions(DECLARED_ASSET, 'a.md')
    expect(DECLARED_ASSET.split('\n')[conventions[0].line - 1]).toContain('skilldex-conventions')
  })

  it('ignores untagged code fences', () => {
    const content = '```yaml\nfeat: Added\n```\n'
    expect(parseDeclaredConventions(content, 'a.md')).toHaveLength(0)
  })

  it('ignores an unclosed fence', () => {
    const content = '```yaml skilldex-conventions\nfoo:\n  a: b\n'
    expect(parseDeclaredConventions(content, 'a.md')).toHaveLength(0)
  })

  it('ignores malformed YAML rather than throwing', () => {
    const content = '```yaml skilldex-conventions\n  : : :\n```\n'
    expect(() => parseDeclaredConventions(content, 'a.md')).not.toThrow()
  })

  it('reads several conventions from one block', () => {
    const content =
      '```yaml skilldex-conventions\nfirst:\n  a: X\n  b: Y\nsecond:\n  c: Z\n  d: W\n```\n'
    const conventions = parseDeclaredConventions(content, 'a.md')
    expect(conventions.map((c) => c.name)).toEqual(['first', 'second'])
  })

  it('skips nested (non-flat) values', () => {
    const content = '```yaml skilldex-conventions\nnested:\n  a:\n    deep: 1\n```\n'
    expect(parseDeclaredConventions(content, 'a.md')).toHaveLength(0)
  })
})

// --- Unit: reference extraction ---

describe('extractAssetReferences', () => {
  it('separates skillset-level from member-local references', () => {
    const refs = extractAssetReferences(
      'Load `../assets/shared.md` then `assets/local.md` and `references/guide.md`.'
    )
    expect(refs.map((r) => [r.rawPath, r.isSkillsetLevel])).toEqual([
      ['../assets/shared.md', true],
      ['assets/local.md', false],
      ['references/guide.md', false],
    ])
  })

  it('deduplicates repeated references but keeps the first line', () => {
    const refs = extractAssetReferences('x `../assets/a.md`\ny\nz `../assets/a.md`')
    expect(refs).toHaveLength(1)
    expect(refs[0].line).toBe(1)
  })

  it('ignores prose that is not a backticked path', () => {
    expect(extractAssetReferences('see the assets/ directory')).toHaveLength(0)
  })
})

// --- Unit: table parsing ---

describe('parseMarkdownTables', () => {
  it('parses header and rows', () => {
    const tables = parseMarkdownTables('| A | B |\n|---|---|\n| 1 | 2 |\n| 3 | 4 |\n')
    expect(tables).toHaveLength(1)
    expect(tables[0].header).toEqual(['A', 'B'])
    expect(tables[0].rows).toEqual([
      ['1', '2'],
      ['3', '4'],
    ])
  })

  it('parses multiple tables separated by prose', () => {
    const content = '| A | B |\n|---|---|\n| 1 | 2 |\n\ntext\n\n| C | D |\n|---|---|\n| 3 | 4 |\n'
    expect(parseMarkdownTables(content)).toHaveLength(2)
  })

  it('requires a separator row', () => {
    expect(parseMarkdownTables('| A | B |\n| 1 | 2 |\n')).toHaveLength(0)
  })
})

// --- Integration: agreement ---

describe('checkSkillsetCoherence — agreement', () => {
  it('passes a member that restates the convention consistently', async () => {
    const members = await buildSkillset({
      asset: DECLARED_ASSET,
      members: {
        'changelog-gen': member(
          'Load `../assets/commit-conventions.md`.\n\n' +
            '| Commit type | Changelog section |\n|---|---|\n' +
            '| `feat` | Added |\n| `fix`, `revert` | Fixed |\n| `perf` | Changed |\n'
        ),
      },
    })

    const result = await checkSkillsetCoherence(tmpDir, members)
    expect(result.errorCount).toBe(0)
    expect(result.membersCoherent).toBe(1)
  })

  it('reports an error when a member contradicts the declaration', async () => {
    const members = await buildSkillset({
      asset: DECLARED_ASSET,
      members: {
        'changelog-gen': member(
          'Load `../assets/commit-conventions.md`.\n\n' +
            '| Commit type | Changelog section |\n|---|---|\n' +
            '| `feat` | Added |\n| `fix` | Fixed |\n| `perf` | Added |\n'
        ),
      },
    })

    const result = await checkSkillsetCoherence(tmpDir, members)
    const contradictions = result.diagnostics.filter(
      (d) => d.severity === 'error' && d.check === 'shared-asset-agreement'
    )
    expect(contradictions).toHaveLength(1)
    expect(contradictions[0].key).toBe('perf')
    expect(contradictions[0].declaredValue).toBe('Changed')
    expect(contradictions[0].memberValue).toBe('Added')
    expect(result.membersCoherent).toBe(0)
  })

  it('does NOT flag equivalent prose for the same rule', async () => {
    // "— (omit from changelog)" and "omit" are the same rule written differently. Reporting
    // this as a contradiction would make the check fire on correct skillsets.
    const members = await buildSkillset({
      asset: DECLARED_ASSET,
      members: {
        'changelog-gen': member(
          'Load `../assets/commit-conventions.md`.\n\n' +
            '| Commit type | Changelog section |\n|---|---|\n' +
            '| `feat` | Added |\n| `fix` | Fixed |\n| `docs` | — (omit from changelog) |\n'
        ),
      },
    })

    const result = await checkSkillsetCoherence(tmpDir, members)
    expect(result.errorCount).toBe(0)
  })

  it('warns rather than errors on phrasing it cannot resolve', async () => {
    const members = await buildSkillset({
      asset: DECLARED_ASSET,
      members: {
        'changelog-gen': member(
          'Load `../assets/commit-conventions.md`.\n\n' +
            '| Commit type | Changelog section |\n|---|---|\n' +
            '| `feat` | Added |\n| `fix` | Fixed |\n| `perf` | Whatever The Author Felt Like |\n'
        ),
      },
    })

    const result = await checkSkillsetCoherence(tmpDir, members)
    expect(result.errorCount).toBe(0)
    expect(
      result.diagnostics.filter(
        (d) => d.severity === 'warning' && d.check === 'shared-asset-agreement'
      )
    ).toHaveLength(1)
  })

  it('ignores a member table that merely shares one key', async () => {
    const members = await buildSkillset({
      asset: DECLARED_ASSET,
      members: {
        'other-skill': member(
          'Load `../assets/commit-conventions.md`.\n\n' +
            '| Flag | Meaning |\n|---|---|\n| `feat` | unrelated |\n| `--verbose` | noisy |\n'
        ),
      },
    })

    const result = await checkSkillsetCoherence(tmpDir, members)
    expect(
      result.diagnostics.filter((d) => d.check === 'shared-asset-agreement')
    ).toHaveLength(0)
  })

  it('finds the value column in a table with more than two columns', async () => {
    const members = await buildSkillset({
      asset: DECLARED_ASSET,
      members: {
        'changelog-gen': member(
          'Load `../assets/commit-conventions.md`.\n\n' +
            '| Type | Notes | Section |\n|---|---|---|\n' +
            '| `feat` | anything | Added |\n| `perf` | anything | Added |\n'
        ),
      },
    })

    const result = await checkSkillsetCoherence(tmpDir, members)
    const errors = result.diagnostics.filter((d) => d.severity === 'error')
    expect(errors).toHaveLength(1)
    expect(errors[0].key).toBe('perf')
  })
})

// --- Integration: reference checks ---

describe('checkSkillsetCoherence — references', () => {
  it('warns when a member reaches for no shared asset', async () => {
    const members = await buildSkillset({
      asset: DECLARED_ASSET,
      members: { 'test-writer': member('Load `references/testing-patterns.md`.') },
    })

    const result = await checkSkillsetCoherence(tmpDir, members)
    expect(
      result.diagnostics.filter((d) => d.check === 'shared-asset-referenced' && d.severity === 'warning')
    ).toHaveLength(1)
    expect(result.membersCoherent).toBe(0)
  })

  it('errors on a shared asset path that does not resolve', async () => {
    const members = await buildSkillset({
      asset: DECLARED_ASSET,
      members: { 'changelog-gen': member('Load `../assets/renamed-away.md`.') },
    })

    const result = await checkSkillsetCoherence(tmpDir, members)
    const errors = result.diagnostics.filter((d) => d.check === 'shared-asset-resolvable')
    expect(errors).toHaveLength(1)
    expect(errors[0].severity).toBe('error')
  })

  it('says nothing about references when the skillset has no shared assets', async () => {
    const members = await buildSkillset({
      members: { solo: member('No shared anything here.') },
    })

    const result = await checkSkillsetCoherence(tmpDir, members)
    expect(
      result.diagnostics.filter((d) => d.check === 'shared-asset-referenced')
    ).toHaveLength(0)
  })
})

// --- Integration: undeclared conventions ---

describe('checkSkillsetCoherence — undeclared conventions', () => {
  it('warns when a member duplicates an asset table nobody declared', async () => {
    const undeclaredAsset = `# Conventions

| Type | Changelog section |
|------|------------------|
| \`feat\` | Added |
| \`fix\` | Fixed |
| \`perf\` | Changed |
`
    const members = await buildSkillset({
      asset: undeclaredAsset,
      members: {
        'changelog-gen': member(
          'Load `../assets/commit-conventions.md`.\n\n' +
            '| Commit type | Changelog section |\n|---|---|\n' +
            '| `feat` | Added |\n| `fix` | Fixed |\n'
        ),
      },
    })

    const result = await checkSkillsetCoherence(tmpDir, members)
    const warnings = result.diagnostics.filter((d) => d.check === 'undeclared-convention')
    expect(warnings).toHaveLength(1)
    expect(warnings[0].severity).toBe('warning')
  })

  it('stays quiet once the convention is declared', async () => {
    const members = await buildSkillset({
      asset: DECLARED_ASSET,
      members: {
        'changelog-gen': member(
          'Load `../assets/commit-conventions.md`.\n\n' +
            '| Commit type | Changelog section |\n|---|---|\n' +
            '| `feat` | Added |\n| `fix` | Fixed |\n'
        ),
      },
    })

    const result = await checkSkillsetCoherence(tmpDir, members)
    expect(result.diagnostics.filter((d) => d.check === 'undeclared-convention')).toHaveLength(0)
  })
})
