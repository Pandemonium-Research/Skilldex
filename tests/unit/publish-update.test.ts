// `skillpm publish --update` against the registry's routes.
//
// The registry routes an update only as PATCH /skills/{owner}/{name}: names are unique per owner.
// The client sent PATCH /skills/{name}, which matches no route, so every update came back 404. The
// owner is the publisher's GitHub handle, read from /auth/me. The URL assertions are the point: a
// type cannot catch a path the server does not serve.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { updateSkill } from '../../src/registry/sources/registry.js'

let calls: Array<{ url: string; method: string; auth: string | null }> = []

beforeEach(() => {
  calls = []
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      const headers = new Headers(init?.headers)
      calls.push({ url: String(url), method: init?.method ?? 'GET', auth: headers.get('authorization') })
      const body = String(url).endsWith('/auth/me')
        ? { github_handle: 'octocat', verified: false }
        : { skill: { name: 'log-triage', owner: 'octocat', qualified_name: 'octocat/log-triage', score: 94 }, diagnostics: [] }
      return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } })
    })
  )
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('updateSkill', () => {
  it('patches the skill under the publisher\'s handle', async () => {
    const result = await updateSkill('tok', 'log-triage')

    expect(calls).toHaveLength(2)
    expect(calls[0].url).toMatch(/\/auth\/me$/)
    expect(calls[0].auth).toBe('Bearer tok')
    expect(calls[1].method).toBe('PATCH')
    expect(calls[1].url).toMatch(/\/skills\/octocat\/log-triage$/)
    expect(calls[1].auth).toBe('Bearer tok')
    expect(result.skill.qualified_name).toBe('octocat/log-triage')
  })
})
