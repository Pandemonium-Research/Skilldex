import { select } from '@inquirer/prompts'
import chalk from 'chalk'
import type { SuggestionProposal } from '../../core/suggest-agent.js'
import type { ScopeLevel } from '../../types/scope.js'

export interface ApprovedSkill {
  proposal: SuggestionProposal
  scope: ScopeLevel
}

export async function promptSuggestions(
  proposals: SuggestionProposal[]
): Promise<ApprovedSkill[]> {
  console.log(chalk.bold('\nProposed skills for this project:'))
  proposals.forEach((p, i) => {
    // Identified by owner/name, because a bare name does not identify a skill: ten owners publish
    // one called `terraform`, and the qualified form is the one that installs.
    const score = p.score === null ? '' : chalk.dim(`  ${p.score}/100`)
    console.log(
      `  ${chalk.dim(`${i + 1}.`)} ${chalk.cyan(p.qualifiedName.padEnd(38))} ${chalk.dim(
        `[${p.suggestedScope}]`
      )}${score}`
    )
    console.log(`     ${chalk.dim(p.reason)}`)
  })
  console.log('')

  const approved: ApprovedSkill[] = []

  for (const proposal of proposals) {
    const action = await select({
      message: `${chalk.cyan(proposal.qualifiedName)}: Install?`,
      choices: [
        { name: 'Yes (project scope)', value: 'project' },
        { name: 'Yes (shared scope)', value: 'shared' },
        { name: 'Yes (global scope)', value: 'global' },
        { name: 'Skip', value: 'skip' },
      ],
      default: proposal.suggestedScope,
    })

    if (action !== 'skip') {
      approved.push({ proposal, scope: action as ScopeLevel })
    }
  }

  return approved
}
