// Skilldex Registry API client
// Connects to the hosted registry at SKILLDEX_REGISTRY_URL (default: https://registry.skilldex.dev/v1)

const REGISTRY_BASE = process.env.SKILLDEX_REGISTRY_URL ?? 'https://registry.skilldex.dev/v1'

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

export interface SearchOptions {
  q?: string
  tier?: 'verified' | 'community'
  min_score?: number
  spec_version?: string
  tags?: string
  sort?: 'installs' | 'score' | 'recent' | 'name'
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
  const url = `${REGISTRY_BASE}${path}`
  const res = await fetch(url, {
    headers: { 'Content-Type': 'application/json', ...options?.headers },
    ...options,
  })

  if (!res.ok) {
    let message = `Registry error ${res.status}`
    try {
      const body = (await res.json()) as { error?: string }
      if (body.error) message = body.error
    } catch {}
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
