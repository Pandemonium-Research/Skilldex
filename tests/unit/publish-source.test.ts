/**
 * What `skillpm publish` and `skillpm skillset publish` send to the registry.
 *
 * Both commands used to carry private copies of this logic, and both copies had the same two
 * defects. The source URL named the repository root regardless of where the artifact lived, so a
 * repo holding several skillsets — the shape this project uses — sent the registry looking for
 * SKILLSET.md at the root, where there is none. And the frontmatter regex could not read a CRLF
 * file, so publishing aborted with "make sure you are in a skill folder", blaming the author's
 * working directory for their line endings.
 *
 * Both are checked here against a real git repository, because the URL is assembled from real
 * `git` output and a mock of it would only assert that the mock matches the code.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { mkdtemp, rm, mkdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { simpleGit } from 'simple-git'
import { detectSourceUrl, readFrontmatterName } from '../../src/core/publish-source.js'

const REMOTE = 'https://github.com/acme/skillsets'

let repo: string

beforeAll(async () => {
  repo = await mkdtemp(path.join(tmpdir(), 'publish-source-'))
  const git = simpleGit(repo)
  await git.init()
  await git.addConfig('user.email', 'test@example.com')
  await git.addConfig('user.name', 'test')
  await git.addRemote('origin', `${REMOTE}.git`)

  await mkdir(path.join(repo, 'developer', 'assets'), { recursive: true })
  await writeFile(path.join(repo, 'developer', 'SKILLSET.md'), '---\nname: developer\n---\n\n# developer\n')
  await writeFile(path.join(repo, 'README.md'), '# repo\n')
  await git.add('.')
  await git.commit('init')
  // Name the branch deterministically; git's default varies by version and config.
  await git.raw(['branch', '-M', 'main'])
})

afterAll(async () => {
  await rm(repo, { recursive: true, force: true })
})

describe('detectSourceUrl', () => {
  it('points at the subdirectory the artifact actually lives in', async () => {
    // The whole bug: without the subpath the registry fetches SKILLSET.md from the repo root and
    // 404s, which surfaces as an unexplained 422 at publish time.
    expect(await detectSourceUrl(path.join(repo, 'developer'))).toBe(`${REMOTE}/tree/main/developer`)
  })

  it('returns the bare remote when the artifact is the repository', async () => {
    expect(await detectSourceUrl(repo)).toBe(REMOTE)
  })

  it('names the branch actually checked out', async () => {
    const git = simpleGit(repo)
    await git.checkoutLocalBranch('release')
    try {
      expect(await detectSourceUrl(path.join(repo, 'developer'))).toBe(
        `${REMOTE}/tree/release/developer`
      )
    } finally {
      await git.checkout('main')
    }
  })

  it('normalises an SSH remote and strips the .git suffix', async () => {
    const git = simpleGit(repo)
    await git.remote(['set-url', 'origin', 'git@github.com:acme/skillsets.git'])
    try {
      expect(await detectSourceUrl(path.join(repo, 'developer'))).toBe(
        `${REMOTE}/tree/main/developer`
      )
    } finally {
      await git.remote(['set-url', 'origin', `${REMOTE}.git`])
    }
  })

  it('gives up rather than guessing outside a repository', async () => {
    const loose = await mkdtemp(path.join(tmpdir(), 'not-a-repo-'))
    try {
      expect(await detectSourceUrl(loose)).toBeNull()
    } finally {
      await rm(loose, { recursive: true, force: true })
    }
  })
})

describe('readFrontmatterName', () => {
  const NAME = 'skillset-creator'
  const doc = ['---', `name: ${NAME}`, 'description: "A quoted value."', '---', '', '# body', ''].join('\n')

  it('reads a name from an LF file', async () => {
    const f = path.join(repo, 'lf.md')
    await writeFile(f, doc)
    expect(await readFrontmatterName(f)).toBe(NAME)
  })

  it('reads a name from a CRLF file', async () => {
    // skillset-creator/SKILLSET.md was sitting on disk as CRLF and could not be published at all.
    const f = path.join(repo, 'crlf.md')
    await writeFile(f, doc.replace(/\n/g, '\r\n'))
    expect(await readFrontmatterName(f)).toBe(NAME)
  })

  it('returns null for a file with no frontmatter, rather than throwing', async () => {
    const f = path.join(repo, 'plain.md')
    await writeFile(f, '# just a heading\n')
    expect(await readFrontmatterName(f)).toBeNull()
  })

  it('returns null when frontmatter carries no name', async () => {
    const f = path.join(repo, 'nameless.md')
    await writeFile(f, '---\ndescription: no name here\n---\n')
    expect(await readFrontmatterName(f)).toBeNull()
  })

  it('returns null for a missing file', async () => {
    expect(await readFrontmatterName(path.join(repo, 'nope.md'))).toBeNull()
  })
})
