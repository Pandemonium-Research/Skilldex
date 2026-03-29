import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import ora from 'ora'
import { parse as parseYaml } from 'yaml'
import { simpleGit } from 'simple-git'
import { publishSkillset, updateSkillset } from '../../registry/sources/registry.js'
import { printJson, printError, printSuccess, printWarning, printInfo } from '../ui/output.js'

async function detectSourceUrl(skillsetPath: string): Promise<string | null> {
  try {
    const git = simpleGit(skillsetPath)
    const remotes = await git.getRemotes(true)
    const origin = remotes.find((r) => r.name === 'origin')
    if (!origin?.refs?.fetch) return null

    let url = origin.refs.fetch
    url = url.replace(/^git@github\.com:/, 'https://github.com/')
    url = url.replace(/\.git$/, '')
    return url
  } catch {
    return null
  }
}

async function readSkillsetName(skillsetPath: string): Promise<string | null> {
  try {
    const content = await readFile(join(skillsetPath, 'SKILLSET.md'), 'utf-8')
    const match = content.match(/^---\n([\s\S]*?)\n---/)
    if (!match) return null
    const fm = parseYaml(match[1]) as Record<string, unknown>
    return typeof fm['name'] === 'string' ? fm['name'] : null
  } catch {
    return null
  }
}

export async function runSkillsetPublish(options: {
  sourceUrl?: string
  tags?: string
  update?: boolean
  json: boolean
}): Promise<void> {
  const token = process.env.SKILLDEX_TOKEN
  if (!token) {
    printError(
      'SKILLDEX_TOKEN is not set. Get your token from https://registry.skilldex.dev/auth/github and set it as an environment variable.'
    )
    process.exit(1)
  }

  const skillsetPath = process.cwd()
  const spinner = options.json ? null : ora('Reading skillset...').start()

  try {
    const skillsetName = await readSkillsetName(skillsetPath)
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
        printSuccess(`Score: ${result.skillset.score ?? 'n/a'}/100`)
        for (const d of result.diagnostics) {
          const loc = d.line !== undefined ? `line ${d.line}: ` : ''
          if (d.level === 'error') printError(`${loc}${d.message}`)
          else printWarning(`${loc}${d.message}`)
        }
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
      printSuccess(`Score: ${result.skillset.score ?? 'n/a'}/100`)
      for (const d of result.diagnostics) {
        const loc = d.line !== undefined ? `line ${d.line}: ` : ''
        if (d.level === 'error') printError(`${loc}${d.message}`)
        else printWarning(`${loc}${d.message}`)
      }
      printInfo(`Install with: skillpm skillset install ${skillsetName}`)
    }
  } catch (e) {
    if (spinner) spinner.fail()
    printError(e instanceof Error ? e.message : String(e))
    process.exit(1)
  }
}
