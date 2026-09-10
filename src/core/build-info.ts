/**
 * What the running code was built from.
 *
 * `--version` used to read package.json. In a linked checkout that is the source tree, not the
 * build: after a `git pull` the reported version moves and dist/ does not. The version now comes
 * from dist/build-info.json, written at build time by scripts/write-build-info.mjs.
 *
 * The record is looked up beside the running code, not at the package root. Built, this module is
 * dist/core/build-info.js and finds dist/build-info.json. Run from source (tsx, vitest) it is
 * src/core/build-info.ts, finds no src/build-info.json, and falls back to package.json — which is
 * right there, because the source tree is what runs. Reading from the package root would make a
 * source run report whatever dist/ was last built from: the same bug, inverted.
 */
import { readFileSync, existsSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

export interface BuildInfo {
  version: string
  /** Full SHA the build was compiled from; null when built outside its own git checkout. */
  commit: string | null
  /** Tracked files differed from `commit` at build time; null when unknown. */
  dirty: boolean | null
  builtAt: string | null
}

/** dist/ when built, src/ when run from source. */
const CODE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

/** A build record, or null if it is not one — a record without a version is no use to anyone. */
export function parseBuildInfo(raw: unknown): BuildInfo | null {
  if (typeof raw !== 'object' || raw === null) return null
  const r = raw as Record<string, unknown>
  if (typeof r.version !== 'string' || r.version.length === 0) return null
  return {
    version: r.version,
    commit: typeof r.commit === 'string' ? r.commit : null,
    dirty: typeof r.dirty === 'boolean' ? r.dirty : null,
    builtAt: typeof r.builtAt === 'string' ? r.builtAt : null,
  }
}

export function readBuildInfo(codeRoot: string = CODE_ROOT): BuildInfo {
  try {
    const raw: unknown = JSON.parse(readFileSync(path.join(codeRoot, 'build-info.json'), 'utf8'))
    const parsed = parseBuildInfo(raw)
    if (parsed) return parsed
  } catch {
    // No record beside this code (running from source), or it is unreadable — fall through.
  }
  const pkg = JSON.parse(readFileSync(path.join(codeRoot, '..', 'package.json'), 'utf8')) as {
    version: string
  }
  return { version: pkg.version, commit: null, dirty: null, builtAt: null }
}

/**
 * HEAD of the git checkout this package runs from, or null when it is not one.
 *
 * Only a checkout can drift from its build. A published install has no .git, and this must not
 * shell out there: scripts call `--version`, and a git subprocess on every call would be a cost
 * paid for a problem that install cannot have.
 */
export function checkoutHead(codeRoot: string = CODE_ROOT): string | null {
  const packageRoot = path.join(codeRoot, '..')
  if (!existsSync(path.join(packageRoot, '.git'))) return null
  try {
    return execFileSync('git', ['rev-parse', 'HEAD'], {
      cwd: packageRoot,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
      timeout: 2000,
    }).trim()
  } catch {
    return null
  }
}

/**
 * A warning when the build is older than the checkout it runs from; otherwise null.
 *
 * Catches a `git pull` without a rebuild, the case that mislabelled a build. It does not catch
 * uncommitted edits made after building — HEAD has not moved, and detecting that would mean
 * hashing the source tree on every `--version`.
 */
export function stalenessWarning(info: BuildInfo, head: string | null): string | null {
  if (!info.commit || !head || info.commit === head) return null
  return (
    `warning: this skillpm was built from ${info.commit.slice(0, 7)}, but the checkout it runs ` +
    `from is at ${head.slice(0, 7)}. Run \`npm run build\` there to update it.`
  )
}
