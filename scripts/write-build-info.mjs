#!/usr/bin/env node
/**
 * Record what a build was compiled from, in dist/build-info.json.
 *
 *   node scripts/write-build-info.mjs [packageRoot]
 *
 * `skillpm --version` used to read package.json at runtime. For a published install that is
 * harmless — package.json and dist/ ship together — but in a linked checkout it reports the
 * source tree, not the build: after a `git pull` the version moves and dist/ does not. A
 * 2026-09-06 build reported 1.4.0 and ran code without anything 1.3.1 or 1.4.0 added, and an
 * experiment would have recorded it under that label. The version now comes from this file, so
 * a build reports the version it was built at.
 *
 * The commit is recorded only when packageRoot is itself the top of a git checkout. A package
 * built somewhere inside another repository — a git dependency cloned into a project, say —
 * would otherwise record that repository's HEAD, which says nothing about this build.
 */
import { readFileSync, writeFileSync, mkdirSync, realpathSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(process.argv[2] ?? join(dirname(fileURLToPath(import.meta.url)), '..'))
const { version } = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))

function git(args) {
  try {
    return execFileSync('git', args, {
      cwd: root,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim()
  } catch {
    return null // not a git checkout, or git is not installed
  }
}

const topLevel = git(['rev-parse', '--show-toplevel'])
const ownCheckout = topLevel !== null && realpathSync(topLevel) === realpathSync(root)
const commit = ownCheckout ? git(['rev-parse', 'HEAD']) : null
// Tracked files only: dist/ is git-ignored, and untracked scratch files do not change the build.
const status = commit === null ? null : git(['status', '--porcelain', '--untracked-files=no'])

const info = {
  version,
  commit,
  dirty: status === null ? null : status.length > 0,
  builtAt: new Date().toISOString(),
}

mkdirSync(join(root, 'dist'), { recursive: true })
writeFileSync(join(root, 'dist', 'build-info.json'), `${JSON.stringify(info, null, 2)}\n`)
console.log(
  `build-info: ${version} @ ${commit ? commit.slice(0, 7) : 'no commit'}${info.dirty ? ' (dirty)' : ''}`
)
