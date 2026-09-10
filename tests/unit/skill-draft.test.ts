// Writing a skill the registry does not have.
//
// The user's decision is encoded here: drafts land on disk and are not installed. A published
// skill someone chose is one thing; a generated one is unreviewed text that would be read into an
// agent's context every session afterwards, so it gets written, scored, and adopted only on a
// second yes.
//
// The interesting behaviour is the repair loop. A model writes a crisp one-line description
// because that reads better, and the validator requires thirty words — so the first attempt fails
// on exactly the check a generator is most likely to miss, and the retry has to actually carry the
// diagnostics back.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mkdtemp, rm, readFile } from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { createSkillDraft } from '../../src/core/skill-draft.js'
import type { Complete, SkillGap } from '../../src/core/suggest-agent.js'

let tmpDir: string

beforeEach(async () => {
  tmpDir = await mkdtemp(path.join(os.tmpdir(), 'skilldex-draft-'))
})

afterEach(async () => {
  await rm(tmpDir, { recursive: true, force: true })
})

const GAP: SkillGap = {
  name: 'experiment-record',
  purpose: 'Fill in the experiment record after a run',
  reason: 'Every experiment in this repo needs one',
}

/** A description long enough to clear the validator's thirty-word floor. */
const LONG_DESCRIPTION =
  'Fills in the experiment record after a run completes, covering the results section, the ' +
  'validation spot checks, and the findings, so that the paper writeup draft can be assembled ' +
  'from records rather than from memory or from scattered notes left in the terminal.'

function skillMd(description: string, name = 'experiment-record'): string {
  return `---
name: ${name}
description: ${description}
version: "1.0.0"
tags: []
spec_version: "1.0"
---

# Experiment Record

Fill in each section after the run finishes.

## Steps

1. Copy the run metadata.
2. Record the primary metrics.
3. Write the findings.
`
}

describe('createSkillDraft', () => {
  it('writes SKILL.md under .skilldex/drafts and does not install it', async () => {
    const complete: Complete = vi.fn(async () => skillMd(LONG_DESCRIPTION))

    const draft = await createSkillDraft(tmpDir, GAP, 'ctx', { complete })

    // Asserted as a literal, not via DRAFTS_DIR. Building the expectation from the constant under
    // test makes the assertion true by construction — it would still pass if drafts were written
    // into the scope's own skills directory, which is exactly what must not happen.
    const rel = path.relative(tmpDir, draft.dir).split(path.sep).join('/')
    expect(rel).toBe('.skilldex/drafts/experiment-record')
    expect(rel).not.toContain('/skills/')

    const written = await readFile(path.join(draft.dir, 'SKILL.md'), 'utf8')
    expect(written).toContain('name: experiment-record')

    // Nothing installed: no manifest, and nothing in the scope's skills directory.
    await expect(readFile(path.join(tmpDir, '.skilldex', 'skilldex.json'), 'utf8')).rejects.toThrow()
    await expect(
      readFile(path.join(tmpDir, '.skilldex', 'skills', 'experiment-record', 'SKILL.md'), 'utf8')
    ).rejects.toThrow()
  })

  it('scores a valid draft without regenerating it', async () => {
    const complete: Complete = vi.fn(async () => skillMd(LONG_DESCRIPTION))

    const draft = await createSkillDraft(tmpDir, GAP, 'ctx', { complete })

    expect(draft.validation.errorCount).toBe(0)
    expect(draft.validation.score).toBeGreaterThan(0)
    expect(draft.repaired).toBe(false)
    expect(complete).toHaveBeenCalledTimes(1)
  })

  it('regenerates once from the validator errors when the first attempt fails', async () => {
    // The failure mode this exists for: a one-line description reads better and scores zero.
    const complete = vi
      .fn<Parameters<Complete>, ReturnType<Complete>>()
      .mockResolvedValueOnce(skillMd('Too short.'))
      .mockResolvedValueOnce(skillMd(LONG_DESCRIPTION))

    const draft = await createSkillDraft(tmpDir, GAP, 'ctx', { complete })

    expect(complete).toHaveBeenCalledTimes(2)
    expect(draft.repaired).toBe(true)
    expect(draft.validation.errorCount).toBe(0)
  })

  it('quotes the actual diagnostics back on the retry', async () => {
    // Without the errors, the retry is just another roll of the dice.
    const complete = vi
      .fn<Parameters<Complete>, ReturnType<Complete>>()
      .mockResolvedValueOnce(skillMd('Too short.'))
      .mockResolvedValueOnce(skillMd(LONG_DESCRIPTION))

    await createSkillDraft(tmpDir, GAP, 'ctx', { complete })

    const [, retryPrompt] = complete.mock.calls[1]
    expect(retryPrompt).toMatch(/REJECTED/i)
    expect(retryPrompt).toMatch(/description/i)
  })

  it('gives up after one retry and hands back the failing draft', async () => {
    // A model that fails twice is failing for a reason a third attempt will not reach. The draft
    // is kept, with its diagnostics, rather than retried forever or deleted.
    const complete: Complete = vi.fn(async () => skillMd('Too short.'))

    const draft = await createSkillDraft(tmpDir, GAP, 'ctx', { complete })

    expect(complete).toHaveBeenCalledTimes(2)
    expect(draft.repaired).toBe(true)
    expect(draft.validation.errorCount).toBeGreaterThan(0)
    // Still on disk, so the user can fix it by hand.
    await expect(readFile(path.join(draft.dir, 'SKILL.md'), 'utf8')).resolves.toContain('name:')
  })

  it('unwraps a fenced reply rather than writing the fence into the file', async () => {
    // Models wrap file content in a fence despite instructions. The content is right and the
    // envelope is cosmetic — but a literal ``` on line one makes the frontmatter unparseable.
    const complete: Complete = vi.fn(
      async () => '```markdown\n' + skillMd(LONG_DESCRIPTION) + '\n```'
    )

    const draft = await createSkillDraft(tmpDir, GAP, 'ctx', { complete })

    const written = await readFile(path.join(draft.dir, 'SKILL.md'), 'utf8')
    expect(written.startsWith('---')).toBe(true)
    expect(written).not.toContain('```')
    expect(draft.validation.errorCount).toBe(0)
  })

  it('refuses to generate without project context', async () => {
    const complete: Complete = vi.fn(async () => skillMd(LONG_DESCRIPTION))

    await expect(createSkillDraft(tmpDir, GAP, '  ', { complete })).rejects.toThrow(
      /no project context/i
    )
    expect(complete).not.toHaveBeenCalled()
  })
})
