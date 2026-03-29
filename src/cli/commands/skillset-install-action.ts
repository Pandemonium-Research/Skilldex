import ora from 'ora'
import type { ScopeLevel } from '../../types/scope.js'
import { installSkillsetFromPath } from '../../core/skillset-installer.js'
import { printJson, printError, printSuccess, printInfo } from '../ui/output.js'

function isRegistryName(source: string): boolean {
  return (
    !source.startsWith('git+') &&
    !source.startsWith('/') &&
    !source.startsWith('./') &&
    !source.startsWith('../') &&
    !source.includes('://') &&
    !source.endsWith('.md')
  )
}

export async function runSkillsetInstall(
  source: string,
  options: { scope: ScopeLevel; force: boolean; json: boolean }
): Promise<void> {
  const isGitUrl = source.startsWith('git+')

  if (!isGitUrl && isRegistryName(source)) {
    await runRegistrySkillsetInstall(source, options)
    return
  }

  if (isGitUrl) {
    await runGitSkillsetInstall(source, options)
    return
  }

  const spinner = options.json ? null : ora(`Validating ${source}...`).start()

  try {
    if (spinner) spinner.text = `Installing skillset from ${source}...`

    const result = await installSkillsetFromPath(source, {
      scope: options.scope,
      force: options.force,
    })

    if (spinner) spinner.succeed(`Installed skillset "${result.skillsetName}" at ${result.scope} scope`)

    if (options.json) {
      printJson({
        installed: true,
        skillsetName: result.skillsetName,
        scope: result.scope,
        score: result.validation.score,
        embeddedSkills: result.embeddedResults.map((r) => r.skillName),
        remoteSkills: result.remoteResults.map((r) => r.skillName),
        diagnostics: result.validation.diagnostics,
      })
    } else {
      printSuccess(`Score: ${result.validation.score}/100`)
      const allSkills = [
        ...result.embeddedResults.map((r) => r.skillName),
        ...result.remoteResults.map((r) => r.skillName),
      ]
      if (allSkills.length > 0) {
        printInfo(`  Skills installed: ${allSkills.join(', ')}`)
      }
    }
  } catch (e) {
    if (spinner) spinner.fail()
    printError(e instanceof Error ? e.message : String(e))
    process.exit(1)
  }
}

async function runRegistrySkillsetInstall(
  name: string,
  options: { scope: ScopeLevel; force: boolean; json: boolean }
): Promise<void> {
  const spinner = options.json ? null : ora(`Looking up skillset "${name}" in registry...`).start()
  try {
    const { getSkillsetInstallInfo } = await import('../../registry/sources/registry.js')
    const info = await getSkillsetInstallInfo(name)

    if (spinner) spinner.text = `Installing skillset "${name}" from ${info.source_url}...`

    const { installFromGitUrl } = await import('../../registry/sources/github.js')
    const { resolveScope } = await import('../../core/resolver.js')
    const scopeConfig = await resolveScope(options.scope)

    // Clone the skillset repo then install as a skillset from the local clone
    const tmpResult = await installFromGitUrl(`git+${info.source_url}`, scopeConfig, {
      scope: options.scope,
      force: options.force,
      sourceUrl: info.source_url,
    })

    if (spinner) spinner.succeed(`Installed skillset "${name}" at ${options.scope} scope`)

    if (options.json) {
      printJson({
        installed: true,
        skillsetName: name,
        scope: options.scope,
        score: tmpResult.validation.score,
        trust_tier: info.trust_tier,
      })
    } else {
      printSuccess(`Score: ${tmpResult.validation.score}/100 · Trust: ${info.trust_tier}`)
    }
  } catch (e) {
    if (spinner) spinner.fail()
    printError(e instanceof Error ? e.message : String(e))
    process.exit(1)
  }
}

async function runGitSkillsetInstall(
  gitUrl: string,
  options: { scope: ScopeLevel; force: boolean; json: boolean }
): Promise<void> {
  const { mkdtemp, rm } = await import('node:fs/promises')
  const path = await import('node:path')
  const os = await import('node:os')
  const { simpleGit } = await import('simple-git')
  const { parseGitUrl } = await import('../../registry/sources/github.js')

  const spinner = options.json ? null : ora(`Cloning ${gitUrl}...`).start()
  const tmpDir = await mkdtemp(path.join(os.tmpdir(), 'skilldex-skillset-'))

  try {
    const parsed = parseGitUrl(gitUrl)
    const git = simpleGit()
    const cloneOptions = parsed.branch ? ['--branch', parsed.branch, '--depth', '1'] : ['--depth', '1']
    await git.clone(parsed.repoUrl, tmpDir, cloneOptions)

    const searchRoot = parsed.subPath ? path.join(tmpDir, parsed.subPath) : tmpDir

    if (spinner) spinner.text = `Installing skillset from ${gitUrl}...`

    const result = await installSkillsetFromPath(searchRoot, {
      scope: options.scope,
      force: options.force,
      sourceUrl: gitUrl,
    })

    if (spinner) spinner.succeed(`Installed skillset "${result.skillsetName}" at ${result.scope} scope`)

    if (options.json) {
      printJson({
        installed: true,
        skillsetName: result.skillsetName,
        scope: result.scope,
        score: result.validation.score,
        embeddedSkills: result.embeddedResults.map((r) => r.skillName),
        remoteSkills: result.remoteResults.map((r) => r.skillName),
      })
    } else {
      printSuccess(`Score: ${result.validation.score}/100`)
      const allSkills = [
        ...result.embeddedResults.map((r) => r.skillName),
        ...result.remoteResults.map((r) => r.skillName),
      ]
      if (allSkills.length > 0) {
        printInfo(`  Skills installed: ${allSkills.join(', ')}`)
      }
    }
  } catch (e) {
    if (spinner) spinner.fail()
    printError(e instanceof Error ? e.message : String(e))
    process.exit(1)
  } finally {
    await rm(tmpDir, { recursive: true, force: true })
  }
}
