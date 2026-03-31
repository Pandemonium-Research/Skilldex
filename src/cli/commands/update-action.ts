import ora from 'ora'
import chalk from 'chalk'
import type { ScopeLevel } from '../../types/scope.js'
import type { InstalledSkill } from '../../types/manifest.js'
import { resolveScope, resolveAllScopes } from '../../core/resolver.js'
import { readManifest } from '../../core/manifest.js'
import { printJson, printError, printSuccess, printWarning, printInfo } from '../ui/output.js'

export async function runUpdate(
  skillName: string | undefined,
  options: { scope: ScopeLevel; all: boolean; json: boolean }
): Promise<void> {
  if (!skillName && !options.all) {
    printError('Specify a skill name or pass --all to update all skills in scope.')
    process.exit(1)
  }

  const scopeConfig = await resolveScope(options.scope)
  const manifest = await readManifest(scopeConfig)
  const skills = Object.values(manifest.skills)

  const toUpdate: InstalledSkill[] = options.all
    ? skills
    : skills.filter(s => s.name === skillName)

  if (toUpdate.length === 0) {
    const msg = options.all
      ? `No skills installed at ${options.scope} scope.`
      : `Skill "${skillName}" is not installed at ${options.scope} scope.`
    printError(msg)
    process.exit(1)
  }

  const results: Array<{ name: string; status: 'updated' | 'skipped' | 'error'; detail: string }> = []

  for (const skill of toUpdate) {
    if (!skill.sourceUrl) {
      printWarning(`"${skill.name}" has no source URL (local skill) — skipping.`)
      results.push({ name: skill.name, status: 'skipped', detail: 'no source URL' })
      continue
    }

    const spinner = options.json ? null : ora(`Updating "${skill.name}" from ${skill.sourceUrl}...`).start()

    try {
      const { installFromGitUrl } = await import('../../registry/sources/github.js')
      const result = await installFromGitUrl(`git+${skill.sourceUrl}`, scopeConfig, {
        scope: options.scope,
        force: true,
        sourceUrl: skill.sourceUrl,
      })

      if (spinner) spinner.succeed(`Updated "${skill.name}" (score: ${result.validation.score}/100)`)
      results.push({ name: skill.name, status: 'updated', detail: `score: ${result.validation.score}/100` })
    } catch (e) {
      if (spinner) spinner.fail()
      const msg = e instanceof Error ? e.message : String(e)
      printError(`Failed to update "${skill.name}": ${msg}`)
      results.push({ name: skill.name, status: 'error', detail: msg })
    }
  }

  if (options.json) {
    printJson(results)
    return
  }

  const updated = results.filter(r => r.status === 'updated').length
  const failed = results.filter(r => r.status === 'error').length
  const skipped = results.filter(r => r.status === 'skipped').length

  console.log('')
  if (updated > 0) printSuccess(`${updated} skill(s) updated`)
  if (skipped > 0) printInfo(`${skipped} skill(s) skipped`)
  if (failed > 0) printWarning(`${failed} skill(s) failed`)
}
