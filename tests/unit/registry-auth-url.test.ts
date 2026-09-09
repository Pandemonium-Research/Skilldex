// Where the CLI tells a blocked publisher to get a token.
//
// Two commands hardcoded `https://registry.skilldex.dev/auth/github`, which does not resolve — so
// the single instruction someone receives when they cannot publish sent them nowhere. The comment
// at the top of the client named that host as the default too, while the code used a different
// one: three strings, two of them wrong, none derived from the others.
//
// It is now built from the same base every request uses, which also makes it correct for anyone
// pointed at a private registry — the hardcoded copies would have sent them to the public host
// even if that host had existed.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const mocks = vi.hoisted(() => ({ configuredUrl: null as string | null }))

vi.mock('../../src/core/config.js', () => ({
  getConfigValue: async (key: string) => (key === 'registryUrl' ? mocks.configuredUrl : null),
}))

const ORIGINAL_ENV = process.env.SKILLDEX_REGISTRY_URL

beforeEach(() => {
  mocks.configuredUrl = null
  delete process.env.SKILLDEX_REGISTRY_URL
})

afterEach(() => {
  if (ORIGINAL_ENV === undefined) delete process.env.SKILLDEX_REGISTRY_URL
  else process.env.SKILLDEX_REGISTRY_URL = ORIGINAL_ENV
})

async function authUrl() {
  const { getAuthUrl } = await import('../../src/registry/sources/registry.js')
  return getAuthUrl()
}

describe('getAuthUrl', () => {
  it('points at a host that exists, not the dead one', async () => {
    const url = await authUrl()

    expect(url).toBe('https://skilldex-registry.vercel.app/v1/auth/github')
    expect(url).not.toContain('registry.skilldex.dev')
  })

  it('follows a configured registry rather than the public one', async () => {
    // The reason for deriving it. Someone running against their own registry was told to fetch a
    // token from a host they do not use.
    mocks.configuredUrl = 'https://registry.internal.example/v1'

    expect(await authUrl()).toBe('https://registry.internal.example/v1/auth/github')
  })

  it('does not double the slash when the base carries a trailing one', async () => {
    mocks.configuredUrl = 'https://registry.internal.example/v1/'

    expect(await authUrl()).toBe('https://registry.internal.example/v1/auth/github')
  })

  it('lets the environment variable win, as the file has always claimed', async () => {
    // SKILLDEX_REGISTRY_URL was read only from the catch branch, so it applied solely when
    // importing the config module threw — which is to say never. Setting it did nothing, while
    // the comment at the top of the file documented it as taking precedence.
    process.env.SKILLDEX_REGISTRY_URL = 'https://from-the-env.example/v1'
    mocks.configuredUrl = 'https://from-the-config.example/v1'

    expect(await authUrl()).toBe('https://from-the-env.example/v1/auth/github')
  })
})
