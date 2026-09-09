import chalk from 'chalk'
import ora from 'ora'
import { searchSkillsets } from '../../registry/sources/registry.js'
import { printJson, printError, printInfo } from '../ui/output.js'
import {
  formatCoherence,
  registryCoherenceCounts,
  registryCoherenceJson,
} from '../ui/coherence.js'
import type {
  RegistrySkillset,
  SkillsetSearchSort,
} from '../../registry/sources/registry.js'

function tierBadge(tier: RegistrySkillset['trust_tier']): string {
  return tier === 'verified' ? chalk.blue('[verified]') : chalk.dim('[community]')
}

function scoreLabel(score: number | null): string {
  if (score === null) return chalk.dim('no score')
  if (score >= 80) return chalk.green(`${score}/100`)
  if (score >= 50) return chalk.yellow(`${score}/100`)
  return chalk.red(`${score}/100`)
}

/**
 * Both dimensions on one line, coherence omitted when there is none to report.
 *
 * A skillset with no members checked has no coherence — printing "0/0" would read as a failure
 * rather than an absence, and formatCoherence returns null for exactly that reason. Same
 * treatment as install and publish, so the number means the same thing wherever it appears.
 */
function renderSkillsetCard(skillset: RegistrySkillset): void {
  console.log(`\n${chalk.bold(skillset.name)} ${tierBadge(skillset.trust_tier)}`)
  console.log(`  ${skillset.description}`)

  const stats = [
    `Score: ${scoreLabel(skillset.score)}`,
    formatCoherence(registryCoherenceCounts(skillset.coherence)),
    `Skills: ${skillset.skill_count}`,
    `Installs: ${skillset.install_count}`,
    `Spec: v${skillset.spec_version}`,
  ].filter(Boolean)
  console.log(`  ${stats.join('  ·  ')}`)

  if (skillset.tags.length > 0) {
    console.log(`  Tags: ${skillset.tags.map((t) => chalk.cyan(t)).join(', ')}`)
  }
  console.log(`  ${chalk.dim(`skillpm skillset install ${skillset.name}`)}`)
}

export async function runSkillsetSearch(
  query: string | undefined,
  options: {
    tier?: string
    sort?: string
    limit: string
    minCoherence?: string
    json: boolean
  }
): Promise<void> {
  const limit = Math.min(parseInt(options.limit, 10) || 10, 50)

  // Parsed here rather than passed through as a string: the registry rejects a non-numeric
  // min_coherence with a 400, and reporting that as a registry error would blame the server for
  // a typo in the flag.
  let minCoherence: number | undefined
  if (options.minCoherence !== undefined) {
    minCoherence = Number(options.minCoherence)
    if (!Number.isInteger(minCoherence) || minCoherence < 0 || minCoherence > 100) {
      printError('--min-coherence must be a whole number between 0 and 100')
      process.exitCode = 1
      return
    }
  }

  const label = query ? `Searching skillsets for "${query}"...` : 'Listing skillsets...'
  const spinner = options.json ? null : ora(label).start()

  try {
    const result = await searchSkillsets({
      q: query,
      tier: options.tier as RegistrySkillset['trust_tier'] | undefined,
      // Undefined when unset, never defaulted — the registry resolves an absent sort to relevance
      // when there is a query and to installs when there is not, and any explicit value is
      // returned unchanged, so defaulting here would silently opt out of that.
      sort: options.sort as SkillsetSearchSort | undefined,
      min_coherence: minCoherence,
      limit,
    })

    if (spinner) spinner.stop()

    if (options.json) {
      printJson({
        ...result,
        skillsets: result.skillsets.map((s) => ({
          ...s,
          coherence: registryCoherenceJson(s.coherence),
        })),
      })
      return
    }

    if (result.skillsets.length === 0) {
      printInfo(query ? `No skillsets found for "${query}"` : 'No skillsets published yet')
      return
    }

    const forQuery = query ? ` for "${query}"` : ''
    console.log(
      chalk.bold(
        `\nFound ${result.total} skillset${result.total === 1 ? '' : 's'}${forQuery} (showing ${result.skillsets.length})`
      )
    )
    for (const skillset of result.skillsets) {
      renderSkillsetCard(skillset)
    }
    console.log()
  } catch (e) {
    if (spinner) spinner.stop()
    printError(e instanceof Error ? e.message : String(e))
    process.exitCode = 1
  }
}
