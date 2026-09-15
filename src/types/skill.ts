// The validation types are the rubric's, and the rubric now lives in one package shared with the
// registry (@skilldex/validator). Re-exported here so that every call site in this repo keeps its
// existing import, and so there is still one name for them locally.
import type { SkillFrontmatter } from '@skilldex/validator'

export type {
  CheckScore,
  SkillFrontmatter,
  ValidationDiagnostic,
  ValidationResult,
  ValidationSeverity,
} from '@skilldex/validator'

export interface SkillPackage {
  name: string
  path: string
  frontmatter: SkillFrontmatter
  lineCount: number
  hasScripts: boolean
  hasReferences: boolean
  hasAssets: boolean
}

