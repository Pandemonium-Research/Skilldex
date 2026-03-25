import type { SkillSource } from './manifest.js'

export interface RegistryEntry {
  name: string
  description: string
  source: SkillSource
  sourceUrl: string
  score: number
  specVersion: string
  tags: string[]
  publishedAt: string
}

export interface SearchResult {
  entries: RegistryEntry[]
  query: string
  total: number
}
