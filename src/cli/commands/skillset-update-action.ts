import ora from 'ora'
import type { ScopeLevel } from '../../types/scope.js'
import type { InstalledSkillset } from '../../types/manifest.js'
import { resolveScope } from '../../core/resolver.js'
import { readManifest } from '../../core/manifest.js'
import { printJson, printError, printSuccess, printWarning, printInfo } from '../ui/output.js'

export async function runSkillsetUpdate(
  skillsetName: string | undefined,
  options: { scope: ScopeLevel; all: boolean; json: boolean }
): Promise<void> {
  if (!skillsetName && !options.all) {
    printError('Specify a skillset name or pass --all to update all skillsets in scope.')
    process.exit(1)
  }

  const scopeConfig = await resolveScope(options.scope)
  const manifest = await readManifest(scopeConfig)
  const skillsets = Object.values(manifest.skillsets)

  const toUpdate: InstalledSkillset[] = options.all
    ? skillsets
    : skillsets.filter(s => s.name === skillsetName)

  if (toUpdate.length === 0) {
    const msg = options.all
      ? `No skillsets installed at ${options.scope} scope.`
      : `Skillset "${skillsetName}" is not installed at ${options.scope} scope.`
    printError(msg)
    process.exit(1)
  }

  const results: Array<{ name: string; status: 'updated' | 'skipped' | 'error'; detail: string }> = []

  for (const skillset of toUpdate) {
    if (!skillset.sourceUrl) {
      printWarning(`"${skillset.name}" has no source URL (local skillset) — skipping.`)
      results.push({ name: skillset.name, status: 'skipped', detail: 'no source URL' })
      continue
    }

    const spinner = options.json ? null : ora(`Updating "${skillset.name}" from ${skillset.sourceUrl}...`).start()

    const { mkdtemp, rm } = await import('node:fs/promises')
    const path = await import('node:path')
    const os = await import('node:os')
    const { simpleGit } = await import('simple-git')
    const { parseGitUrl } = await import('../../registry/sources/github.js')
    const { installSkillsetFromPath } = await import('../../core/skillset-installer.js')

    const tmpDir = await mkdtemp(path.join(os.tmpdir(), 'skilldex-skillset-update-'))

    try {
      const parsed = parseGitUrl(`git+${skillset.sourceUrl}`)
      const git = simpleGit()
      const cloneOpts = parsed.branch ? ['--branch', parsed.branch, '--depth', '1'] : ['--depth', '1']
      await git.clone(parsed.repoUrl, tmpDir, cloneOpts)
      const searchRoot = parsed.subPath ? path.join(tmpDir, parsed.subPath) : tmpDir

      const result = await installSkillsetFromPath(searchRoot, {
        scope: options.scope,
        force: true,
        sourceUrl: skillset.sourceUrl,
      })

      const allSkills = [
        ...result.embeddedResults.map(r => r.skillName),
        ...result.remoteResults.map(r => r.skillName),
      ]
      const detail = `score: ${result.validation.score}/100${allSkills.length ? `, skills: ${allSkills.join(', ')}` : ''}`

      if (spinner) spinner.succeed(`Updated "${skillset.name}" (${detail})`)
      results.push({ name: skillset.name, status: 'updated', detail })
    } catch (e) {
      if (spinner) spinner.fail()
      const msg = e instanceof Error ? e.message : String(e)
      printError(`Failed to update "${skillset.name}": ${msg}`)
      results.push({ name: skillset.name, status: 'error', detail: msg })
    } finally {
      await rm(tmpDir, { recursive: true, force: true })
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
  if (updated > 0) printSuccess(`${updated} skillset(s) updated`)
  if (skipped > 0) printInfo(`${skipped} skillset(s) skipped`)
  if (failed > 0) printWarning(`${failed} skillset(s) failed`)
}
