import chalk from 'chalk'
import type { ScopeLevel } from '../../types/scope.js'
import type { SkillManifest } from '../../types/manifest.js'
import { resolveAllScopes, resolveScope } from '../../core/resolver.js'
import { readManifest } from '../../core/manifest.js'
import { printJson, printError } from '../ui/output.js'

export async function runList(options: { scope?: ScopeLevel; json: boolean }): Promise<void> {
  try {
    const scopeConfigs = options.scope
      ? [await resolveScope(options.scope)]
      : await resolveAllScopes()

    const results: Array<{ level: ScopeLevel; manifest: SkillManifest }> = []
    for (const sc of scopeConfigs) {
      const manifest = await readManifest(sc)
      results.push({ level: sc.level, manifest })
    }

    if (options.json) {
      printJson(
        results.map((r) => ({
          level: r.level,
          skills: Object.values(r.manifest.skills),
        }))
      )
      return
    }

    let totalSkills = 0
    for (const { level, manifest } of results) {
      const skills = Object.values(manifest.skills)
      totalSkills += skills.length
      console.log(chalk.bold(`\n${level} scope`))
      if (skills.length === 0) {
        console.log(chalk.dim('  (no skills installed)'))
      } else {
        for (const skill of skills) {
          const score = skill.score >= 80 ? chalk.green(`${skill.score}`) :
            skill.score >= 50 ? chalk.yellow(`${skill.score}`) : chalk.red(`${skill.score}`)
          console.log(
            `  ${chalk.cyan(skill.name.padEnd(30))} score: ${score}/100  source: ${chalk.dim(skill.source)}`
          )
        }
      }
    }
    console.log('')
    console.log(chalk.dim(`${totalSkills} skill(s) installed across ${results.length} scope(s)`))
  } catch (e) {
    printError(e instanceof Error ? e.message : String(e))
    process.exit(1)
  }
}
