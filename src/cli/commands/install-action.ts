import ora from 'ora'
import type { ScopeLevel } from '../../types/scope.js'
import { installFromPath } from '../../core/installer.js'
import { printValidationReport, printJson, printError, printSuccess } from '../ui/output.js'

function isRegistryName(source: string): boolean {
  // A plain skill name: no path separators, no git+, no protocol, no dots suggesting a path
  return !source.startsWith('git+') && !source.startsWith('/') && !source.startsWith('./') &&
    !source.startsWith('../') && !source.includes('://') && !source.endsWith('.md')
}

export async function runInstall(
  source: string,
  options: { scope: ScopeLevel; force: boolean; json: boolean }
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
    })

    if (spinner) spinner.succeed(`Installed "${result.skillName}" at ${result.scope} scope`)

    if (options.json) {
      printJson({
        installed: true,
        skillName: result.skillName,
        scope: result.scope,
        score: result.validation.score,
        diagnostics: result.validation.diagnostics,
      })
    } else {
      if (result.validation.warnCount > 0 || result.validation.errorCount > 0) {
        console.log('')
        printValidationReport(result.validation)
      } else {
        printSuccess(`Score: ${result.validation.score}/100`)
      }
    }
  } catch (e) {
    if (spinner) spinner.fail()
    printError(e instanceof Error ? e.message : String(e))
    process.exit(1)
  }
}

async function runRegistryInstall(
  name: string,
  options: { scope: ScopeLevel; force: boolean; json: boolean }
): Promise<void> {
  const spinner = options.json ? null : ora(`Looking up "${name}" in registry...`).start()
  try {
    const { getSkillInstallInfo } = await import('../../registry/sources/registry.js')
    const info = await getSkillInstallInfo(name)

    if (spinner) spinner.text = `Installing "${name}" from ${info.source_url}...`

    const { installFromGitUrl } = await import('../../registry/sources/github.js')
    const { resolveScope } = await import('../../core/resolver.js')
    const scopeConfig = await resolveScope(options.scope)
    const result = await installFromGitUrl(`git+${info.source_url}`, scopeConfig, {
      scope: options.scope,
      force: options.force,
      sourceUrl: info.source_url,
    })

    if (spinner) spinner.succeed(`Installed "${result.skillName}" at ${result.scope} scope`)

    if (options.json) {
      printJson({
        installed: true,
        skillName: result.skillName,
        scope: result.scope,
        score: result.validation.score,
        diagnostics: result.validation.diagnostics,
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
  } catch (e) {
    if (spinner) spinner.fail()
    printError(e instanceof Error ? e.message : String(e))
    process.exit(1)
  }
}

async function runGitInstall(
  gitUrl: string,
  options: { scope: ScopeLevel; force: boolean; json: boolean }
): Promise<void> {
  const spinner = options.json ? null : ora(`Cloning ${gitUrl}...`).start()
  try {
    const { installFromGitUrl } = await import('../../registry/sources/github.js')
    const { resolveScope } = await import('../../core/resolver.js')
    const scopeConfig = await resolveScope(options.scope)
    const result = await installFromGitUrl(gitUrl, scopeConfig, {
      scope: options.scope,
      force: options.force,
      sourceUrl: gitUrl,
    })

    if (spinner) spinner.succeed(`Installed "${result.skillName}" at ${result.scope} scope`)

    if (options.json) {
      printJson({
        installed: true,
        skillName: result.skillName,
        scope: result.scope,
        score: result.validation.score,
        diagnostics: result.validation.diagnostics,
      })
    } else {
      if (result.validation.warnCount > 0 || result.validation.errorCount > 0) {
        console.log('')
        printValidationReport(result.validation)
      } else {
        printSuccess(`Score: ${result.validation.score}/100`)
      }
    }
  } catch (e) {
    if (spinner) spinner.fail()
    printError(e instanceof Error ? e.message : String(e))
    process.exit(1)
  }
}
