// Skilldex Registry API client
// Connects to the hosted registry at SKILLDEX_REGISTRY_URL (default: https://registry.skilldex.dev/v1)
// Resolution order: env var → config file → built-in default

import type { SkillsetCoherenceResult } from '../../types/skillset.js'

async function getRegistryBase(): Promise<string> {
  try {
    const { getConfigValue } = await import('../../core/config.js')
    return (await getConfigValue('registryUrl')) ?? 'https://skilldex-registry.vercel.app/v1'
  } catch {
    return process.env.SKILLDEX_REGISTRY_URL ?? 'https://skilldex-registry.vercel.app/v1'
  }
}

export interface RegistrySkill {
  name: string
  description: string
  author: string | null
  source_url: string
  trust_tier: 'verified' | 'community'
  score: number | null
  spec_version: string
  tags: string[]
  install_count: number
  published_at: string
}

/**
 * Orderings the registry accepts.
 *
 * `relevance` was missing here, which is why nothing flagged the CLI hardcoding `installs` and
 * losing BM25 ranking on every search: the one ordering a text query actually wants was not in
 * the type, so asking for it looked like a mistake.
 *
 * Leaving `sort` unset is not the same as picking one. The registry resolves an absent sort to
 * relevance when a query is present and to installs when it is not, and any explicit value is
 * returned unchanged — so a caller that always sends something can never get that behaviour.
 */
export type SearchSort = 'relevance' | 'installs' | 'score' | 'recent' | 'name'

export interface SearchOptions {
  q?: string
  tier?: 'verified' | 'community'
  min_score?: number
  spec_version?: string
  tags?: string
  sort?: SearchSort
  limit?: number
  offset?: number
}

export interface SearchResponse {
  skills: RegistrySkill[]
  total: number
  limit: number
  offset: number
}

export interface InstallInfo {
  name: string
  source_url: string
  score: number | null
  spec_version: string
  trust_tier: 'verified' | 'community'
}

export interface PublishBody {
  name: string
  source_url: string
  tags?: string[]
}

export interface PublishResponse {
  skill: RegistrySkill
  diagnostics: Array<{ level: string; line?: number; message: string }>
}

async function registryFetch<T>(path: string, options?: RequestInit): Promise<T> {
  const base = await getRegistryBase()
  const url = `${base}${path}`
  const res = await fetch(url, {
    headers: { 'Content-Type': 'application/json', ...options?.headers },
    ...options,
  })

  if (!res.ok) {
    let message = `Registry error ${res.status}`
    try {
      const body = (await res.json()) as { error?: string }
      if (body.error) message = body.error
    } catch {
      // Body was not JSON — keep the status-code message.
    }
    throw new Error(message)
  }

  return res.json() as Promise<T>
}

export async function searchRegistry(options: SearchOptions = {}): Promise<SearchResponse> {
  const params = new URLSearchParams()
  if (options.q) params.set('q', options.q)
  if (options.tier) params.set('tier', options.tier)
  if (options.min_score !== undefined) params.set('min_score', String(options.min_score))
  if (options.spec_version) params.set('spec_version', options.spec_version)
  if (options.tags) params.set('tags', options.tags)
  if (options.sort) params.set('sort', options.sort)
  if (options.limit !== undefined) params.set('limit', String(options.limit))
  if (options.offset !== undefined) params.set('offset', String(options.offset))

  const qs = params.toString()
  return registryFetch<SearchResponse>(`/skills${qs ? `?${qs}` : ''}`)
}

export async function getSkillInstallInfo(name: string): Promise<InstallInfo> {
  return registryFetch<InstallInfo>(`/skills/${encodeURIComponent(name)}/install`)
}

export async function getSkill(name: string): Promise<RegistrySkill> {
  return registryFetch<RegistrySkill>(`/skills/${encodeURIComponent(name)}`)
}

export async function publishSkill(token: string, body: PublishBody): Promise<PublishResponse> {
  return registryFetch<PublishResponse>('/skills', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  })
}

