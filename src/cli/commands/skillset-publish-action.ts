import { join } from 'node:path'
import ora from 'ora'
import { detectSourceUrl, readFrontmatterName } from '../../core/publish-source.js'
import { publishSkillset, updateSkillset } from '../../registry/sources/registry.js'
import { printJson, printError, printSuccess, printWarning, printInfo } from '../ui/output.js'
import { formatCoherence, coherenceHint } from '../ui/coherence.js'
import type { PublishSkillsetResponse } from '../../registry/sources/registry.js'

/**
 * Report what the registry made of the skillset.
 *
 * The score and coherence both come from the registry rather than from a local run: it fetches
 * the published source itself and computes both, so echoing a local result here could show a
 * number that differs from the one the listing will carry.
 */
function printRegistryResult(result: PublishSkillsetResponse): void {
  const line = [`Score: ${result.skillset.score ?? 'n/a'}/100`, formatCoherence(result.coherence)]
    .filter(Boolean)
    .join(' · ')
  printSuccess(line)

  const hint = coherenceHint(result.coherence)
  if (hint) printInfo(`  ${hint}`)

  for (const d of result.diagnostics) {
    const loc = d.line !== undefined ? `line ${d.line}: ` : ''
    if (d.level === 'error') printError(`${loc}${d.message}`)
    else printWarning(`${loc}${d.message}`)
  }
}

export async function runSkillsetPublish(options: {
  sourceUrl?: string
  tags?: string
  update?: boolean
  json: boolean
}): Promise<void> {
  const { getConfigValue } = await import('../../core/config.js')
  const token = await getConfigValue('token')
  if (!token) {
    const { getAuthUrl } = await import('../../registry/sources/registry.js')
    printError(
      `No auth token found. Get your token from ${await getAuthUrl()}, then run: skillpm config set token <token>`
    )
    process.exit(1)
  }

  const skillsetPath = process.cwd()
  const spinner = options.json ? null : ora('Reading skillset...').start()

  try {
    const skillsetName = await readFrontmatterName(join(skillsetPath, 'SKILLSET.md'))
    if (!skillsetName) {
      if (spinner) spinner.fail()
      printError(
        'Could not read skillset name from SKILLSET.md frontmatter. Make sure you are in a skillset folder.'
      )
      process.exit(1)
      return
    }

    if (options.update) {
      if (spinner) spinner.text = `Re-fetching and re-scoring "${skillsetName}"...`
      const result = await updateSkillset(token, skillsetName)
      if (spinner) spinner.succeed(`Updated "${skillsetName}"`)

      if (options.json) {
        printJson(result)
      } else {
        printRegistryResult(result)
      }
      return
    }

    const detectedUrl = options.sourceUrl ?? (await detectSourceUrl(skillsetPath))
    if (!detectedUrl) {
      if (spinner) spinner.fail()
      printError('Could not detect GitHub URL from git remote. Pass --source-url <url> explicitly.')
      process.exit(1)
      return
    }

    const tags = options.tags ? options.tags.split(',').map((t) => t.trim()).filter(Boolean) : []

    if (spinner) spinner.text = `Publishing skillset "${skillsetName}" to registry...`

    const result = await publishSkillset(token, { name: skillsetName, source_url: detectedUrl, tags })

    if (spinner) spinner.succeed(`Published "${skillsetName}"`)

    if (options.json) {
      printJson(result)
    } else {
      printInfo(`Source: ${detectedUrl}`)
      printRegistryResult(result)
      printInfo(`Install with: skillpm skillset install ${skillsetName}`)
    }
  } catch (e) {
    if (spinner) spinner.fail()
    printError(e instanceof Error ? e.message : String(e))
    process.exit(1)
  }
}
