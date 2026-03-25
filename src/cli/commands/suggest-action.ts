import ora from 'ora'
import chalk from 'chalk'
import { gatherProjectContext, generateProposals } from '../../core/suggest-agent.js'
import { findProjectRoot } from '../../core/resolver.js'
import { printJson, printError, printSuccess } from '../ui/output.js'

export async function runSuggest(options: {
  projectPath?: string
  yes: boolean
  json: boolean
}): Promise<void> {
  try {
    const projectRoot = await findProjectRoot(options.projectPath ?? process.cwd())

    const spinner = options.json ? null : ora('Gathering project context...').start()
    const context = await gatherProjectContext(projectRoot)
    if (spinner) spinner.text = 'Generating skill proposals...'

    const proposals = await generateProposals(context)
    if (spinner) spinner.stop()

    if (options.json) {
      printJson({ proposals })
      return
    }

    if (proposals.length === 0) {
      console.log(chalk.dim('No skill suggestions for this project.'))
      return
    }

    let approved = proposals.map((p) => ({ proposal: p, scope: p.suggestedScope }))

    if (!options.yes) {
      const { promptSuggestions } = await import('../ui/prompts.js')
      approved = await promptSuggestions(proposals)
    }

    if (approved.length === 0) {
      console.log(chalk.dim('No skills approved for installation.'))
      return
    }

    console.log(`\nInstalling ${approved.length} skill(s)...`)
    const { installFromPath } = await import('../../core/installer.js')

    const installed: string[] = []
    for (const { proposal, scope } of approved) {
      // Skills from suggest come from the registry — for now we can't actually install
      // them because they may not exist locally. Mark as pending/future feature.
      console.log(
        chalk.dim(
          `  ⚠ "${proposal.skillName}" — registry install not yet available. ` +
            `Use: skillpm install git+<url> --scope ${scope}`
        )
      )
    }

    if (options.json) {
      printJson({ proposals, installed })
    }
  } catch (e) {
    printError(e instanceof Error ? e.message : String(e))
    process.exit(1)
  }
}
