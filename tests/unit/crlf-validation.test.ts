/**
 * Validation must not depend on line endings.
 *
 * This is the third CRLF bug in this codebase and the worst of them. Both validators split
 * content on '\n' and handed the resulting lines — carriage returns still attached — to the YAML
 * parser. A trailing \r after an *unquoted* scalar is harmless trailing whitespace, so most files
 * survived. After a *quoted* one it is a hard parse error, "Unexpected scalar at node end".
 *
 * Every official SKILLSET.md ends its frontmatter with a quoted spec_version, so on a checkout
 * with core.autocrlf on — the default for Windows installs of Git — `skillpm skillset validate`
 * returned 0/100 for all of them. It stayed invisible because git only rewrites files it touches:
 * fixtures already on disk kept their LF bytes and passed, and the bug surfaced only when a fresh
 * checkout brought two new fixtures down as CRLF.
 *
 * These tests write the same document both ways and require identical results, so no future
 * change can reintroduce a dependency on how a file happens to have been checked out.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { mkdtemp, rm, mkdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { validateSkill } from '../../src/core/validator.js'
import { validateSkillset } from '../../src/core/skillset-validator.js'

const lines = (...l: string[]) => l.join('\n')

/** Frontmatter that ends on a quoted scalar — the shape that actually broke. */
const SKILL_MD = lines(
  '---',
  'name: crlf-skill',
  'description: A skill whose frontmatter closes on a quoted value, which is the exact shape that failed to parse when carriage returns were passed straight through to the YAML parser without ever being stripped out first.',
  'version: "1.0.0"',
  '---',
  '',
  '## Instructions',
  '',
  'Body text.',
  ''
)

const SKILLSET_MD = lines(
  '---',
  'name: crlf-skillset',
  'description: "A skillset whose frontmatter closes on a quoted value, matching every official skillset in this project, so that any regression of this kind would be caught here long before it could reach an actual release."',
  'version: "1.0.0"',
  'tags: [test]',
  'author: "testuser"',
  'spec_version: "1.1"',
  '---',
  '',
  '# crlf-skillset',
  ''
)

const MEMBER_MD = lines(
  '---',
  'name: member',
  'description: An embedded member skill that references the shared asset so that the coherence checks have something real to report, written at a length that clears the thirty word minimum with room to spare.',
  '---',
  '',
  'Follow `../assets/conventions.md`.',
  ''
)

const CONVENTIONS = lines(
  '# Conventions',
  '',
  '```yaml skilldex-conventions',
  'commit-types:',
  '  feat: Added',
  '  fix: Fixed',
  '```',
  ''
)

const crlf = (s: string) => s.replace(/\n/g, '\r\n')

let root: string

/** Write one skillset (and a skill) in the requested line ending, return both paths. */
async function build(dir: string, eol: (s: string) => string) {
  const skillset = path.join(root, dir)
  await mkdir(path.join(skillset, 'assets'), { recursive: true })
  await mkdir(path.join(skillset, 'member'), { recursive: true })
  await writeFile(path.join(skillset, 'SKILLSET.md'), eol(SKILLSET_MD))
  await writeFile(path.join(skillset, 'assets', 'conventions.md'), eol(CONVENTIONS))
  await writeFile(path.join(skillset, 'member', 'SKILL.md'), eol(MEMBER_MD))

  const skill = path.join(root, `${dir}-skill`)
  await mkdir(skill, { recursive: true })
  await writeFile(path.join(skill, 'SKILL.md'), eol(SKILL_MD))

  return { skillset, skill }
}

let lfPaths: { skillset: string; skill: string }
let crlfPaths: { skillset: string; skill: string }

beforeAll(async () => {
  root = await mkdtemp(path.join(tmpdir(), 'skilldex-crlf-'))
  lfPaths = await build('lf', (s) => s)
  crlfPaths = await build('crlf', crlf)
})

afterAll(async () => {
  await rm(root, { recursive: true, force: true })
})

describe('line endings do not change validation', () => {
  it('scores a CRLF skillset the same as an LF one', async () => {
    const lf = await validateSkillset(lfPaths.skillset)
    const cr = await validateSkillset(crlfPaths.skillset)

    expect(lf.score).toBe(100) // guard the guard: a broken fixture would make equality vacuous
    expect(cr.score).toBe(lf.score)
    expect(cr.errorCount).toBe(0)
  })

  it('scores a CRLF skill the same as an LF one', async () => {
    const lf = await validateSkill(lfPaths.skill)
    const cr = await validateSkill(crlfPaths.skill)

    expect(lf.score).toBe(100)
    expect(cr.score).toBe(lf.score)
  })

  it('reads declared conventions out of a CRLF shared asset', async () => {
    // The separate fence-detection bug: the info-string regex ends in (.*)$, and `.` does not
    // match \r, so a CRLF asset declared nothing and its conventions were reported as undeclared.
    const cr = await validateSkillset(crlfPaths.skillset)
    const lf = await validateSkillset(lfPaths.skillset)

    expect(lf.coherence.declaredConventions).toHaveLength(1)
    expect(cr.coherence.declaredConventions).toHaveLength(1)
    expect(cr.coherence.membersCoherent).toBe(lf.coherence.membersCoherent)
  })

  it('produces identical diagnostics, not merely an identical total', async () => {
    const lf = await validateSkillset(lfPaths.skillset)
    const cr = await validateSkillset(crlfPaths.skillset)

    expect(cr.diagnostics.map((d) => `${d.severity}:${d.check}`)).toEqual(
      lf.diagnostics.map((d) => `${d.severity}:${d.check}`)
    )
  })
})
