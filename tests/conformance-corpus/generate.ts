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
  /**
   * Contents of every member SKILL.md and shared asset, keyed by skillset-relative path.
   *
   * Coherence is the one check that reads beyond SKILLSET.md, and the registry's validators are
   * pure functions over content — they never touch a filesystem. Without these the registry could
   * vendor this file and reproduce nothing.
   */
  blobs: Record<string, string>
  /** What skilldex computes. The registry must now reproduce it, not merely record it. */
  expectedCoherence: {
    membersChecked: number
    membersCoherent: number
    passCount: number
    warnCount: number
    errorCount: number
    declaredConventions: number
  } | null
}

/**
 * The files a coherence check reads: every member's SKILL.md and every shared asset.
 *
 * Deliberately not every file in the fixture. The listing in `files` already answers the
 * existence questions, so embedding the rest would grow the manifest without letting the
 * registry verify anything it cannot verify already.
 */
function coherenceBlobs(dir: string, files: string[]): Record<string, string> {
  const wanted = files.filter((f) => {
    const parts = f.split('/')
    if (parts.length === 2 && parts[1] === 'SKILL.md') return true
    return parts.length === 2 && parts[0] === 'assets' && parts[1].endsWith('.md')
  })

  return Object.fromEntries(
    wanted.map((f) => [f, readFileSync(path.join(dir, ...f.split('/')), 'utf8')])
  )
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
        blobs: coherenceBlobs(dir, files),
        expectedCoherence: result.coherence
          ? {
              membersChecked: result.coherence.membersChecked,
              membersCoherent: result.coherence.membersCoherent,
              passCount: result.coherence.passCount,
              warnCount: result.coherence.warnCount,
              errorCount: result.coherence.errorCount,
              declaredConventions: result.coherence.declaredConventions.length,
            }
          : null,
      })
    }
  }

  const manifest = {
    // Bump when the SHAPE of this file changes, so a stale vendored copy is obvious.
    // 2: coherence became reproducible rather than informational — added `blobs` and renamed
    // `coherence` to `expectedCoherence`, matching `expectedScore`.
    formatVersion: 2,
    generatedBy: 'skilldex tests/conformance-corpus/generate.ts',
    note:
      'Expected values are produced by skilldex, the reference implementation. ' +
      'skilldex-registry vendors this file and must reproduce every expectedScore and ' +
      'expectedCoherence from its own validators.',
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
