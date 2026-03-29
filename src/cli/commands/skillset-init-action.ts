import { mkdir, writeFile, stat } from 'node:fs/promises'
import path from 'node:path'
import { printError, printSuccess, printInfo } from '../ui/output.js'

const TEMPLATE = (name: string) => `---
name: ${name}
description: "Describe what this skillset does and which agent use-case it targets. Aim for 30+ words to pass validation."
version: "1.0.0"
tags: []
author: ""
spec_version: "1.0"
# List remote skills that are not embedded in this directory:
# skills:
#   - name: some-remote-skill
#     source_url: https://github.com/user/some-remote-skill
---

# ${name}

Add a description of this skillset and the agent it is designed for.

## Skills included

List what each embedded skill does and how they work together.
`

export async function runSkillsetInit(name?: string): Promise<void> {
  const skillsetName = name ?? path.basename(process.cwd())

  const targetDir = name ? path.join(process.cwd(), skillsetName) : process.cwd()

  try {
    if (name) {
      try {
        await stat(targetDir)
        printError(`Directory "${skillsetName}" already exists`)
        process.exit(1)
      } catch {
        await mkdir(targetDir, { recursive: true })
      }
    }

    const skillsetMdPath = path.join(targetDir, 'SKILLSET.md')
    try {
      await stat(skillsetMdPath)
      printError('SKILLSET.md already exists in this directory')
      process.exit(1)
    } catch {
      // good — doesn't exist yet
    }

    await writeFile(skillsetMdPath, TEMPLATE(skillsetName), 'utf8')
    await mkdir(path.join(targetDir, 'assets'), { recursive: true })

    printSuccess(`Skillset "${skillsetName}" initialized`)
    printInfo(`  ${path.relative(process.cwd(), skillsetMdPath)}`)
    printInfo(`  ${path.relative(process.cwd(), path.join(targetDir, 'assets'))}/`)
    printInfo('')
    printInfo('Next steps:')
    printInfo('  1. Edit SKILLSET.md with your description and remote skill references')
    printInfo('  2. Add embedded skills as subdirectories (each with their own SKILL.md)')
    printInfo('  3. Run "skillpm skillset validate" to check your skillset')
    printInfo('  4. Run "skillpm skillset publish" to publish to the registry')
  } catch (e) {
    printError(e instanceof Error ? e.message : String(e))
    process.exit(1)
  }
}