export async function updateSkill(token: string, name: string): Promise<PublishResponse> {
  return registryFetch<PublishResponse>(`/skills/${encodeURIComponent(name)}`, {
    method: 'PATCH',
    headers: { Authorization: `Bearer ${token}` },
  })
}

export async function deleteSkill(token: string, name: string): Promise<void> {
  await registryFetch<void>(`/skills/${encodeURIComponent(name)}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${token}` },
  })
}

// --- Skillset registry client ---

export interface RegistrySkillset {
  name: string
  description: string
  author: string | null
  source_url: string
  trust_tier: 'verified' | 'community'
  score: number | null
  spec_version: string
  tags: string[]
  skill_count: number
  install_count: number
  published_at: string
  skills: Array<{ name: string; source_url: string }>
  /**
   * Registry-computed coherence summary, in the API's snake_case.
   *
   * Optional because a registry predating skillset spec 1.1 does not send it, and the CLI is
   * routinely a version ahead of the deployment it is talking to. null means the skillset was
   * published before coherence was recorded; a zeroed `members_checked` means it has no members
   * to check. Neither is the same as scoring badly.
   */
  coherence?: {
    members_checked: number
    members_coherent: number
    pct: number | null
    pass_count: number
    warn_count: number
    error_count: number
    declared_conventions: number
  } | null
}

export interface SkillsetInstallInfo {
  name: string
  source_url: string
  score: number | null
  spec_version: string
  trust_tier: 'verified' | 'community'
  skills: Array<{ name: string; source_url: string }>
}

export interface SkillsetSearchResponse {
  skillsets: RegistrySkillset[]
  total: number
  limit: number
  offset: number
}

export interface PublishSkillsetBody {
  name: string
  source_url: string
  tags?: string[]
}

export interface PublishSkillsetResponse {
  skillset: RegistrySkillset
  diagnostics: Array<{ level: string; line?: number; message: string }>
  /**
   * The full coherence result the registry computed, not the summary carried on `skillset`.
   *
   * Publishing is the moment the detail is worth having: it is the publisher's own skillset, and
   * a contradiction between two of its members is something only they can fix. The shape matches
   * the local validator's SkillsetCoherenceResult, because the registry runs a port of it.
   * Optional — a registry predating spec 1.1 omits it.
   */
  coherence?: SkillsetCoherenceResult
}

export async function searchSkillsets(options: SearchOptions = {}): Promise<SkillsetSearchResponse> {
  const params = new URLSearchParams()
  if (options.q) params.set('q', options.q)
  if (options.tier) params.set('tier', options.tier)
  if (options.min_score !== undefined) params.set('min_score', String(options.min_score))
  if (options.spec_version) params.set('spec_version', options.spec_version)
  if (options.tags) params.set('tags', options.tags)
  if (options.sort) params.set('sort', options.sort)
  if (options.limit !== undefined) params.set('limit', String(options.limit))
  if (options.offset !== undefined) params.set('offset', String(options.offset))

  const qs = params.toString()
  return registryFetch<SkillsetSearchResponse>(`/skillsets${qs ? `?${qs}` : ''}`)
}

export async function getSkillset(name: string): Promise<RegistrySkillset> {
  return registryFetch<RegistrySkillset>(`/skillsets/${encodeURIComponent(name)}`)
}

export async function getSkillsetInstallInfo(name: string): Promise<SkillsetInstallInfo> {
  return registryFetch<SkillsetInstallInfo>(`/skillsets/${encodeURIComponent(name)}/install`)
}

export async function publishSkillset(
  token: string,
  body: PublishSkillsetBody
): Promise<PublishSkillsetResponse> {
  return registryFetch<PublishSkillsetResponse>('/skillsets', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  })
}

export async function updateSkillset(
  token: string,
  name: string
): Promise<PublishSkillsetResponse> {
  return registryFetch<PublishSkillsetResponse>(`/skillsets/${encodeURIComponent(name)}`, {
    method: 'PATCH',
    headers: { Authorization: `Bearer ${token}` },
  })
}

export async function deleteSkillset(token: string, name: string): Promise<void> {
  await registryFetch<void>(`/skillsets/${encodeURIComponent(name)}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${token}` },
  })
}
