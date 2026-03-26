import chalk from 'chalk'
import ora from 'ora'
import { searchRegistry } from '../../registry/sources/registry.js'
import { printJson, printError, printInfo } from '../ui/output.js'
import type { RegistrySkill } from '../../registry/sources/registry.js'

function tierBadge(tier: RegistrySkill['trust_tier']): string {
  return tier === 'verified'
    ? chalk.blue('[verified]')
    : chalk.dim('[community]')
}

function scoreLabel(score: number | null): string {
  if (score === null) return chalk.dim('no score')
  if (score >= 80) return chalk.green(`${score}/100`)
  if (score >= 50) return chalk.yellow(`${score}/100`)
  return chalk.red(`${score}/100`)
}

function renderSkillCard(skill: RegistrySkill, index: number): void {
  console.log(`\n${chalk.bold(skill.name)} ${tierBadge(skill.trust_tier)}`)
  console.log(`  ${skill.description}`)
  console.log(
    `  Score: ${scoreLabel(skill.score)}  ·  Installs: ${skill.install_count}  ·  Spec: v${skill.spec_version}`
  )
  if (skill.tags.length > 0) {
    console.log(`  Tags: ${skill.tags.map(t => chalk.cyan(t)).join(', ')}`)
  }
  console.log(`  ${chalk.dim(`skillpm install ${skill.name}`)}`)
}

export async function runSearch(
  query: string,
  options: { tier?: string; sort: string; limit: string; json: boolean }
): Promise<void> {
  const limit = Math.min(parseInt(options.limit, 10) || 10, 50)
  const spinner = options.json ? null : ora(`Searching registry for "${query}"...`).start()

  try {
    const result = await searchRegistry({
      q: query,
      tier: options.tier as RegistrySkill['trust_tier'] | undefined,
      sort: options.sort as 'installs' | 'score' | 'recent' | 'name',
      limit,
    })

    if (spinner) spinner.stop()

    if (options.json) {
      printJson(result)
      return
    }

    if (result.skills.length === 0) {
      printInfo(`No skills found for "${query}"`)
      return
    }

    console.log(chalk.bold(`\nFound ${result.total} skill${result.total === 1 ? '' : 's'} for "${query}" (showing ${result.skills.length})`))
    for (const skill of result.skills) {
      renderSkillCard(skill, 0)
    }
    console.log('')
  } catch (e) {
    if (spinner) spinner.fail()
    printError(e instanceof Error ? e.message : String(e))
    process.exit(1)
  }
}
