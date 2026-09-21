import { describe, it, expect } from 'vitest'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
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

describe('an installed skillset', () => {
  // `skillset install` copies SKILLSET.md and assets/ into <root>/skillsets/<name> and puts the members
  // in <root>/skills/<name>, recording them in the manifest. Validating the installed copy used to find
  // no members: it lost the points for having any and passed coherence having compared nothing (A17).
  async function installedLayout(perfSection: string): Promise<string> {
    const root = await mkdtemp(path.join(os.tmpdir(), 'skilldex-installed-'))
    const set = path.join(root, 'skillsets', 'demo')
    await mkdir(path.join(set, 'assets'), { recursive: true })
    await writeFile(path.join(set, 'SKILLSET.md'),
      '---\nname: demo\ndescription: "A demo skillset holding one member skill and one shared asset that declares a single commit-type convention, written at the length the description check asks for so that the only thing this fixture can lose points on is whether its member was found and checked at all."\nversion: "1.0.0"\n---\n\n# demo\n')
    await writeFile(path.join(set, 'assets', 'conventions.md'),
      '# Conventions\n\n```yaml skilldex-conventions\ncommit-type-to-changelog-section:\n  feat: Added\n  perf: Changed\n```\n')
    const member = path.join(root, 'skills', 'writer')
    await mkdir(member, { recursive: true })
    await writeFile(path.join(member, 'SKILL.md'),
      '---\nname: writer\ndescription: "Writes changelog entries from commits, restating the declared commit-type mapping of its bundle for its own use."\n---\n\nSections follow the conventions in `../assets/conventions.md`:\n\n| Commit type | Changelog section |\n|---|---|\n| `feat` | Added |\n| `perf` | ' + perfSection + ' |\n')
    await writeFile(path.join(root, 'skilldex.json'), JSON.stringify({
      skilldexVersion: '1', scope: 'project',
      skills: { writer: { name: 'writer', path: 'skills/writer' } },
      skillsets: { demo: { name: 'demo', embeddedSkills: ['writer'], remoteSkills: [] } },
    }))
    return set
  }

  it('checks the members the manifest records, not the empty directory', async () => {
    const set = await installedLayout('Changed')
    const result = await validateSkillset(set)
    expect(result.embeddedSkills).toEqual(['writer'])
    expect(result.coherence?.membersChecked).toBe(1)
    expect(result.coherence?.membersCoherent).toBe(1)
    expect(result.score).toBe(100)
  })

  it('flags a member that contradicts the declared convention', async () => {
    // "Added" is a value the declaration itself uses, so this is a contradiction rather than a
    // value the check cannot verify against the declared vocabulary.
    const set = await installedLayout('Added')
    const result = await validateSkillset(set)
    expect(result.coherence?.membersChecked).toBe(1)
    expect(result.coherence?.membersCoherent).toBe(0)
    expect(result.coherence?.diagnostics.some((d) => d.severity === 'error')).toBe(true)
  })
})
