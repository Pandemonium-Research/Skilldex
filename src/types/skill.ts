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

/**
 * One check's share of the aggregate score.
 *
 * The aggregate hides what it is made of: a skill can score 94 while failing the check that
 * decides whether an agent ever invokes it. Reporting each check's points beside the total makes
 * that visible without asking anyone to trust the total.
 */
export interface CheckScore {
  check: string
  earned: number
  possible: number
  /**
   * The worst severity this check emitted, or `skipped` when it never ran because something it
   * depends on failed first — a missing description has no length to measure. Kept distinct from
   * a failure so that 0 points for "not evaluated" does not read as 0 points for "failed".
   */
  status: ValidationSeverity | 'skipped'
}

export interface ValidationResult {
  skill: string
  score: number
  diagnostics: ValidationDiagnostic[]
  specVersion: string
  passCount: number
  warnCount: number
  errorCount: number
  /** Every scored check, in a fixed order. `earned` sums to `score`. */
  breakdown: CheckScore[]
}
