import path from 'node:path'

/**
 * Deciding what an install source is: a registry name, or something on disk or in git.
 *
 * The rule existed in three places — the skill installer, the skillset installer, and inline in
 * the MCP server — each spelled slightly differently and all wrong in the same way. None of them
 * recognised a Windows absolute path, because they tested `startsWith('/')` and `includes('://')`:
 * `C:/skills/demo` starts with neither and contains `:/` but not `://`, so it was sent to the
 * registry and came back a confusing 404 for a directory sitting on the user's disk.
 *
 * One copy is the point. Three spellings of one rule is how two of them stay broken after the
 * third is fixed.
 */

/** A Windows absolute path — `C:\x`, `C:/x` — recognised on every platform, not just win32. */
const WINDOWS_DRIVE = /^[a-zA-Z]:[\\/]/

/** A UNC share, `\\server\share`. */
const UNC = /^\\\\/

/**
 * Does this source name something on disk?
 *
 * Windows forms are matched even when running on POSIX. A directory literally named `C:` is
 * possible there and would now be read as a path, which is the safer misreading of the two: a
 * path that does not exist fails immediately and says so, where a name sent to the registry
 * returns a 404 that blames the wrong thing.
 */
export function isLocalPath(source: string): boolean {
  return (
    path.isAbsolute(source) ||
    WINDOWS_DRIVE.test(source) ||
    UNC.test(source) ||
    source.startsWith('./') ||
    source.startsWith('.\\') ||
    source.startsWith('../') ||
    source.startsWith('..\\') ||
    source.endsWith('.md')
  )
}

/** A `git+https://…` source, cloned rather than read from disk or fetched from the registry. */
export function isGitSource(source: string): boolean {
  return source.startsWith('git+')
}

/**
 * A bare name to look up in the registry.
 *
 * Defined by exclusion rather than by a pattern for what a name may contain: the registry decides
 * what names it accepts, and a stricter guess here would reject valid ones by refusing to ask.
 */
export function isRegistryName(source: string): boolean {
  return !isGitSource(source) && !isLocalPath(source) && !source.includes('://')
}
