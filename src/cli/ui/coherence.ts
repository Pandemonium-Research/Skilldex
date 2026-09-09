import chalk from 'chalk'
import type { SkillsetCoherenceResult } from '../../types/skillset.js'

/**
 * Compact coherence reporting, for the commands that are not the validator.
 *
 * `skillpm skillset validate` prints every declared convention and every diagnostic, because
 * examining them is the entire point of running it. install and publish are not linting
 * commands: they report the ratio, say plainly whether anything needs attention, and point at
 * validate for the detail. Repeating the full report in three more places would bury the one
 * line people actually came for — whether the thing they just installed hangs together.
 *
 * The shape is the validator's own result, which is also exactly what the registry returns for
 * a published skillset, so the same formatter serves a local install and a remote publish.
 */

/** The subset any caller needs — locally computed or returned by the registry. */
export type CoherenceCounts = Pick<
  SkillsetCoherenceResult,
  'membersChecked' | 'membersCoherent' | 'passCount' | 'warnCount' | 'errorCount'
> & { declaredConventions?: unknown[] }

/**
 * "Coherence: 3/4", coloured by how much attention it wants, or null when there is nothing to
 * report.
 *
 * A skillset with no embedded members has no coherence — printing "0/0" would read as a failure
 * rather than an absence, which is the same reason the registry stores NULL rather than zero.
 */
export function formatCoherence(c: CoherenceCounts | null | undefined): string | null {
  if (!c || c.membersChecked === 0) return null

  const ratio = `${c.membersCoherent}/${c.membersChecked}`
  const color =
    c.errorCount > 0
      ? chalk.red
      : c.membersCoherent === c.membersChecked
        ? chalk.green
        : chalk.yellow

  return `Coherence: ${color(ratio)}`
}

/**
 * The follow-up line, present only when something is actually wrong.
 *
 * An error means a member contradicts a convention its own skillset declares, which is worth
 * interrupting for. A warning usually means a member sits outside the convention guarantee, or
 * restates something in wording the declaration does not use — worth mentioning, not worth
 * spelling out here.
 */
export function coherenceHint(c: CoherenceCounts | null | undefined): string | null {
  if (!c || c.membersChecked === 0) return null

  const parts: string[] = []
  if (c.errorCount > 0) parts.push(`${c.errorCount} coherence error(s)`)
  if (c.warnCount > 0) parts.push(`${c.warnCount} coherence warning(s)`)
  if (parts.length === 0) return null

  return `${parts.join(', ')} — run "skillpm skillset validate" for details`
}

/**
 * The registry's coherence summary, which is snake_case where the validator's is camelCase.
 *
 * Locally-computed coherence arrives as the validator's own result; a searched or fetched skillset
 * arrives as the API DTO. Both describe the same thing, so rather than teach the formatters two
 * shapes, the API shape is adapted once here.
 *
 * Declared structurally rather than imported from the registry client, so the UI layer does not
 * take a dependency on the transport for the sake of six numbers.
 */
export interface RegistryCoherenceSummary {
  members_checked: number
  members_coherent: number
  pct: number | null
  pass_count: number
  warn_count: number
  error_count: number
  declared_conventions: number
}

/** Adapt a registry summary for formatCoherence / coherenceHint. */
export function registryCoherenceCounts(
  s: RegistryCoherenceSummary | null | undefined
): CoherenceCounts | null {
  if (!s) return null

  return {
    membersChecked: s.members_checked,
    membersCoherent: s.members_coherent,
    passCount: s.pass_count,
    warnCount: s.warn_count,
    errorCount: s.error_count,
  }
}

/**
 * Adapt a registry summary for --json.
 *
 * Separate from registryCoherenceCounts because the conventions cannot round-trip through
 * CoherenceCounts: that carries the declarations themselves, and the registry sends only how many
 * there were. Synthesising an array of that length to satisfy the type would be inventing data to
 * make a shape fit.
 */
export function registryCoherenceJson(s: RegistryCoherenceSummary | null | undefined) {
  if (!s) return null

  return {
    membersChecked: s.members_checked,
    membersCoherent: s.members_coherent,
    passCount: s.pass_count,
    warnCount: s.warn_count,
    errorCount: s.error_count,
    declaredConventions: s.declared_conventions,
  }
}

/** Machine-readable summary for --json, in the camelCase the CLI's own output already uses. */
export function coherenceJson(c: CoherenceCounts | null | undefined) {
  if (!c) return null

  return {
    membersChecked: c.membersChecked,
    membersCoherent: c.membersCoherent,
    passCount: c.passCount,
    warnCount: c.warnCount,
    errorCount: c.errorCount,
    declaredConventions: c.declaredConventions?.length ?? 0,
  }
}
