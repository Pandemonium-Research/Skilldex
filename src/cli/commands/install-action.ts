import ora from 'ora'
import type { ScopeLevel } from '../../types/scope.js'
import { installFromPath, type InstallResult } from '../../core/installer.js'
import { isRegistryName, isGitSource } from '../../core/source-kind.js'
import { printValidationReport, printJson, printError, printSuccess, printWarning, printInfo } from '../ui/output.js'


/**
 * An install that did not bridge is invisible to every agent, so say what happened.
 * Linked paths are informational; a conflict is a warning, because that harness will not
 * see this skill until the user resolves it.
 */
function reportBridging(bridged: InstallResult['bridged']): void {
  for (const link of bridged) {
    if (link.linked) {
      printInfo(`Linked into ${link.target}`)
    } else {
      printWarning(`Not linked: ${link.target} — ${link.conflict}`)
    }
  }
}

export async function runInstall(
  source: string,
  options: { scope: ScopeLevel; force: boolean; json: boolean; bridge?: boolean }
): Promise<void> {
  const isGitUrl = isGitSource(source)

  if (!isGitUrl && isRegistryName(source)) {
    await runRegistryInstall(source, options)
    return
  }

  if (isGitUrl) {
    await runGitInstall(source, options)
    return
  }

  const spinner = options.json ? null : ora(`Validating ${source}...`).start()

  try {
    if (spinner) spinner.text = `Validating ${source}...`
    const result = await installFromPath(source, {
      scope: options.scope,
      force: options.force,
      bridge: options.bridge,
    })

    if (spinner) spinner.succeed(`Installed "${result.skillName}" at ${result.scope} scope`)

    if (options.json) {
      printJson({
        installed: true,
        skillName: result.skillName,
        scope: result.scope,
        score: result.validation.score,
        diagnostics: result.validation.diagnostics,
        bridged: result.bridged,
      })
    } else {
      if (result.validation.warnCount > 0 || result.validation.errorCount > 0) {
        console.log('')
        printValidationReport(result.validation)
      } else {
        printSuccess(`Score: ${result.validation.score}/100`)
      }
    }

    reportBridging(result.bridged)
  } catch (e) {
    if (spinner) spinner.fail()
    printError(e instanceof Error ? e.message : String(e))
    process.exit(1)
  }
}

async function runRegistryInstall(
  name: string,
  options: { scope: ScopeLevel; force: boolean; json: boolean; bridge?: boolean }
): Promise<void> {
  const spinner = options.json ? null : ora(`Looking up "${name}" in registry...`).start()
  try {
    const { getSkillInstallInfo, isAmbiguousNameError, MAX_REPORTED_OWNERS } = await import(
      '../../registry/sources/registry.js'
    )

    let info
    try {
      info = await getSkillInstallInfo(name)
    } catch (e) {
      if (!isAmbiguousNameError(e)) throw e

      // A bare name claimed by several owners. The registry says so and names them — but what it
      // suggests in prose is an HTTP path, `use /skills/{owner}/<name>/install`, which is not
      // something anyone can type into this CLI. The owners are right there in the error, so
      // offer them instead of reprinting a URL.
      const candidates = e.owners.map((owner) => `${owner}/${name}`)
      const mayBeTruncated = e.owners.length >= MAX_REPORTED_OWNERS

      if (options.json) {
        if (spinner) spinner.stop()
        printJson({
          installed: false,
          code: 'AMBIGUOUS_NAME',
          name,
          owners: e.owners,
          candidates,
          owners_truncated: mayBeTruncated,
        })
        process.exit(1)
      }

      // Prompting needs a terminal. Piped into something, say what to type rather than hanging on
      // a question nobody is there to answer.
      if (!process.stdin.isTTY) {
        throw new Error(
          `Skill name "${name}" is claimed by multiple owners. Install one by its qualified name:\n` +
            candidates.map((c) => `  skillpm install ${c}`).join('\n') +
            (mayBeTruncated ? '\n  ...and possibly others — see `skillpm search`.' : '')
        )
      }

      if (spinner) spinner.stop()
      const { select } = await import('@inquirer/prompts')
      const chosen = await select({
        message: `"${name}" is claimed by ${
          mayBeTruncated ? 'several' : e.owners.length
        } owners. Which one?`,
        choices: candidates.map((c) => ({ name: c, value: c })),
      })

      if (spinner) spinner.start(`Looking up "${chosen}" in registry...`)
      info = await getSkillInstallInfo(chosen)
    }

    if (spinner) spinner.text = `Installing "${name}" from ${info.source_url}...`

    const { installFromGitUrl } = await import('../../registry/sources/github.js')
    const result = await installFromGitUrl(`git+${info.source_url}`, {
      scope: options.scope,
      force: options.force,
      bridge: options.bridge,
      sourceUrl: info.source_url,
      onMultipleSkills: async (names) => {
        if (spinner) spinner.stop()
        const { select } = await import('@inquirer/prompts')
        return select({
          message: 'Multiple skills found in repo. Which one would you like to install?',
          choices: names.map(n => ({ name: n, value: n })),
        })
      },
    })

    if (spinner) spinner.succeed(`Installed "${result.skillName}" at ${result.scope} scope`)

    if (options.json) {
      printJson({
        installed: true,
        skillName: result.skillName,
        scope: result.scope,
        score: result.validation.score,
        diagnostics: result.validation.diagnostics,
        bridged: result.bridged,
        trust_tier: info.trust_tier,
      })
    } else {
      if (result.validation.warnCount > 0 || result.validation.errorCount > 0) {
        console.log('')
        printValidationReport(result.validation)
      } else {
        printSuccess(`Score: ${result.validation.score}/100 · Trust: ${info.trust_tier}`)
      }
    }

    reportBridging(result.bridged)
  } catch (e) {
    if (spinner) spinner.fail()
    printError(e instanceof Error ? e.message : String(e))
    process.exit(1)
  }
}

async function runGitInstall(
  gitUrl: string,
  options: { scope: ScopeLevel; force: boolean; json: boolean; bridge?: boolean }
): Promise<void> {
  const spinner = options.json ? null : ora(`Cloning ${gitUrl}...`).start()
  try {
    const { installFromGitUrl } = await import('../../registry/sources/github.js')
    const result = await installFromGitUrl(gitUrl, {
      scope: options.scope,
      force: options.force,
      bridge: options.bridge,
      sourceUrl: gitUrl,
      onMultipleSkills: async (names) => {
        if (spinner) spinner.stop()
        const { select } = await import('@inquirer/prompts')
        return select({
          message: 'Multiple skills found in repo. Which one would you like to install?',
          choices: names.map(n => ({ name: n, value: n })),
        })
      },
    })

    if (spinner) spinner.succeed(`Installed "${result.skillName}" at ${result.scope} scope`)

    if (options.json) {
      printJson({
        installed: true,
        skillName: result.skillName,
        scope: result.scope,
        score: result.validation.score,
        diagnostics: result.validation.diagnostics,
        bridged: result.bridged,
      })
    } else {
      if (result.validation.warnCount > 0 || result.validation.errorCount > 0) {
        console.log('')
        printValidationReport(result.validation)
      } else {
        printSuccess(`Score: ${result.validation.score}/100`)
      }
    }

    reportBridging(result.bridged)
  } catch (e) {
    if (spinner) spinner.fail()
    printError(e instanceof Error ? e.message : String(e))
    process.exit(1)
  }
}
