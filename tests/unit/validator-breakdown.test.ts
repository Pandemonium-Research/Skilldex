// The per-check score breakdown, and the two checks demoted from error to warning.
//
// Why a breakdown: the aggregate hides what it is made of. Across 21,032 public skills the mean
// score was 94–95 while roughly half failed the description check — the one that decides whether
// an agent ever invokes the skill. A reviewer's objection was exactly that "the aggregate score can
// hide important failures". Reporting every check's points beside the total answers it without
// asking anyone to trust the total.
//
// The property everything here protects: the breakdown explains the score, so it must add up to
// it. The score and the breakdown are computed from one map for that reason. A breakdown computed
// separately — re-derived from diagnostics, say — could agree today and drift tomorrow.
//
// Why the demotions: the specification requires a description of 1–1024 characters and sets no
// word minimum, and it *recommends* keeping SKILL.md under 500 lines. Both were errors, and
// `skillpm validate` exits 1 on any error — so CI failed on skills the specification accepts.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mkdtemp, rm, writeFile, mkdir } from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { fileURLToPath } from 'node:url'
import { validateSkill } from '../../src/core/validator.js'
import { renderValidationReport } from '../../src/cli/ui/output.js'
import { runValidate } from '../../src/cli/commands/validate-action.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const fixtures = (name: string) => path.join(__dirname, '..', 'fixtures', name)

/** The checks in the order the validator runs and reports them. */
const ORDER = [
  'yaml-frontmatter',
  'name-present',
  'name-format',
  'description-present',
  'description-length',
  'description-format',
  'line-count',
  'allowed-subdirs',
  'no-readme',
  'referenced-resources',
  'bundled-resources',
]

/** Every skill fixture, including ones that fail in different ways. */
const SKILL_FIXTURES = [
  'valid-skill',
  'short-description-skill',
  'long-description-skill',
  'bad-name-skill',
  'reserved-name-skill',
  'bad-structure-skill',
  'broken-ref-skill',
  'inline-ref-skill',
  'inline-ref-valid-skill',
  'anchored-ref-skill',
  'titled-ref-skill',
  'readme-in-folder-skill',
  'xml-description-skill',
  'no-frontmatter-skill',
]

const row = (result: Awaited<ReturnType<typeof validateSkill>>, check: string) =>
  result.breakdown.find((r) => r.check === check)!

let tmpDir: string

beforeEach(async () => {
  tmpDir = await mkdtemp(path.join(os.tmpdir(), 'skilldex-breakdown-'))
})

afterEach(async () => {
  vi.restoreAllMocks()
  await rm(tmpDir, { recursive: true, force: true })
})

/** A minimal skill directory with the given frontmatter and body. */
async function skill(name: string, frontmatter: string, body = '# Skill\n\nDo the thing.\n') {
  const dir = path.join(tmpDir, name)
  await mkdir(dir, { recursive: true })
  await writeFile(path.join(dir, 'SKILL.md'), `---\n${frontmatter}\n---\n\n${body}`, 'utf8')
  return dir
}

const LONG_DESCRIPTION =
  '"Validates things carefully and reports every problem it finds with a line number, so that an ' +
  'author can fix the file before publishing it, and so that a continuous integration job can gate ' +
  'a merge on the result without anyone reading the output by hand."'

describe('the shape of the breakdown', () => {
  it('lists every weighted check exactly once, in a fixed order', async () => {
    const result = await validateSkill(fixtures('valid-skill'))
    expect(result.breakdown.map((r) => r.check)).toEqual(ORDER)
  })

  it('offers exactly 100 points in total', async () => {
    // If the weights stop summing to 100, a perfect skill stops scoring 100 and the clamp starts
    // hiding it. Asserted as the literal, not recomputed from the weights under test.
    const result = await validateSkill(fixtures('valid-skill'))
    expect(result.breakdown.reduce((n, r) => n + r.possible, 0)).toBe(100)
  })

  it('reports a perfect skill as full marks on every row, with nothing skipped', async () => {
    const result = await validateSkill(fixtures('valid-skill'))
    expect(result.score).toBe(100)
    for (const r of result.breakdown) {
      expect(r.earned, r.check).toBe(r.possible)
      expect(r.status, r.check).not.toBe('skipped')
    }
  })
})

describe('the breakdown adds up to the score', () => {
  it.each(SKILL_FIXTURES)('%s', async (name) => {
    const result = await validateSkill(fixtures(name))
    expect(result.breakdown.reduce((n, r) => n + r.earned, 0)).toBe(result.score)
    for (const r of result.breakdown) {
      expect(r.earned, r.check).toBeGreaterThanOrEqual(0)
      expect(r.earned, r.check).toBeLessThanOrEqual(r.possible)
      // A row that earned points ran. This is the invariant a silent pass once broke:
      // `description-present` emits no diagnostic when it passes, and was shown as not evaluated
      // while contributing its 16 points to the score.
      if (r.earned > 0) expect(r.status, r.check).not.toBe('skipped')
    }
  })
})

