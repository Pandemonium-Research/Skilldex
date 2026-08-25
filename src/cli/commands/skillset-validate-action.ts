import { validateSkillset } from '../../core/skillset-validator.js'
import { printJson, printError, printSuccess, printWarning } from '../ui/output.js'
import chalk from 'chalk'
import type { CoherenceDiagnostic } from '../../types/skillset.js'

export async function runSkillsetValidate(
  skillsetPath: string,
  options: { json: boolean; strict?: boolean }
): Promise<void> {
  try {
    const result = await validateSkillset(skillsetPath)

    if (options.json) {
      printJson(result)
      return
    }

    for (const diag of result.diagnostics) {
      const loc = diag.line !== undefined ? `line ${diag.line}: ` : ''
      const severity =
        diag.severity === 'error'
          ? chalk.red('error  ')
          : diag.severity === 'warning'
            ? chalk.yellow('warn   ')
            : chalk.green('pass   ')
      console.log(`  ${severity} ${loc}${diag.message}`)
    }

    console.log('')

    const scoreColor =
      result.score >= 80 ? chalk.green : result.score >= 50 ? chalk.yellow : chalk.red
    console.log(`Format conformance score: ${scoreColor(String(result.score))}/100`)
    console.log(`Validated against: skillset-format v${result.specVersion}`)

    if (result.embeddedSkills.length > 0) {
      console.log(`Embedded skills:  ${result.embeddedSkills.join(', ')}`)
    }
    if (result.remoteSkills.length > 0) {
      console.log(`Remote skills:    ${result.remoteSkills.map((s) => s.name).join(', ')}`)
    }

    printCoherence(result.coherence)

    const { coherence } = result

    if (result.errorCount > 0) {
      console.log('')
      printError(`${result.errorCount} error(s) found — skillset cannot be installed`)
      process.exit(1)
    }

    if (coherence.errorCount > 0 && options.strict) {
      console.log('')
      printError(
        `${coherence.errorCount} coherence error(s) found — members contradict a declared convention`
      )
      process.exit(1)
    }

    if (result.warnCount > 0 || coherence.warnCount > 0 || coherence.errorCount > 0) {
      console.log('')
      const parts: string[] = []
      if (result.warnCount > 0) parts.push(`${result.warnCount} format warning(s)`)
      if (coherence.errorCount > 0) parts.push(`${coherence.errorCount} coherence error(s)`)
      if (coherence.warnCount > 0) parts.push(`${coherence.warnCount} coherence warning(s)`)
      printWarning(parts.join(', '))
      if (coherence.errorCount > 0) {
        console.log(chalk.dim('  Re-run with --strict to fail on coherence errors.'))
      }
    } else {
      console.log('')
      printSuccess('Skillset is valid')
    }
  } catch (e) {
    printError(e instanceof Error ? e.message : String(e))
    process.exit(1)
  }
}

function printCoherence(coherence: import('../../types/skillset.js').SkillsetCoherenceResult): void {
  if (coherence.membersChecked === 0) return

  const ratio = `${coherence.membersCoherent}/${coherence.membersChecked}`
  const color =
    coherence.errorCount > 0
      ? chalk.red
      : coherence.membersCoherent === coherence.membersChecked
        ? chalk.green
        : chalk.yellow

  console.log('')
  console.log(`Coherence: ${color(ratio)} member(s) agree with the skillset's shared conventions`)

  if (coherence.declaredConventions.length === 0) {
    console.log(
      chalk.dim('  No conventions declared — add a ```yaml skilldex-conventions``` block to a')
    )
    console.log(chalk.dim('  shared asset so member agreement can be enforced.'))
  } else {
    for (const convention of coherence.declaredConventions) {
      const keyCount = Object.keys(convention.mapping).length
      console.log(
        chalk.dim(
          `  declared: ${convention.name} (${keyCount} keys) — ${convention.assetFile}:${convention.line}`
        )
      )
    }
  }

  for (const diag of orderForDisplay(coherence.diagnostics)) {
    const severity =
      diag.severity === 'error'
        ? chalk.red('error  ')
        : diag.severity === 'warning'
          ? chalk.yellow('warn   ')
          : chalk.green('pass   ')
    const loc = diag.line !== undefined ? `${diag.member}:${diag.line}: ` : `${diag.member}: `
    console.log(`  ${severity} ${loc}${stripMemberPrefix(diag)}`)
  }
}

/** Errors first — a contradiction should not scroll off behind a wall of passes. */
function orderForDisplay(diagnostics: CoherenceDiagnostic[]): CoherenceDiagnostic[] {
  const rank = { error: 0, warning: 1, pass: 2 } as const
  return [...diagnostics].sort((a, b) => rank[a.severity] - rank[b.severity])
}

/** The member name is already shown as the location prefix. */
function stripMemberPrefix(diag: CoherenceDiagnostic): string {
  return diag.message.startsWith(`"${diag.member}" `)
    ? diag.message.slice(diag.member.length + 3)
    : diag.message
}
