import { validateSkillset } from '../../core/skillset-validator.js'
import { printJson, printError, printSuccess, printWarning } from '../ui/output.js'
import chalk from 'chalk'

export async function runSkillsetValidate(
  skillsetPath: string,
  options: { json: boolean }
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

    if (result.errorCount > 0) {
      console.log('')
      printError(`${result.errorCount} error(s) found — skillset cannot be installed`)
      process.exit(1)
    } else if (result.warnCount > 0) {
      console.log('')
      printWarning(`${result.warnCount} warning(s) found`)
    } else {
      console.log('')
      printSuccess('Skillset is valid')
    }
  } catch (e) {
    printError(e instanceof Error ? e.message : String(e))
    process.exit(1)
  }
}
