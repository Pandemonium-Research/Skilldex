import { describe, it, expect } from 'vitest'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { validateSkillset } from '../../src/core/skillset-validator.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const fixtures = (name: string) => path.join(__dirname, '..', 'fixtures', name)

describe('validateSkillset', () => {
  it('gives a high score to a fully valid skillset', async () => {
    const result = await validateSkillset(fixtures('valid-skillset'))
    expect(result.score).toBeGreaterThanOrEqual(80)
    expect(result.errorCount).toBe(0)
    expect(result.skillset).toBe('valid-skillset')
  })

  it('discovers embedded skills automatically', async () => {
    const result = await validateSkillset(fixtures('valid-skillset'))
    expect(result.embeddedSkills).toContain('embedded-skill')
    expect(result.embeddedSkills).toHaveLength(1)
  })

  it('returns score 0 with fatal error when SKILLSET.md has no frontmatter', async () => {
    const result = await validateSkillset(fixtures('no-frontmatter-skillset'))
    expect(result.score).toBe(0)
    expect(result.errorCount).toBeGreaterThan(0)
    const diag = result.diagnostics.find((d) => d.check === 'yaml-frontmatter')
    expect(diag?.severity).toBe('error')
  })

  it('returns score 0 when path does not exist', async () => {
    const result = await validateSkillset('/nonexistent/path/to/skillset')
    expect(result.score).toBe(0)
    expect(result.errorCount).toBeGreaterThan(0)
  })

  it('warns, rather than errors, on a description shorter than 30 words', async () => {
    const result = await validateSkillset(fixtures('short-desc-skillset'))
    const diag = result.diagnostics.find((d) => d.check === 'description-length')
    expect(diag?.severity).toBe('warning')
    expect(diag?.message).toMatch(/too short/)
  })

  it('still errors on a missing description, although it shares the length check id', async () => {
    // The presence branch is tagged `description-length` as well. It must stay an error: an absent
    // description violates the specification, and `skillset install` refuses on errors — demote it
    // along with the length check and a skillset with no description at all becomes installable.
    const dir = await mkdtemp(path.join(os.tmpdir(), 'skilldex-no-desc-'))
    try {
      await writeFile(
        path.join(dir, 'SKILLSET.md'),
        '---\nname: no-desc\nversion: "1.0.0"\nspec_version: "1.1"\n---\n\n# no-desc\n',
        'utf8'
      )
      const result = await validateSkillset(dir)
      const diag = result.diagnostics.find(
        (d) => d.check === 'description-length' && /missing or empty/.test(d.message)
      )
      expect(diag?.severity).toBe('error')
      expect(result.errorCount).toBeGreaterThan(0)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('emits error when skillset has no embedded or remote skills', async () => {
    const result = await validateSkillset(fixtures('empty-skillset'))
    const diag = result.diagnostics.find((d) => d.check === 'has-skills')
    expect(diag?.severity).toBe('error')
    expect(diag?.message).toMatch(/at least one/)
  })

  it('emits warning for unknown top-level directory', async () => {
    const result = await validateSkillset(fixtures('bad-structure-skillset'))
    const diag = result.diagnostics.find((d) => d.check === 'allowed-subdirs')
    expect(diag?.severity).toBe('warning')
    expect(diag?.message).toMatch(/unknown-dir/)
  })

  it('does not flag assets/ as an unknown directory', async () => {
    const result = await validateSkillset(fixtures('valid-skillset'))
    const subDirWarnings = result.diagnostics.filter(
      (d) => d.check === 'allowed-subdirs' && d.severity === 'warning'
    )
    expect(subDirWarnings).toHaveLength(0)
  })

  it('gives full credit for valid-source-urls when there are no remote refs', async () => {
    const result = await validateSkillset(fixtures('valid-skillset'))
    const diag = result.diagnostics.find((d) => d.check === 'valid-source-urls')
    expect(diag?.severity).toBe('pass')
  })

  it('includes specVersion in result', async () => {
    const result = await validateSkillset(fixtures('valid-skillset'))
    expect(result.specVersion).toBe('1.1')
  })

  it('counts pass/warn/error correctly', async () => {
    const result = await validateSkillset(fixtures('valid-skillset'))
    expect(result.passCount).toBe(result.diagnostics.filter((d) => d.severity === 'pass').length)
    expect(result.warnCount).toBe(result.diagnostics.filter((d) => d.severity === 'warning').length)
    expect(result.errorCount).toBe(result.diagnostics.filter((d) => d.severity === 'error').length)
  })

  it('returns no remote skills for a skillset with only embedded skills', async () => {
    const result = await validateSkillset(fixtures('valid-skillset'))
    expect(result.remoteSkills).toHaveLength(0)
  })

  it('score is clamped between 0 and 100', async () => {
    const result = await validateSkillset(fixtures('valid-skillset'))
    expect(result.score).toBeGreaterThanOrEqual(0)
    expect(result.score).toBeLessThanOrEqual(100)
  })
})
