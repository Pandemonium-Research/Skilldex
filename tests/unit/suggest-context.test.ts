// Wiring between the project profile and the suggestion model.
//
// The defect being locked down: gatherProjectContext used to return a plain string, '' for any
// project it did not recognise, the caller passed it through, and the model was asked for skills
// anyway. It answered every time — confidently, with names that exist nowhere. Callers now check
// the profile, and every model-facing entry point refuses an empty context outright.
//
// No API key and no network here. The refusal is checked before any client is constructed, which
// is deliberate and is asserted below: a guard that only protects users who have configured
// credentials is not a guard.

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import {
  gatherProjectContext,
  proposeQueries,
  selectSkills,
} from '../../src/core/suggest-agent.js'

let tmpDir: string

beforeEach(async () => {
  tmpDir = await mkdtemp(path.join(os.tmpdir(), 'skilldex-suggest-context-'))
})

afterEach(async () => {
  await rm(tmpDir, { recursive: true, force: true })
})

describe('gatherProjectContext', () => {
  it('returns the profile alongside the rendered text', async () => {
    await writeFile(path.join(tmpDir, 'CLAUDE.md'), 'A billing service.\n', 'utf8')

    const context = await gatherProjectContext(tmpDir)

    expect(context.profile.isEmpty).toBe(false)
    expect(context.text).toContain('A billing service.')
  })

  it('marks an unreadable project as empty rather than returning a bare string', async () => {
    // The profile has to survive the call. A caller handed only text cannot tell "nothing found"
    // apart from "a project that renders to very little", which is how the old bug got through.
    const context = await gatherProjectContext(tmpDir)

    expect(context.profile.isEmpty).toBe(true)
  })
})

describe('the empty-context guard', () => {
  // No `complete` is injected anywhere here, so these run against the real client path. That is
  // the point: the refusal must happen before a client is constructed or a key is read.

  it('stops the query call from inventing a search', async () => {
    await expect(proposeQueries('')).rejects.toThrow(/no project context/i)
  })

  it('stops the selection call too', async () => {
    await expect(selectSkills('', [])).rejects.toThrow(/no project context/i)
  })

  it('refuses a whitespace-only context', async () => {
    await expect(proposeQueries('   \n\t ')).rejects.toThrow(/no project context/i)
  })

  it('refuses before requiring credentials, so the guard holds without an API key', async () => {
    // If the key check came first this would fail with a credentials error, and a developer with
    // no key configured would never see the guard work.
    await expect(proposeQueries('')).rejects.toThrow(/no project context/i)
    await expect(proposeQueries('')).rejects.not.toThrow(/ANTHROPIC_API_KEY/i)
  })
})
