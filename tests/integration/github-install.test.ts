import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mkdtemp, mkdir, writeFile, rm, readFile, readdir } from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { simpleGit } from 'simple-git'

/**
 * Integration coverage for `installFromGitUrl` against a real local git repository.
 *
 * The unit suite mocks both `simple-git` and `installFromPath`, so it cannot observe what
 * happens between the clone and the copy. That gap hid a real defect: `installFromPath` was
 * returned without `await` from inside a `try` whose `finally` removes the clone directory, so
 * the temp clone was deleted while the copy was still reading from it.
 *
 * Nothing below `installFromGitUrl` is mocked here — git clones for real, `installFromPath`
 * validates and copies for real. The single exception is `resolveScope`, redirected to a temp
 * directory so the test does not install into the developer's own checkout. That redirection
 * changes only the *destination*; the clone/copy race this test exists to catch is untouched.
 */

let tmpRoot: string

vi.mock('../../src/core/resolver.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/core/resolver.js')>()
  return {
    ...actual,
    resolveScope: async (level: string) => ({
      level,
      rootPath: path.join(tmpRoot, 'scope', level),
      manifestPath: path.join(tmpRoot, 'scope', level, 'skilldex.json'),
      skillsDir: path.join(tmpRoot, 'scope', level, 'skills'),
      skillsetsDir: path.join(tmpRoot, 'scope', level, 'skillsets'),
    }),
    resolveAllScopes: async () => [],
  }
})

/** Files beyond SKILL.md, so the copy is slow enough for a premature cleanup to corrupt it. */
const EXTRA_FILES = 40

async function makeSkillRepo(root: string, skillNames: string[]): Promise<string> {
  const repo = path.join(root, 'repo')
  await mkdir(repo, { recursive: true })

  for (const name of skillNames) {
    const dir = path.join(repo, name)
    await mkdir(path.join(dir, 'references'), { recursive: true })
    await writeFile(
      path.join(dir, 'SKILL.md'),
      `---\nname: ${name}\ndescription: ${'word '.repeat(40).trim()}\n---\n\n## Instructions\n\nDo the thing.\n`
    )
    for (let i = 0; i < EXTRA_FILES; i++) {
      await writeFile(path.join(dir, 'references', `ref-${i}.md`), 'x'.repeat(4096))
    }
  }

  const git = simpleGit(repo)
  await git.init()
  await git.addConfig('user.email', 'tests@skilldex.local')
  await git.addConfig('user.name', 'Skilldex Tests')
  await git.add('.')
  await git.commit('fixture')

  return repo
}

describe('installFromGitUrl — real clone, real install', () => {
  beforeEach(async () => {
    tmpRoot = await mkdtemp(path.join(os.tmpdir(), 'skilldex-git-integration-'))
  })

  afterEach(async () => {
    await rm(tmpRoot, { recursive: true, force: true })
  })

  it('installs a single-skill repo completely, with every bundled file intact', async () => {
    const repo = await makeSkillRepo(tmpRoot, ['solo-skill'])
    const { installFromGitUrl } = await import('../../src/registry/sources/github.js')

    const result = await installFromGitUrl(`file://${repo}`, { scope: 'project' })

    expect(result.skillName).toBe('solo-skill')

    // The skill must be readable at the reported path — not merely reported as installed.
    const installed = await readFile(path.join(result.installedPath, 'SKILL.md'), 'utf8')
    expect(installed).toContain('name: solo-skill')

    // Every bundled file must survive. A cleanup that races the copy truncates this listing.
    const refs = await readdir(path.join(result.installedPath, 'references'))
    expect(refs).toHaveLength(EXTRA_FILES)
  })

  it('installs the selected skill when the repo holds several', async () => {
    const repo = await makeSkillRepo(tmpRoot, ['alpha-skill', 'beta-skill'])
    const { installFromGitUrl } = await import('../../src/registry/sources/github.js')

    const result = await installFromGitUrl(`file://${repo}`, {
      scope: 'project',
      onMultipleSkills: async () => 'beta-skill',
    })

    expect(result.skillName).toBe('beta-skill')

    const installed = await readFile(path.join(result.installedPath, 'SKILL.md'), 'utf8')
    expect(installed).toContain('name: beta-skill')

    const refs = await readdir(path.join(result.installedPath, 'references'))
    expect(refs).toHaveLength(EXTRA_FILES)
  })
})
