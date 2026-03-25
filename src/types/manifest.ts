import type { ScopeLevel } from './scope.js'

export type SkillSource = 'official' | 'community' | 'local'

export interface InstalledSkill {
  name: string
  version: string
  source: SkillSource
  sourceUrl?: string
  installedAt: string
  specVersion: string
  score: number
  path: string
}

export interface SkillManifest {
  skilldexVersion: string
  scope: ScopeLevel
  skills: Record<string, InstalledSkill>
  updatedAt: string
}
