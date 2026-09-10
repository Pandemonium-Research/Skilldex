import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { validateSkill } from './validator.js'
import { generateSkillDraft, type Complete, type SkillGap } from './suggest-agent.js'
import type { ValidationResult } from '../types/skill.js'

/**
 * Writing a skill the registry does not have.
 *
 * Drafts land on disk and are *not* installed. A published skill someone chose to install is one
 * thing; a generated one is unreviewed text that would be read into an agent's context on every
 * session afterwards, and the difference is worth one confirmation step. The caller shows the
 * conformance score and the path, and installs only if the user says so.
 *
 * They go under `.skilldex/drafts/` rather than into a scope's skills directory, so an
 * abandoned draft is inert: nothing discovers it, nothing bridges it into a harness, and deleting
 * it is a directory removal with no manifest to reconcile.
 */

export const DRAFTS_DIR = path.join('.skilldex', 'drafts')

export interface SkillDraft {
  name: string
  /** Directory holding SKILL.md — pass this to `skillpm install` to adopt the draft. */
  dir: string
  content: string
  validation: ValidationResult
  /** True when the first attempt failed validation and a second was generated from its errors. */
  repaired: boolean
}

/**
 * Generate, write, validate, and repair once if needed.
 *
 * The validator runs against the file on disk rather than the string in memory, because that is
 * what it will be validated as later — frontmatter parsing is sensitive to line endings, and this
 * repo has a standing bug class where a CRLF-terminated frontmatter delimiter scores zero.
 */
export async function createSkillDraft(
  projectRoot: string,
  gap: SkillGap,
  context: string,
  options: { complete?: Complete } = {}
): Promise<SkillDraft> {
  const dir = path.join(projectRoot, DRAFTS_DIR, gap.name)
  await mkdir(dir, { recursive: true })
  const file = path.join(dir, 'SKILL.md')

  let content = await generateSkillDraft(context, gap, options)
  await writeFile(file, content, 'utf8')
  let validation = await validateSkill(dir)
  let repaired = false

  // One retry, with the errors quoted back. A model told its description is twelve words and must
  // be thirty will generally fix it; one that fails twice is failing for a reason a third attempt
  // will not reach either, and the draft is handed over with its diagnostics instead.
  if (validation.errorCount > 0) {
    const diagnostics = validation.diagnostics
      .filter((d) => d.severity === 'error')
      .map((d) => d.message)

    content = await generateSkillDraft(context, gap, { ...options, diagnostics })
    await writeFile(file, content, 'utf8')
    validation = await validateSkill(dir)
    repaired = true
  }

  return { name: gap.name, dir, content, validation, repaired }
}
