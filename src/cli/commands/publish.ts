import type { Command } from 'commander'
import { readFile } from 'fs/promises'
import { join } from 'path'
import ora from 'ora'
import { parse as parseYaml } from 'yaml'
import { simpleGit } from 'simple-git'
import { publishSkill, updateSkill } from '../../registry/sources/registry.js'
import { printJson, printError, printSuccess, printWarning, printInfo } from '../ui/output.js'

async function detectSourceUrl(skillPath: string): Promise<string | null> {
  try {
    const git = simpleGit(skillPath)
    const remotes = await git.getRemotes(true)
    const origin = remotes.find(r => r.name === 'origin')
    if (!origin?.refs?.fetch) return null

    // Normalise SSH → HTTPS and strip .git suffix
    let url = origin.refs.fetch
    url = url.replace(/^git@github\.com:/, 'https://github.com/')
    url = url.replace(/\.git$/, '')
    return url
  } catch {
    return null
  }
}

async function readSkillName(skillPath: string): Promise<string | null> {
  try {
    const content = await readFile(join(skillPath, 'SKILL.md'), 'utf-8')
    const match = content.match(/^---\n([\s\S]*?)\n---/)
    if (!match) return null
    const fm = parseYaml(match[1]) as Record<string, unknown>
    return typeof fm['name'] === 'string' ? fm['name'] : null
  } catch {
    return null
  }
}

export function registerPublish(program: Command): void {
  program
    .command('publish')
    .description('Publish a skill to the Skilldex registry')
    .option('--source-url <url>', 'GitHub URL of the skill (auto-detected from git remote if omitted)')
    .option('--tags <tags>', 'Comma-separated tags (e.g. forensics,analysis)')
    .option('--update', 'Re-fetch and re-score an already-published skill')
    .option('--json', 'Output as JSON')
    .action(async (options: { sourceUrl?: string; tags?: string; update?: boolean; json: boolean }) => {
      const token = process.env.SKILLDEX_TOKEN
      if (!token) {
        printError(
          'SKILLDEX_TOKEN is not set. Get your token from https://registry.skilldex.dev/auth/github and set it as an environment variable.'
        )
        process.exit(1)
      }

      const skillPath = process.cwd()
      const spinner = options.json ? null : ora('Reading skill...').start()

      try {
        const skillName = await readSkillName(skillPath)
        if (!skillName) {
          if (spinner) spinner.fail()
          printError('Could not read skill name from SKILL.md frontmatter. Make sure you are in a skill folder.')
          process.exit(1)
          return
        }

        if (options.update) {
          if (spinner) spinner.text = `Re-fetching and re-scoring "${skillName}"...`
          const result = await updateSkill(token, skillName)
          if (spinner) spinner.succeed(`Updated "${skillName}"`)

          if (options.json) {
            printJson(result)
          } else {
            printSuccess(`Score: ${result.skill.score ?? 'n/a'}/100`)
            for (const d of result.diagnostics) {
              const loc = d.line !== undefined ? `line ${d.line}: ` : ''
              if (d.level === 'error') printError(`${loc}${d.message}`)
              else printWarning(`${loc}${d.message}`)
            }
          }
          return
        }

        // Detect source URL — explicit flag wins, then git remote
        const detectedUrl = options.sourceUrl ?? (await detectSourceUrl(skillPath))
        if (!detectedUrl) {
          if (spinner) spinner.fail()
          printError(
            'Could not detect GitHub URL from git remote. Pass --source-url <url> explicitly.'
          )
          process.exit(1)
          return
        }

        const tags = options.tags ? options.tags.split(',').map(t => t.trim()).filter(Boolean) : []

        if (spinner) spinner.text = `Publishing "${skillName}" to registry...`

        const result = await publishSkill(token, { name: skillName, source_url: detectedUrl, tags })

        if (spinner) spinner.succeed(`Published "${skillName}"`)

        if (options.json) {
          printJson(result)
        } else {
          printInfo(`Source: ${detectedUrl}`)
          printSuccess(`Score: ${result.skill.score ?? 'n/a'}/100`)
          for (const d of result.diagnostics) {
            const loc = d.line !== undefined ? `line ${d.line}: ` : ''
            if (d.level === 'error') printError(`${loc}${d.message}`)
            else printWarning(`${loc}${d.message}`)
          }
          printInfo(`Install with: skillpm install ${skillName}`)
        }
      } catch (e) {
        if (spinner) spinner.fail()
        printError(e instanceof Error ? e.message : String(e))
        process.exit(1)
      }
    })
}
