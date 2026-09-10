// Skilldex Registry API client
// Connects to the hosted registry at SKILLDEX_REGISTRY_URL (default: DEFAULT_REGISTRY_URL below)
// Resolution order: env var → config file → built-in default

import type { SkillsetCoherenceResult } from '../../types/skillset.js'

/**
 * Where the registry lives when nothing says otherwise.
 *
 * A constant because the value was previously written out at each use, and the comment at the top
 * of this file documented a third, different host — `registry.skilldex.dev`, which does not
 * resolve. Two commands still told users to fetch an auth token from it.
 */
const DEFAULT_REGISTRY_URL = 'https://skilldex-registry.vercel.app/v1'

async function getRegistryBase(): Promise<string> {
  // Env var first, as documented above. It used to be read only from the catch branch, so it took
  // effect solely when importing the config module threw — which is to say, essentially never:
  // setting SKILLDEX_REGISTRY_URL appeared to do nothing at all.
  if (process.env.SKILLDEX_REGISTRY_URL) return process.env.SKILLDEX_REGISTRY_URL

  try {
    const { getConfigValue } = await import('../../core/config.js')
    return (await getConfigValue('registryUrl')) ?? DEFAULT_REGISTRY_URL
  } catch {
    return DEFAULT_REGISTRY_URL
  }
}

/**
 * Where a user obtains a publish token.
 *
 * Derived from the same base every request uses, rather than written out beside each error
 * message. The two hardcoded copies both named a dead host, so the one instruction a blocked
 * publisher receives sent them somewhere that does not resolve — and pointing anyone running
 * against a custom registry at the public one would have been wrong even had it worked.
 */
export async function getAuthUrl(): Promise<string> {
  return `${(await getRegistryBase()).replace(/\/$/, '')}/auth/github`
}

export interface RegistrySkill {
  name: string
  /**
   * Who published it, and the `owner/name` that identifies it unambiguously.
   *
   * The registry has sent all three of these since names stopped being unique, and the CLI
   * declared none of them — so nothing here could tell two skills apart when they share a name,
   * and `terraform` alone is claimed by ten owners. `skillpm search` printed ten rows called
   * `terraform` with no way to say which one `skillpm install terraform` would fetch. It would
   * fetch none of them: the unqualified endpoint answers 409 and asks the caller to qualify.
   *
   * Optional because a registry predating qualified names does not send them, and the CLI is
   * routinely a version ahead of the deployment it is talking to.
   */
  owner?: string
  qualified_name?: string
  display_name?: string
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
  owner?: string
  qualified_name?: string
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

/**
 * Path-encode a skill name that may be owner-qualified.
 *
 * `encodeURIComponent` escapes the slash in `mauromedda/terraform` to `%2F`, and the registry
 * routes on real path segments — so the request reaches no route at all and comes back
 * `404 Skill not found` for a skill that exists and answers 200 when the slash is left alone.
 *
 * That made qualified names unreachable from the CLI at exactly the moment they became necessary.
 * Names are not unique: `terraform` is claimed by ten owners, and the unqualified endpoint
 * answers `409 AMBIGUOUS_NAME` telling the caller to use `{owner}/{name}` — the one form that
 * then failed. Both paths out of an ambiguous name were closed.
 *
 * Each segment is still escaped, so a name containing a character that needs encoding is handled;
 * only the separator survives.
 *
 * Skillsets deliberately do not use this. They are not owner-qualified — the registry sends no
 * `owner` or `qualified_name` for them — so a slash in a skillset name is not a separator, and
 * treating it as one would build a URL the registry does not serve.
 */
function encodeSkillPath(name: string): string {
  return name
    .split('/')
    .map((segment) => encodeURIComponent(segment))
    .join('/')
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
  return registryFetch<InstallInfo>(`/skills/${encodeSkillPath(name)}/install`)
}

export async function getSkill(name: string): Promise<RegistrySkill> {
  return registryFetch<RegistrySkill>(`/skills/${encodeSkillPath(name)}`)
}

export async function publishSkill(token: string, body: PublishBody): Promise<PublishResponse> {
  return registryFetch<PublishResponse>('/skills', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  })
}

export async function updateSkill(token: string, name: string): Promise<PublishResponse> {
  return registryFetch<PublishResponse>(`/skills/${encodeSkillPath(name)}`, {
    method: 'PATCH',
    headers: { Authorization: `Bearer ${token}` },
  })
}

export async function deleteSkill(token: string, name: string): Promise<void> {
  await registryFetch<void>(`/skills/${encodeSkillPath(name)}`, {
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

/**
 * Skillsets accept one ordering that skills do not.
 *
 * `coherence` orders by the registry's generated `coherence_pct`. Kept out of `SearchSort` rather
 * than added to it because /skills rejects the value — a skill has no members to agree with each
 * other — and a shared union would let it be sent there and 400.
 */
export type SkillsetSearchSort = SearchSort | 'coherence'

export interface SkillsetSearchOptions extends Omit<SearchOptions, 'sort'> {
  sort?: SkillsetSearchSort
  /** Floor on the percentage of members found coherent, 0-100. */
  min_coherence?: number
}

export async function searchSkillsets(
  options: SkillsetSearchOptions = {}
): Promise<SkillsetSearchResponse> {
  const params = new URLSearchParams()
  if (options.q) params.set('q', options.q)
  if (options.tier) params.set('tier', options.tier)
  if (options.min_score !== undefined) params.set('min_score', String(options.min_score))
  if (options.min_coherence !== undefined) {
    params.set('min_coherence', String(options.min_coherence))
  }
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
