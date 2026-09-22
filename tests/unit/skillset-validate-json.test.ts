// `skillset validate --json` must exit by the same rules as the human-readable path. It used to
// print the JSON and return before any exit check, so `--strict --json` exited 0 on a coherence
// error and `--json` exited 0 on a format error — a CI gate that could never fail.

import { afterEach, describe, expect, it, vi } from 'vitest'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { runSkillsetValidate } from '../../src/cli/commands/skillset-validate-action.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const fixtures = (name: string) => path.join(__dirname, '..', 'fixtures', name)

async function exitCodes(fixture: string, options: { json: boolean; strict?: boolean }) {
  const exit = vi.spyOn(process, 'exit').mockImplementation((() => undefined) as never)
  vi.spyOn(console, 'log').mockImplementation(() => {})
  vi.spyOn(console, 'error').mockImplementation(() => {})
  await runSkillsetValidate(fixtures(fixture), options)
  return exit.mock.calls.map((c) => c[0])
}

afterEach(() => vi.restoreAllMocks())

describe('skillset validate --json exit codes', () => {
  it('exits 1 under --strict --json when members contradict a declared convention', async () => {
    expect(await exitCodes('incoherent-skillset', { json: true, strict: true })).toContain(1)
  })

  it('does not exit non-zero on a coherence error without --strict', async () => {
    expect(await exitCodes('incoherent-skillset', { json: true })).toEqual([])
  })

  it('agrees with the human-readable path under --strict', async () => {
    expect(await exitCodes('incoherent-skillset', { json: false, strict: true })).toContain(1)
  })

  it('exits 0 under --strict --json on a coherent skillset', async () => {
    expect(await exitCodes('coherent-skillset', { json: true, strict: true })).toEqual([])
  })
})
