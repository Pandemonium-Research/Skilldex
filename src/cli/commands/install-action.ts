import ora from 'ora'
import type { ScopeLevel } from '../../types/scope.js'
import { installFromPath, type InstallResult } from '../../core/installer.js'
import { printValidationReport, printJson, printError, printSuccess, printWarning, printInfo } from '../ui/output.js'

function isRegistryName(source: string): boolean {
  // A plain skill name: no path separators, no git+, no protocol, no dots suggesting a path
  return !source.startsWith('git+') && !source.startsWith('/') && !source.startsWith('./') &&
    !source.startsWith('../') && !source.includes('://') && !source.endsWith('.md')
}

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
  const isGitUrl = source.startsWith('git+')

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
    const { getSkillInstallInfo } = await import('../../registry/sources/registry.js')
    const info = await getSkillInstallInfo(name)

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
