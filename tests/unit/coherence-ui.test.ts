/**
 * Compact coherence reporting for install and publish.
 *
 * `skillset validate` prints the full report; these two commands print one line and a pointer.
 * The distinctions that matter are between "nothing to check", "checked and fine", and "checked
 * and wrong" — collapsing any pair of those is how a contradiction ends up looking like a clean
 * install.
 */
import { describe, it, expect } from 'vitest'
import { formatCoherence, coherenceHint, coherenceJson } from '../../src/cli/ui/coherence.js'

/** Strip ANSI so assertions do not depend on whether chalk detected a TTY. */
const plain = (s: string | null) => (s === null ? null : s.replace(/\[[0-9;]*m/g, ''))

function counts(over: Partial<Parameters<typeof formatCoherence>[0]> = {}) {
  return {
    membersChecked: 4,
    membersCoherent: 4,
    passCount: 8,
    warnCount: 0,
    errorCount: 0,
    declaredConventions: [{ name: 'commit-types' }],
    ...over,
  } as NonNullable<Parameters<typeof formatCoherence>[0]>
}

describe('formatCoherence', () => {
  it('reports the ratio when members were checked', () => {
    expect(plain(formatCoherence(counts()))).toBe('Coherence: 4/4')
  })

  it('reports a partial ratio', () => {
    expect(plain(formatCoherence(counts({ membersCoherent: 1, warnCount: 3 })))).toBe(
      'Coherence: 1/4'
    )
  })

  it('says nothing when there were no members to check', () => {
    // "0/0" would read as a failure. A skillset of remote-only references has no coherence to
    // report, which is an absence, not a bad score — the registry stores NULL for the same reason.
    expect(formatCoherence(counts({ membersChecked: 0, membersCoherent: 0, passCount: 0 }))).toBeNull()
  })

  it('says nothing when coherence is absent entirely', () => {
    // A registry older than skillset spec 1.1 sends no coherence at all.
    expect(formatCoherence(undefined)).toBeNull()
    expect(formatCoherence(null)).toBeNull()
  })
})

describe('coherenceHint', () => {
  it('is silent when everything agrees', () => {
    expect(coherenceHint(counts())).toBeNull()
  })

  it('counts errors and points at the validator', () => {
    const hint = coherenceHint(counts({ membersCoherent: 1, errorCount: 2 }))
    expect(hint).toContain('2 coherence error(s)')
    expect(hint).toContain('skillpm skillset validate')
  })

  it('mentions warnings too, and both together', () => {
    expect(coherenceHint(counts({ membersCoherent: 3, warnCount: 1 }))).toContain(
      '1 coherence warning(s)'
    )

    const both = coherenceHint(counts({ membersCoherent: 0, errorCount: 2, warnCount: 1 }))
    expect(both).toContain('2 coherence error(s)')
    expect(both).toContain('1 coherence warning(s)')
  })

  it('is silent when there was nothing to check', () => {
    expect(coherenceHint(counts({ membersChecked: 0, errorCount: 0 }))).toBeNull()
  })
})

describe('coherenceJson', () => {
  it('summarises the counts and collapses conventions to a count', () => {
    expect(coherenceJson(counts({ membersCoherent: 3, warnCount: 1 }))).toEqual({
      membersChecked: 4,
      membersCoherent: 3,
      passCount: 8,
      warnCount: 1,
      errorCount: 0,
      declaredConventions: 1,
    })
  })

  it('is null when there is no coherence to report', () => {
    expect(coherenceJson(undefined)).toBeNull()
  })

  it('reports zero conventions rather than omitting the field', () => {
    // A skillset can be fully coherent with nothing declared — every member simply referenced a
    // shared asset. Consumers should not have to distinguish absent from zero.
    const json = coherenceJson(counts({ declaredConventions: [] }))
    expect(json?.declaredConventions).toBe(0)
  })
})
