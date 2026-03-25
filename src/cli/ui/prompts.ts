import { select, confirm, input } from '@inquirer/prompts'
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
    console.log(
      `  ${chalk.dim(`${i + 1}.`)} ${chalk.cyan(p.skillName.padEnd(30))} ${chalk.dim(`[${p.suggestedScope}]`)}`
    )
    console.log(`     ${chalk.dim(p.reason)}`)
  })
  console.log('')

  const approved: ApprovedSkill[] = []

  for (const proposal of proposals) {
    const action = await select({
      message: `${chalk.cyan(proposal.skillName)}: Install?`,
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
