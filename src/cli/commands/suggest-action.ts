import path from 'node:path'
import ora from 'ora'
import chalk from 'chalk'
import { gatherProjectContext, suggestForProject } from '../../core/suggest-agent.js'
import type { SkillGap } from '../../core/suggest-agent.js'
import { describeEmptyProfile } from '../../core/project-context.js'
import { findProjectRoot } from '../../core/resolver.js'
import type { CandidatePool } from '../../core/suggest-retrieval.js'
import { printJson, printError, printWarning, printValidationReport } from '../ui/output.js'

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

/**
 * Offer to write the skills the registry does not have.
 *
 * Drafted, never installed straight into scope. A published skill the user picked is one thing; a
 * generated one is unreviewed text that would be read into an agent's context every session
 * afterwards, so it gets written to `.skilldex/drafts/`, scored, and installed only on a second
 * yes. `--yes` writes the drafts but still does not install them: it means "approve the
 * suggestions", not "adopt generated content unseen".
 */
async function offerDrafts(
  projectRoot: string,
  context: string,
  gaps: SkillGap[],
  options: { yes: boolean; json: boolean }
): Promise<void> {
  if (gaps.length === 0) return

  console.log(chalk.bold('\nNot in the registry — these would have to be written:'))
  for (const gap of gaps) {
    console.log(`  ${chalk.yellow(gap.name)}`)
    console.log(`     ${chalk.dim(gap.purpose)}`)
    if (gap.reason) console.log(`     ${chalk.dim(gap.reason)}`)
  }
  console.log('')

  const { confirm } = await import('@inquirer/prompts')
  const { createSkillDraft } = await import('../../core/skill-draft.js')
  const { runInstall } = await import('./install-action.js')

  for (const gap of gaps) {
    if (!options.yes && !(await confirm({ message: `Draft "${gap.name}"?`, default: false }))) {
      continue
    }

    const spinner = ora(`Writing ${gap.name}...`).start()
    const draft = await createSkillDraft(projectRoot, gap, context, {})
    spinner.stop()

    const { score, errorCount, warnCount } = draft.validation
    const verdict = errorCount > 0 ? chalk.red(`${errorCount} error(s)`) : chalk.green('valid')
    console.log(
      `  ${chalk.yellow(gap.name)} — ${verdict}, score ${score}/100` +
        (warnCount > 0 ? `, ${warnCount} warning(s)` : '') +
        (draft.repaired ? chalk.dim(' (regenerated once from validator errors)') : '')
    )
    console.log(`  ${chalk.dim(path.relative(projectRoot, draft.dir).replace(/\\/g, '/'))}`)

    if (errorCount > 0) {
      printValidationReport(draft.validation)
      console.log(chalk.dim('  Left as a draft — fix it, then: skillpm install <path>'))
      continue
    }

    // A valid draft is still a draft. Installing is the user's call, separately.
    if (options.yes) {
      console.log(chalk.dim('  Draft written. Install it with: skillpm install <path>'))
      continue
    }

    if (await confirm({ message: `Install "${gap.name}" now?`, default: true })) {
      await runInstall(draft.dir, { scope: 'project', force: false, json: false })
    }
  }
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
        // Named separately from proposals because they are not the same kind of thing: a gap has
        // no qualifiedName and nothing to install. Merging them is how the original command came
        // to present invented names as installable.
        gaps: run.gaps,
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
    } else {
      let approved = proposals.map((p) => ({ proposal: p, scope: p.suggestedScope }))

      if (!options.yes) {
        const { promptSuggestions } = await import('../ui/prompts.js')
        approved = await promptSuggestions(proposals)
      }

      if (approved.length === 0) {
        console.log(chalk.dim('No skills approved for installation.'))
      } else {
        console.log(`\nInstalling ${approved.length} skill(s)...`)

        // Registry skills with qualified names, so they install like any other. The old code
        // printed "registry install not yet available" here and installed nothing — true of the
        // invented names it was given, untrue of the registry path, which worked.
        const { runInstall } = await import('./install-action.js')
        for (const { proposal, scope } of approved) {
          await runInstall(proposal.qualifiedName, { scope, force: false, json: false })
        }
      }
    }

    await offerDrafts(projectRoot, context.text, run.gaps, options)
  } catch (e) {
    printError(e instanceof Error ? e.message : String(e))
    process.exit(1)
  }
}
