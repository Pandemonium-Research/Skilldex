import { readFile, realpath } from 'node:fs/promises'
import path from 'node:path'
import { simpleGit } from 'simple-git'
import { parse as parseYaml } from 'yaml'

/**
 * Shared by `skillpm publish` and `skillpm skillset publish`.
 *
 * Both commands need the same two things — the name out of a frontmatter block, and the GitHub URL
 * to hand the registry — and both had their own copy of each. The copies drifted into the same two
 * bugs: a frontmatter regex that could not read a CRLF file, and a source URL that pointed at the
 * repository root no matter where the artifact actually lived. One implementation, so the next fix
 * lands in one place.
 */

/**
 * Reads `name` from a leading YAML frontmatter block.
 *
 * `\r?` on both delimiters: a file authored or checked out on Windows opens with "---\r\n", which
 * a bare `\n` pattern does not match. Publishing then failed with "could not read name — make sure
 * you are in a skill folder", pointing the author at their working directory rather than at their
 * line endings.
 */
export async function readFrontmatterName(filePath: string): Promise<string | null> {
  try {
    const content = await readFile(filePath, 'utf-8')
    const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---/)
    if (!match) return null

    const fm = parseYaml(match[1]) as Record<string, unknown>
    return typeof fm['name'] === 'string' ? fm['name'] : null
  } catch {
    return null
  }
}

/**
 * The GitHub URL the registry should fetch this artifact from.
 *
 * The bare remote is only correct when the artifact sits at the repository root. A repo holding
 * several skillsets — the normal shape, and the one this project uses — would otherwise send the
 * registry looking for SKILLSET.md at the root and get a 404, surfacing as an unexplained 422 at
 * publish time. Worse, had it succeeded it would have stored a source_url that no later re-fetch
 * could resolve, so every subsequent update would fail too.
 *
 * Returns `<remote>/tree/<branch>/<subpath>` when the artifact is in a subdirectory, and the plain
 * remote when it is not.
 */
export async function detectSourceUrl(dir: string): Promise<string | null> {
  try {
    const git = simpleGit(dir)

    const remotes = await git.getRemotes(true)
    const origin = remotes.find((r) => r.name === 'origin')
    if (!origin?.refs?.fetch) return null

    const base = origin.refs.fetch
      .replace(/^git@github\.com:/, 'https://github.com/')
      .replace(/\.git$/, '')

    // Both ends through realpath. git reports the top level with symlinks resolved, while `dir`
    // arrives however the caller spelt it. Compared unresolved, a subdirectory reached through any
    // link — a symlinked projects folder, or on macOS the temp directory itself (/var is a link to
    // /private/var) — looked like it sat outside the repository, and the bare remote went to the
    // registry: the root-URL bug this function exists to fix, back by another route.
    const root = await realpath((await git.revparse(['--show-toplevel'])).trim())
    const subpath = path
      .relative(root, await realpath(dir))
      .split(path.sep)
      .filter(Boolean)
      .join('/')

    // At the repository root, or somehow outside it — the bare remote is the honest answer.
    if (subpath === '' || subpath.startsWith('..')) return base

    return `${base}/tree/${await currentBranch(git)}/${subpath}`
  } catch {
    return null
  }
}

/**
 * The branch a subpath URL should name.
 *
 * A detached HEAD reports "HEAD", which is not a ref anyone can fetch, so fall back to whatever
 * origin considers its default. Publishing from a detached checkout is unusual, but recording an
 * unfetchable URL would break every later re-score rather than failing now.
 */
async function currentBranch(git: ReturnType<typeof simpleGit>): Promise<string> {
  const head = (await git.revparse(['--abbrev-ref', 'HEAD'])).trim()
  if (head && head !== 'HEAD') return head

  try {
    const ref = (await git.revparse(['--abbrev-ref', 'origin/HEAD'])).trim()
    const name = ref.replace(/^origin\//, '')
    if (name) return name
  } catch {
    // no origin/HEAD configured
  }

  return 'main'
}
