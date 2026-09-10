import { mkdir, writeFile, stat } from 'node:fs/promises'
import path from 'node:path'
import { printError, printSuccess, printInfo } from '../ui/output.js'
import { SPEC_VERSION, skillNameErrors } from '../../core/validator.js'

/**
 * Scaffold a single skill, the counterpart to `skillpm skillset init`.
 *
 * Skillsets could be scaffolded and skills could not, so anyone writing a skill by hand started
 * from a blank file and rediscovered the validator's rules by failing them. Several are easy to
 * get wrong from memory and one is a genuine trap: the description must be quoted. An unquoted
 * value containing a colon parses as a nested mapping, which makes the whole frontmatter
 * unreadable and scores the file zero — not a hypothetical, it is the exact failure a model hit
 * generating a draft here.
 *
 * The scaffold therefore validates clean as written. A template that fails its own validator
 * teaches the wrong lesson on the first run.
 */

// Interpolated rather than written out, so the scaffold cannot fall behind the spec the validator
// implements — which is how the skillset template came to declare 1.0 while everything else had
// moved to 1.1.
const TEMPLATE = (name: string) => `---
name: ${name}
description: "PLACEHOLDER — replace this. Describe what this skill does and, just as importantly, when the agent should reach for it, since that is what determines whether it ever gets used. Keep it to at least thirty words and avoid colons unless the whole value stays quoted."
version: "1.0.0"
tags: []
spec_version: "${SPEC_VERSION}"
---

# ${name}

Replace this with the instructions the agent should follow. Write for an agent that will act on
this directly — concrete steps, rules and worked examples, not a description of the skill in the
third person.

## When to use this

Say what situation should trigger the skill.

## Steps

1. First step.
2. Second step.

## Notes

Anything the agent needs to know that is not a step — constraints, common mistakes, edge cases.
`

/**
 * Existence as a value, rather than as control flow.
 *
 * The obvious shape — `try { await stat(p); bail() } catch { proceed }` — puts the bail inside a
 * try whose catch means "not there". `process.exit` throws before it terminates, so under any
 * harness that stubs exit the bail is swallowed and the code proceeds to overwrite the very file
 * it was checking for. It only looks safe because exit normally ends the process first.
 */
async function exists(target: string): Promise<boolean> {
  try {
    await stat(target)
    return true
  } catch {
    return false
  }
}

export async function runInit(name?: string): Promise<void> {
  const skillName = name ?? path.basename(process.cwd())

  try {
    // Checked against the validator's own rule, before anything is created. Scaffolding a
    // directory around a name that can never validate leaves the user with a broken skill and an
    // error that arrives one command later.
    const nameErrors = skillNameErrors(skillName)
    if (nameErrors.length > 0) {
      for (const message of nameErrors) printError(message)
      // Without this, running `skillpm init` inside `~/MyProject` reports that "MyProject" is not
      // kebab-case and never says where that name came from or how to override it.
      if (!name) {
        printInfo(
          `  That name came from the current directory. Pass one explicitly: skillpm init <name>`
        )
      }
      process.exit(1)
    }

    const targetDir = name ? path.join(process.cwd(), skillName) : process.cwd()

    if (name) {
      if (await exists(targetDir)) {
        printError(`Directory "${skillName}" already exists`)
        process.exit(1)
      }
      await mkdir(targetDir, { recursive: true })
    }

    const skillMdPath = path.join(targetDir, 'SKILL.md')
    if (await exists(skillMdPath)) {
      printError('SKILL.md already exists in this directory')
      process.exit(1)
    }

    await writeFile(skillMdPath, TEMPLATE(skillName), 'utf8')

    printSuccess(`Skill "${skillName}" initialized`)
    printInfo(`  ${path.relative(process.cwd(), skillMdPath).split(path.sep).join('/')}`)
    printInfo('  Replace the description and body, then: skillpm validate')
  } catch (e) {
    printError(e instanceof Error ? e.message : String(e))
    process.exit(1)
  }
}
