export type ScopeLevel = 'global' | 'shared' | 'project'

export interface ScopeConfig {
  level: ScopeLevel
  rootPath: string
  manifestPath: string
  skillsDir: string
}
