/**
 * skilldex's half of the shared conformance corpus.
 *
 * skilldex is the reference implementation: manifest.json records what THIS repo scores
 * each fixture. skilldex-registry vendors the same file and asserts its independent
 * validators reproduce every number. If either implementation drifts, the side that
 * drifted fails.
 *
 * This test therefore has two jobs. It pins skilldex's own scoring against accidental
 * change, and it proves the manifest still describes reality — so a stale manifest cannot
 * silently become the contract the registry is checked against.
 *
 * Regenerate with: npx tsx tests/conformance-corpus/generate.ts
 * Then copy manifest.json to ../Skilldex-registry/tests/conformance-corpus/.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import path from 'node:path'
import { validateSkill } from '../../src/core/validator.js'
import { validateSkillset } from '../../src/core/skillset-validator.js'

const CORPUS = path.join(import.meta.dirname, '..', 'conformance-corpus')
const FIXTURES = path.join(import.meta.dirname, '..', 'fixtures')

const manifest = JSON.parse(readFileSync(path.join(CORPUS, 'manifest.json'), 'utf8')) as {
  formatVersion: number
  skills: Array<{ id: string; skillMd: string; files: string[]; expectedScore: number }>
  skillsets: Array<{
    id: string
    skillsetMd: string
    files: string[]
    embeddedSkillNames: string[]
    remoteSkillRefs: Array<{ name: string; source_url: string }>
    expectedScore: number
    blobs: Record<string, string>
    expectedCoherence: {
      membersChecked: number
      membersCoherent: number
      passCount: number
      warnCount: number
      errorCount: number
      declaredConventions: number
    } | null
  }>
}

describe('conformance corpus — skilldex side', () => {
  it('is the expected format version', () => {
    expect(manifest.formatVersion).toBe(2)
  })

  it('covers every fixture directory, so new fixtures cannot be silently omitted', () => {
    const onDisk = readdirSync(FIXTURES)
      .filter((n) => statSync(path.join(FIXTURES, n)).isDirectory())
      .sort()
    const inManifest = [
      ...manifest.skills.map((c) => c.id),
      ...manifest.skillsets.map((c) => c.id),
    ].sort()

    expect(inManifest).toEqual(onDisk)
  })

  for (const c of manifest.skills) {
    it(`skill ${c.id} scores ${c.expectedScore}`, async () => {
      const result = await validateSkill(path.join(FIXTURES, c.id))
      expect(result.score).toBe(c.expectedScore)
    })
  }

  for (const c of manifest.skillsets) {
    it(`skillset ${c.id} scores ${c.expectedScore}`, async () => {
      const result = await validateSkillset(path.join(FIXTURES, c.id))
      expect(result.score).toBe(c.expectedScore)
    })

    it(`skillset ${c.id} coheres as recorded`, async () => {
      const { coherence } = await validateSkillset(path.join(FIXTURES, c.id))
      expect({
        membersChecked: coherence.membersChecked,
        membersCoherent: coherence.membersCoherent,
        passCount: coherence.passCount,
        warnCount: coherence.warnCount,
        errorCount: coherence.errorCount,
        declaredConventions: coherence.declaredConventions.length,
      }).toEqual(c.expectedCoherence)
    })
  }

  it('exercises agreement, not just structure', () => {
    // Every structural fixture happens to be fully coherent, so pinning only those would let the
    // registry reproduce "all zeros" and look correct while implementing agreement wrongly. The
    // corpus needs at least one skillset whose members genuinely contradict a declared
    // convention, and one that genuinely honours it.
    const withConventions = manifest.skillsets.filter(
      (c) => (c.expectedCoherence?.declaredConventions ?? 0) > 0
    )
    expect(withConventions.length).toBeGreaterThan(0)
    expect(withConventions.some((c) => (c.expectedCoherence?.errorCount ?? 0) > 0)).toBe(true)
    expect(
      withConventions.some(
        (c) =>
          c.expectedCoherence !== null &&
          c.expectedCoherence.errorCount === 0 &&
          c.expectedCoherence.membersChecked > 0 &&
          c.expectedCoherence.membersCoherent === c.expectedCoherence.membersChecked
      )
    ).toBe(true)
  })

  it('separates conformance from coherence', () => {
    // The two fixtures that differ only in whether their members agree must score identically
    // on structure. If a coherence failure moved the conformance score, the split this whole
    // design rests on would be a fiction.
    const coherent = manifest.skillsets.find((c) => c.id === 'coherent-skillset')
    const incoherent = manifest.skillsets.find((c) => c.id === 'incoherent-skillset')

    expect(coherent?.expectedScore).toBe(incoherent?.expectedScore)
    expect(coherent?.expectedCoherence?.errorCount).toBe(0)
    expect(incoherent?.expectedCoherence?.errorCount).toBeGreaterThan(0)
  })

  it('records the content the registry validates, not just the score', () => {
    // The registry's validators are pure functions over content — they never read a
    // filesystem. If the manifest lost these fields the registry side would silently
    // validate nothing.
    for (const c of manifest.skills) {
      expect(c.skillMd.length).toBeGreaterThan(0)
      expect(Array.isArray(c.files)).toBe(true)
    }
    for (const c of manifest.skillsets) {
      expect(c.skillsetMd.length).toBeGreaterThan(0)
      expect(Array.isArray(c.embeddedSkillNames)).toBe(true)
    }
  })

  it('embeds content matching the fixture on disk', () => {
    // Guards the other staleness direction: a fixture edited without regenerating.
    for (const c of manifest.skills) {
      const onDisk = readFileSync(path.join(FIXTURES, c.id, 'SKILL.md'), 'utf8')
      expect(c.skillMd.replace(/\r\n/g, '\n')).toBe(onDisk.replace(/\r\n/g, '\n'))
    }
    for (const c of manifest.skillsets) {
      const onDisk = readFileSync(path.join(FIXTURES, c.id, 'SKILLSET.md'), 'utf8')
      expect(c.skillsetMd.replace(/\r\n/g, '\n')).toBe(onDisk.replace(/\r\n/g, '\n'))
    }
  })

  it('embeds every member and shared asset a coherence check reads', () => {
    // These are the only files coherence opens. If one is missing from the manifest the registry
    // silently checks a smaller skillset than skilldex did and still agrees on the totals, which
    // is exactly the kind of false agreement the corpus exists to prevent.
    for (const c of manifest.skillsets) {
      const needed = c.files.filter((f) => {
        const parts = f.split('/')
        if (parts.length === 2 && parts[1] === 'SKILL.md') return true
        return parts.length === 2 && parts[0] === 'assets' && parts[1].endsWith('.md')
      })

      expect(Object.keys(c.blobs).sort()).toEqual(needed.sort())

      for (const [rel, content] of Object.entries(c.blobs)) {
        const onDisk = readFileSync(path.join(FIXTURES, c.id, ...rel.split('/')), 'utf8')
        expect(content.replace(/\r\n/g, '\n')).toBe(onDisk.replace(/\r\n/g, '\n'))
      }
    }
  })
})
