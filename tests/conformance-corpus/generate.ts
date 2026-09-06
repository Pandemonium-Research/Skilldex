/**
 * Regenerate the shared conformance corpus.
 *
 *   npx tsx tests/conformance-corpus/generate.ts
 *
 * The corpus is the contract between skilldex's validators and skilldex-registry's. Both
 * implement the same published rubric from separate code, and on 2026-07-09 they silently
 * diverged: the registry copied skilldex's weight VALUES and branch shape into a
 * count-down loop, inverting what a skipped `else` means. A missing name scored 84 there
 * against 73 here for two months. Nothing caught it, because the registry's own tests
 * asserted only `expect(score).toBeLessThan(100)`.
 *
 * This file walks tests/fixtures/, scores every case with THIS repo's validators, and
 * writes manifest.json. skilldex is the reference implementation, so its output defines
 * the expected values. The registry vendors manifest.json — one self-contained file, no
 * fixture directories to keep in step — and asserts its own validators reproduce every
 * score.
 *
 * The manifest embeds the inputs the registry needs (skillMd / skillsetMd content, file
 * lists, embedded and remote skill refs), because the registry validators are pure
 * functions over content and never touch a filesystem.
 *
 * After changing a validator or a fixture, re-run this and copy manifest.json to
 * ../Skilldex-registry/tests/conformance-corpus/manifest.json. Both test suites then move
 * together, and an implementation that drifts fails on whichever side drifted.
 */
import { readdirSync, readFileSync, statSync, writeFileSync, mkdirSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { validateSkill } from '../../src/core/validator.js'
import { validateSkillset } from '../../src/core/skillset-validator.js'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const FIXTURES = path.join(HERE, '..', 'fixtures')

/** Relative POSIX paths of every file under `dir`, which is what both validators consume. */
function walk(dir: string, base = dir): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name)
    return e.isDirectory() ? walk(p, base) : [path.relative(base, p).split(path.sep).join('/')]
  })
}

interface SkillCase {
  id: string
  kind: 'skill'
  skillMd: string
  files: string[]
  expectedScore: number
}

interface SkillsetCase {
  id: string
  kind: 'skillset'
  skillsetMd: string
  files: string[]
  embeddedSkillNames: string[]
  remoteSkillRefs: Array<{ name: string; source_url: string }>
  expectedScore: number
  /** Recorded for reference only. The registry does not compute coherence (spec 1.1). */
  coherence: { membersChecked: number; membersCoherent: number; errorCount: number } | null
}

async function main() {
  const skills: SkillCase[] = []
  const skillsets: SkillsetCase[] = []

  for (const name of readdirSync(FIXTURES).sort()) {
    const dir = path.join(FIXTURES, name)
    if (!statSync(dir).isDirectory()) continue

    const files = walk(dir)

    if (files.includes('SKILL.md')) {
      const result = await validateSkill(dir)
      skills.push({
        id: name,
        kind: 'skill',
        skillMd: readFileSync(path.join(dir, 'SKILL.md'), 'utf8'),
        files,
        expectedScore: result.score,
      })
    } else if (files.includes('SKILLSET.md')) {
      const result = await validateSkillset(dir)
      skillsets.push({
        id: name,
        kind: 'skillset',
        skillsetMd: readFileSync(path.join(dir, 'SKILLSET.md'), 'utf8'),
        files,
        embeddedSkillNames: result.embeddedSkills,
        remoteSkillRefs: result.remoteSkills.map((r) => ({
          name: r.name,
          source_url: r.source_url,
        })),
        expectedScore: result.score,
        coherence: result.coherence
          ? {
              membersChecked: result.coherence.membersChecked,
              membersCoherent: result.coherence.membersCoherent,
              errorCount: result.coherence.errorCount,
            }
          : null,
      })
    }
  }

  const manifest = {
    // Bump when the SHAPE of this file changes, so a stale vendored copy is obvious.
    formatVersion: 1,
    generatedBy: 'skilldex tests/conformance-corpus/generate.ts',
    note:
      'Expected scores are produced by skilldex, the reference implementation. ' +
      'skilldex-registry vendors this file and must reproduce every expectedScore. ' +
      'Coherence is recorded for reference only — the registry does not compute it.',
    skills,
    skillsets,
  }

  mkdirSync(HERE, { recursive: true })
  const out = path.join(HERE, 'manifest.json')
  writeFileSync(out, JSON.stringify(manifest, null, 2) + '\n', 'utf8')

  console.log(`wrote ${path.relative(process.cwd(), out)}`)
  console.log(`  ${skills.length} skill cases, ${skillsets.length} skillset cases`)
  for (const c of skills) console.log(`    skill     ${c.id.padEnd(26)} ${c.expectedScore}`)
  for (const c of skillsets) console.log(`    skillset  ${c.id.padEnd(26)} ${c.expectedScore}`)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