describe('checks that never ran', () => {
  it('shows a missing description as present-failed, with length and format not evaluated', async () => {
    // Zero points for "not evaluated" must not read as zero points for "too short".
    const dir = await skill('no-description', 'name: no-description\nversion: "1.0.0"')
    const result = await validateSkill(dir)

    expect(row(result, 'description-present').status).toBe('error')
    expect(row(result, 'description-length')).toMatchObject({ earned: 0, status: 'skipped' })
    expect(row(result, 'description-format')).toMatchObject({ earned: 0, status: 'skipped' })
  })

  it('evaluates nothing past broken frontmatter', async () => {
    const result = await validateSkill(fixtures('no-frontmatter-skill'))
    expect(result.score).toBe(0)
    expect(row(result, 'yaml-frontmatter').status).toBe('error')
    for (const r of result.breakdown.filter((x) => x.check !== 'yaml-frontmatter')) {
      expect(r, r.check).toMatchObject({ earned: 0, status: 'skipped' })
    }
  })

  it('evaluates nothing at all when the path does not exist', async () => {
    const result = await validateSkill(path.join(tmpDir, 'nowhere'))
    expect(result.score).toBe(0)
    expect(result.breakdown).toHaveLength(ORDER.length)
    for (const r of result.breakdown) expect(r, r.check).toMatchObject({ earned: 0, status: 'skipped' })
  })
})

describe('partial credit', () => {
  it('gives allowed-subdirs part of its weight for one unknown directory', async () => {
    // Four points, two deducted per unknown directory: one stray `bin/` leaves two.
    const result = await validateSkill(fixtures('bad-structure-skill'))
    expect(row(result, 'allowed-subdirs')).toMatchObject({ earned: 2, possible: 4, status: 'warning' })
  })
})

describe('description-length is a warning', () => {
  it('warns on a short description, costs its points, and raises no error', async () => {
    const result = await validateSkill(fixtures('short-description-skill'))
    expect(row(result, 'description-length')).toMatchObject({ earned: 0, possible: 6, status: 'warning' })
    expect(result.errorCount).toBe(0)
    // The score is unchanged by the demotion: points are awarded on pass, independent of severity.
    expect(result.score).toBe(94)
  })

  it('no longer fails `skillpm validate` on a skill the specification accepts', async () => {
    // The practical point of the change. Before it, this exited 1 and failed CI.
    const exit = vi.spyOn(process, 'exit').mockImplementation((() => undefined) as never)
    vi.spyOn(console, 'log').mockImplementation(() => {})
    await runValidate(fixtures('short-description-skill'), { json: true })
    expect(exit).not.toHaveBeenCalled()
  })

  it('still fails `skillpm validate` on a real error', async () => {
    const exit = vi.spyOn(process, 'exit').mockImplementation((() => undefined) as never)
    vi.spyOn(console, 'log').mockImplementation(() => {})
    await runValidate(fixtures('broken-ref-skill'), { json: true })
    expect(exit).toHaveBeenCalledWith(1)
  })
})

describe('line-count is a warning', () => {
  it('warns on a SKILL.md over 500 lines and awards it nothing', async () => {
    const body = '# Long\n\n' + Array.from({ length: 520 }, (_, i) => `Line ${i}.`).join('\n') + '\n'
    const dir = await skill('long-file', `name: long-file\ndescription: ${LONG_DESCRIPTION}`, body)
    const result = await validateSkill(dir)

    expect(row(result, 'line-count')).toMatchObject({ earned: 0, possible: 7, status: 'warning' })
    expect(result.diagnostics.find((d) => d.check === 'line-count')?.message).toMatch(/recommended/)
    expect(result.errorCount).toBe(0)
    expect(result.score).toBe(93)
  })
})

describe('rendering', () => {
  it('prints a row for every check beside the aggregate', async () => {
    const out = renderValidationReport(await validateSkill(fixtures('short-description-skill')))
    expect(out).toContain('Score breakdown:')
    for (const check of ORDER) expect(out).toContain(check)
    expect(out).toMatch(/description-length\s+0\/6/)
    expect(out).toMatch(/Format conformance score: .*94.*\/100/)
  })

  it('prints a check that never ran as not evaluated, not as zero', async () => {
    const dir = await skill('no-description', 'name: no-description\nversion: "1.0.0"')
    const out = renderValidationReport(await validateSkill(dir))
    expect(out).toMatch(/description-length\s+—\/6\s+not evaluated/)
    expect(out).not.toMatch(/description-length\s+0\/6/)
  })

  it('carries the breakdown in --json output', async () => {
    const logged: string[] = []
    vi.spyOn(process, 'exit').mockImplementation((() => undefined) as never)
    vi.spyOn(console, 'log').mockImplementation((...a: unknown[]) => void logged.push(a.join(' ')))
    await runValidate(fixtures('short-description-skill'), { json: true })

    const parsed = JSON.parse(logged[0])
    expect(parsed.breakdown).toHaveLength(ORDER.length)
    expect(parsed.breakdown.find((r: { check: string }) => r.check === 'description-length')).toMatchObject({
      earned: 0,
      possible: 6,
      status: 'warning',
    })
  })
})
