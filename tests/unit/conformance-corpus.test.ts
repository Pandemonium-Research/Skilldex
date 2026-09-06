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
  }>
}

describe('conformance corpus — skilldex side', () => {
  it('is the expected format version', () => {
    expect(manifest.formatVersion).toBe(1)
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
  }

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
})
