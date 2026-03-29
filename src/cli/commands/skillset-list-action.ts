import chalk from 'chalk'
import type { ScopeLevel } from '../../types/scope.js'
import { resolveAllScopes, resolveScope } from '../../core/resolver.js'
import { readManifest } from '../../core/manifest.js'
import { printJson, printError } from '../ui/output.js'

export async function runSkillsetList(options: { scope?: ScopeLevel; json: boolean }): Promise<void> {
  try {
    const scopeConfigs = options.scope
      ? [await resolveScope(options.scope)]
      : await resolveAllScopes()

    const results = []
    for (const sc of scopeConfigs) {
      const manifest = await readManifest(sc)
      results.push({ level: sc.level, skillsets: Object.values(manifest.skillsets) })
    }

    if (options.json) {
      printJson(results)
      return
    }

    let total = 0
    for (const { level, skillsets } of results) {
      total += skillsets.length
      console.log(chalk.bold(`\n${level} scope`))
      if (skillsets.length === 0) {
        console.log(chalk.dim('  (no skillsets installed)'))
      } else {
        for (const skillset of skillsets) {
          const score =
            skillset.score >= 80
              ? chalk.green(`${skillset.score}`)
              : skillset.score >= 50
                ? chalk.yellow(`${skillset.score}`)
                : chalk.red(`${skillset.score}`)
          const skillCount = skillset.embeddedSkills.length + skillset.remoteSkills.length
          console.log(
            `  ${chalk.cyan(skillset.name.padEnd(30))} score: ${score}/100  skills: ${skillCount}  source: ${chalk.dim(skillset.source)}`
          )
        }
      }
    }
    console.log('')
    console.log(chalk.dim(`${total} skillset(s) installed across ${results.length} scope(s)`))
  } catch (e) {
    printError(e instanceof Error ? e.message : String(e))
    process.exit(1)
  }
}
