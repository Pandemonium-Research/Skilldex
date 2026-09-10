import ora from 'ora'
import chalk from 'chalk'
import { gatherProjectContext, suggestForProject } from '../../core/suggest-agent.js'
import { describeEmptyProfile } from '../../core/project-context.js'
import { findProjectRoot } from '../../core/resolver.js'
import type { CandidatePool } from '../../core/suggest-retrieval.js'
import { printJson, printError, printWarning } from '../ui/output.js'

/**
 * Say when the pool is incomplete.
 *
 * Registry search fails often enough to matter — some queries exceed the platform's 30s ceiling —
 * and a pool missing two of ten searches is not the same as a project with nothing to suggest.
 * Reporting the difference is the user's only way to tell "nothing fits" from "we did not look
 * properly".
 */
function reportFailedQueries(pool: CandidatePool): void {
  const failed = pool.queries.filter((q) => q.status !== 'ok')
  if (failed.length === 0) return

  printWarning(
    `${failed.length} of ${pool.queries.length} registry searches did not complete ` +
      `(${failed.map((q) => `${q.query}: ${q.status}`).join(', ')}). Suggestions may be incomplete.`
  )
}

export async function runSuggest(options: {
  projectPath?: string
  yes: boolean
  json: boolean
}): Promise<void> {
  try {
    const projectRoot = await findProjectRoot(options.projectPath ?? process.cwd())

    const spinner = options.json ? null : ora('Gathering project context...').start()
    const context = await gatherProjectContext(projectRoot)

    // Saying nothing was found beats asking the model anyway. With no context it will still
    // produce a confident list, and every name on it will be one it made up.
    if (context.profile.isEmpty) {
      if (spinner) spinner.stop()
      if (options.json) {
        printJson({ proposals: [], reason: 'no-project-context', projectRoot })
      } else {
        printWarning(describeEmptyProfile(context.profile))
      }
      return
    }

    if (spinner) spinner.text = 'Searching the registry...'

    const run = await suggestForProject(context.profile)
    const { proposals, pool, queries } = run
    if (spinner) spinner.stop()

    if (options.json) {
      printJson({
        proposals,
        queries,
        // Failed searches are reported rather than swallowed: a thin result because half the
        // queries timed out looks exactly like a project with few relevant skills.
        search: {
          candidates: pool.candidates.length,
          alreadyInstalled: pool.alreadyInstalled,
          elapsedMs: pool.elapsedMs,
          queries: pool.queries,
        },
      })
      return
    }

    reportFailedQueries(pool)

    if (proposals.length === 0) {
      console.log(
        chalk.dim(
          pool.candidates.length === 0
            ? 'No matching skills found in the registry for this project.'
            : `Found ${pool.candidates.length} registry skills, none a good fit for this project.`
        )
      )
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

    // These are registry skills with qualified names, so they install like any other. The old
    // code printed a "registry install not yet available" warning here and installed nothing —
    // true of the invented names it was given, and untrue of the registry path, which worked.
    const { runInstall } = await import('./install-action.js')
    for (const { proposal, scope } of approved) {
      await runInstall(proposal.qualifiedName, { scope, force: false, json: false })
    }
  } catch (e) {
    printError(e instanceof Error ? e.message : String(e))
    process.exit(1)
  }
}
