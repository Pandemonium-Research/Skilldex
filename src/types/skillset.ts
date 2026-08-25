import type { ValidationDiagnostic } from './skill.js'

export interface RemoteSkillRef {
  name: string
  source_url: string
}

export interface SkillsetFrontmatter {
  name: string
  description: string
  version?: string
  tags?: string[]
  author?: string
  spec_version?: string
  skills?: RemoteSkillRef[]
}

export interface SkillsetValidationResult {
  skillset: string
  score: number
  diagnostics: ValidationDiagnostic[]
  specVersion: string
  embeddedSkills: string[]
  remoteSkills: RemoteSkillRef[]
  passCount: number
  warnCount: number
  errorCount: number
  coherence: SkillsetCoherenceResult
}

// --- Coherence ---

export type CoherenceCheck =
  | 'shared-asset-referenced'
  | 'shared-asset-resolvable'
  | 'shared-asset-agreement'
  | 'undeclared-convention'

/** A key -> value mapping a shared asset declares as binding on the skillset's members. */
export interface DeclaredConvention {
  name: string
  /** Path relative to the skillset root, e.g. "assets/commit-conventions.md". */
  assetFile: string
  /** 1-indexed line of the declaring fence. */
  line: number
  mapping: Record<string, string>
}

export interface CoherenceDiagnostic {
  severity: 'pass' | 'warning' | 'error'
  check: CoherenceCheck
  /** Embedded skill directory name. */
  member: string
  message: string
  /** 1-indexed line in the member's SKILL.md. */
  line?: number
  conventionName?: string
  key?: string
  declaredValue?: string
  memberValue?: string
  assetFile?: string
  assetLine?: number
}

export interface SkillsetCoherenceResult {
  declaredConventions: DeclaredConvention[]
  diagnostics: CoherenceDiagnostic[]
  membersChecked: number
  membersCoherent: number
  passCount: number
  warnCount: number
  errorCount: number
}

export interface MarkdownTable {
  /** 1-indexed line of the header row. */
  line: number
  header: string[]
  rows: string[][]
}
