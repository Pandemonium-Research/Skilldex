import type { ValidationDiagnostic } from './skill.js'
import type { RemoteSkillRef, SkillsetCoherenceResult } from '@skilldex/validator'

// The skillset rubric and its coherence checks live in @skilldex/validator, shared with the
// registry. Re-exported so every call site in this repo keeps its existing import.
export type {
  AssetReference,
  CoherenceCheck,
  CoherenceDiagnostic,
  CoherenceSource,
  DeclaredConvention,
  MarkdownTable,
  RemoteSkillRef,
  SkillsetCoherenceResult,
} from '@skilldex/validator'

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
