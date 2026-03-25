export interface SkillFrontmatter {
  name: string
  description: string
  version?: string
  tags?: string[]
  author?: string
  specVersion?: string
}

export interface SkillPackage {
  name: string
  path: string
  frontmatter: SkillFrontmatter
  lineCount: number
  hasScripts: boolean
  hasReferences: boolean
  hasAssets: boolean
}

export type ValidationSeverity = 'error' | 'warning' | 'pass'

export interface ValidationDiagnostic {
  severity: ValidationSeverity
  line?: number
  message: string
  check: string
}

export interface ValidationResult {
  skill: string
  score: number
  diagnostics: ValidationDiagnostic[]
  specVersion: string
  passCount: number
  warnCount: number
  errorCount: number
}
