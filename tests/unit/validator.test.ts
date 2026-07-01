import { describe, it, expect } from 'vitest'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { validateSkill } from '../../src/core/validator.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const fixtures = (name: string) => path.join(__dirname, '..', 'fixtures', name)

describe('validateSkill', () => {
  it('gives a high score to a fully valid skill', async () => {
    const result = await validateSkill(fixtures('valid-skill'))
    expect(result.score).toBeGreaterThanOrEqual(80)
    expect(result.errorCount).toBe(0)
    expect(result.skill).toBe('valid-skill')
  })

  it('returns score 0 and a fatal error when SKILL.md has no frontmatter', async () => {
    const result = await validateSkill(fixtures('no-frontmatter-skill'))
    expect(result.score).toBe(0)
    expect(result.errorCount).toBeGreaterThan(0)
    const diag = result.diagnostics.find((d) => d.check === 'yaml-frontmatter')
    expect(diag?.severity).toBe('error')
    expect(diag?.line).toBe(1)
  })

  it('returns score 0 when path does not exist', async () => {
    const result = await validateSkill('/nonexistent/path/to/skill')
    expect(result.score).toBe(0)
    expect(result.errorCount).toBeGreaterThan(0)
  })

  it('emits error for short description with line number', async () => {
    const result = await validateSkill(fixtures('short-description-skill'))
    const diag = result.diagnostics.find((d) => d.check === 'description-length')
    expect(diag?.severity).toBe('error')
    expect(diag?.message).toMatch(/too short/)
    expect(diag?.line).toBeGreaterThan(0)
  })

  it('emits warning for unknown subdirectory', async () => {
    const result = await validateSkill(fixtures('bad-structure-skill'))
    const diag = result.diagnostics.find((d) => d.check === 'allowed-subdirs')
    expect(diag?.severity).toBe('warning')
    expect(diag?.message).toMatch(/bin/)
  })

  it('emits error for broken file reference', async () => {
    const result = await validateSkill(fixtures('broken-ref-skill'))
    const diag = result.diagnostics.find((d) => d.check === 'referenced-resources')
    expect(diag?.severity).toBe('error')
    expect(diag?.message).toMatch(/not found/)
  })

  it('catches a broken inline-code reference', async () => {
    const result = await validateSkill(fixtures('inline-ref-skill'))
    const diag = result.diagnostics.find((d) => d.check === 'referenced-resources')
    expect(diag?.severity).toBe('error')
    expect(diag?.message).toMatch(/references\/missing\.md/)
  })

  it('catches a broken reference with a fragment anchor', async () => {
    const result = await validateSkill(fixtures('anchored-ref-skill'))
    const diag = result.diagnostics.find((d) => d.check === 'referenced-resources')
    expect(diag?.severity).toBe('error')
    expect(diag?.message).toMatch(/references\/missing\.md/)
  })

  it('catches a broken reference written as a titled markdown link', async () => {
    const result = await validateSkill(fixtures('titled-ref-skill'))
    const diag = result.diagnostics.find((d) => d.check === 'referenced-resources')
    expect(diag?.severity).toBe('error')
    expect(diag?.message).toMatch(/references\/missing\.md/)
  })

  it('passes referenced-resources when an inline-code reference resolves', async () => {
    const result = await validateSkill(fixtures('inline-ref-valid-skill'))
    const diag = result.diagnostics.find((d) => d.check === 'referenced-resources')
    expect(diag?.severity).toBe('pass')
    expect(result.diagnostics.some((d) => d.check === 'referenced-resources' && d.severity === 'error')).toBe(false)
  })

  it('flags a name that is not kebab-case', async () => {
    const result = await validateSkill(fixtures('bad-name-skill'))
    const diag = result.diagnostics.find((d) => d.check === 'name-format')
    expect(diag?.severity).toBe('error')
    expect(diag?.message).toMatch(/kebab-case/)
  })

  it('flags a name containing a reserved word', async () => {
    const result = await validateSkill(fixtures('reserved-name-skill'))
    const diag = result.diagnostics.find(
      (d) => d.check === 'name-format' && /reserved/.test(d.message)
    )
    expect(diag?.severity).toBe('error')
    expect(diag?.message).toMatch(/claude/)
  })

  it('flags a description that exceeds the character limit', async () => {
    const result = await validateSkill(fixtures('long-description-skill'))
    const diag = result.diagnostics.find(
      (d) => d.check === 'description-format' && /1024/.test(d.message)
    )
    expect(diag?.severity).toBe('error')
  })

  it('flags a description containing XML angle brackets', async () => {
    const result = await validateSkill(fixtures('xml-description-skill'))
    const diag = result.diagnostics.find(
      (d) => d.check === 'description-format' && /angle bracket|XML/.test(d.message)
    )
    expect(diag?.severity).toBe('error')
  })

  it('warns when README.md is inside the skill folder', async () => {
    const result = await validateSkill(fixtures('readme-in-folder-skill'))
    const diag = result.diagnostics.find((d) => d.check === 'no-readme')
    expect(diag?.severity).toBe('warning')
    expect(diag?.message).toMatch(/README\.md/)
  })

  it('awards the new format checks on a fully valid skill', async () => {
    const result = await validateSkill(fixtures('valid-skill'))
    for (const check of ['name-format', 'description-format', 'no-readme']) {
      const diag = result.diagnostics.find((d) => d.check === check)
      expect(diag?.severity, check).toBe('pass')
    }
  })

  it('includes specVersion in result', async () => {
    const result = await validateSkill(fixtures('valid-skill'))
    expect(result.specVersion).toBe('1.0')
  })

  it('counts pass/warn/error correctly', async () => {
    const result = await validateSkill(fixtures('valid-skill'))
    expect(result.passCount).toBe(result.diagnostics.filter((d) => d.severity === 'pass').length)
    expect(result.warnCount).toBe(result.diagnostics.filter((d) => d.severity === 'warning').length)
    expect(result.errorCount).toBe(result.diagnostics.filter((d) => d.severity === 'error').length)
  })
})
