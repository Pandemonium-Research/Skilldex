// Wiring between the project profile and the suggestion model.
//
// The defect being locked down: gatherProjectContext used to return a plain string, '' for any
// project it did not recognise, and generateProposals interpolated that into the prompt and asked
// for skills anyway. The model answered every time — confidently, with names that exist nowhere.
// Callers now check the profile, and generateProposals refuses an empty context outright.
//
// No API key and no network here. The refusal is checked before any client is constructed, which
// is deliberate: the guard has to hold on a machine with no credentials configured.

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { gatherProjectContext, generateProposals } from '../../src/core/suggest-agent.js'

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

describe('generateProposals', () => {
  it('refuses an empty context instead of asking the model to invent', async () => {
    await expect(generateProposals('')).rejects.toThrow(/no project context/i)
  })

  it('refuses a whitespace-only context', async () => {
    await expect(generateProposals('   \n\t ')).rejects.toThrow(/no project context/i)
  })

  it('refuses before requiring credentials, so the guard holds without an API key', async () => {
    // If the key check came first this would fail with a credentials error, and a developer with
    // no key configured would never see the guard work.
    await expect(generateProposals('')).rejects.toThrow(/no project context/i)
    await expect(generateProposals('')).rejects.not.toThrow(/ANTHROPIC_API_KEY/i)
  })
})
