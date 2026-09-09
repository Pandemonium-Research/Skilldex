import { mkdir, symlink, lstat, readlink, rm, cp, realpath, stat, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import type { ScopeLevel } from '../types/scope.js'

/**
 * Bridging installed skills into the directories agent harnesses actually read.
 *
 * Skilldex installs into `.skilldex/…`, which no harness scans. The Agent Skills
 * specification declines to mandate a location — "the Agent Skills specification does not
 * mandate where skill directories live (it only defines what goes inside them)" — but its
 * client-implementation guide documents the convention the ecosystem converged on:
 * a client-native directory plus `.agents/skills/` for cross-client interoperability.
 *
 * Surveying sixteen harnesses (2026-09-03, EACL_FINDINGS.md §7) found that two directories
 * reach fourteen of them:
 *
 *   .agents/skills/  — Codex (native), Gemini CLI, Cursor, Copilot, OpenCode, Deep Code,
 *                      and per vendor docs Windsurf, Antigravity, Amp, Crush
 *   .claude/skills/  — Claude Code (native), Cursor, Copilot, Cline, OpenCode, Amp, Crush
 *
 * Kimi and Qwen Code read only their own paths; Aider scans no skills directory at all and
 * cannot be bridged to by any package manager.
 */

/** A directory some harness reads, and who reads it — the `why` is user-facing on conflict. */
export interface BridgeTarget {
  dir: string
  readers: string
  /**
   * When set, link here only if this directory already exists — i.e. the harness is actually
   * installed. Vendor-private paths carry this so that installing a skill does not scatter
   * `~/.qwen/skills` and `~/.cline/skills` across the machine of someone who uses neither.
   * The two shared conventions have no guard: they are the agreed cross-tool location.
   */
  requires?: string
}

export interface BridgeLink {
  target: string
  linked: boolean
  /**
   * How the skill is served there. A copy is a fallback, not an equivalent: it is a snapshot,
   * so it goes stale unless re-bridged, which is why bridgeSkill refreshes one rather than
   * leaving it alone. Absent when nothing was created, i.e. on a conflict.
   */
  mechanism?: 'symlink' | 'copy'
  /** Set when the entry existed and was not ours, so it was left untouched. */
  conflict?: string
}

const AGENTS_READERS = 'Codex, Gemini CLI, Cursor, Copilot, OpenCode, Windsurf, Antigravity, Amp, Crush'
const CLAUDE_READERS = 'Claude Code, Cursor, Copilot, Cline, OpenCode, Amp, Crush'

/**
 * Harnesses read at two tiers, project and user, so the three Skilldex scopes collapse to
 * two: `project` bridges beside the project, `global` and `shared` both bridge into $HOME.
 */
export function bridgeTargets(scope: ScopeLevel, projectRoot: string): BridgeTarget[] {
  const base = scope === 'project' ? projectRoot : os.homedir()
  const j = (...parts: string[]) => path.join(base, ...parts)

  const targets: BridgeTarget[] = [
    { dir: j('.agents', 'skills'), readers: AGENTS_READERS },
    { dir: j('.claude', 'skills'), readers: CLAUDE_READERS },
  ]

  // Harnesses that read neither shared convention at this tier. Guarded on the harness's own
  // config directory, so they cost nothing for users who do not have that harness.
  if (scope === 'project') {
    targets.push({ dir: j('.qwen', 'skills'), readers: 'Qwen Code', requires: j('.qwen') })
  } else {
    targets.push(
      { dir: j('.qwen', 'skills'), readers: 'Qwen Code', requires: j('.qwen') },
      { dir: j('.cline', 'skills'), readers: 'Cline', requires: j('.cline') },
      // Antigravity reads ~/.gemini/config/skills; ~/.gemini is shared with Gemini CLI, and its
      // presence means one of the two is installed.
      { dir: j('.gemini', 'config', 'skills'), readers: 'Antigravity', requires: j('.gemini') }
    )
  }

  return targets
}

/** The subset of {@link bridgeTargets} whose guard is satisfied on this machine. */
export async function applicableTargets(
  scope: ScopeLevel,
  projectRoot: string
): Promise<BridgeTarget[]> {
  const targets = bridgeTargets(scope, projectRoot)
  const keep = await Promise.all(
    targets.map(async (t) => {
      if (!t.requires) return true
      try {
        return (await stat(t.requires)).isDirectory()
      } catch {
        return false
      }
    })
  )
  return targets.filter((_, i) => keep[i])
}

/**
 * Marker left inside a copied bridge, naming what it was copied from.
 *
 * A symlink says what it points at; a copy says nothing, and that silence was the whole bug. With
 * no way to tell our copy from a directory the user wrote by hand, uninstall could only refuse to
 * touch either — so on Windows a skill survived its own uninstall, stayed loaded in every harness,
 * and made the next install report a conflict against Skilldex's own leftovers.
 *
 * The marker restores the property a symlink has for free: the entry itself carries proof of
 * where it came from. That is checked at removal time rather than trusted from a record kept
 * elsewhere, which matters because a manifest could only say we *created* something — not that it
 * is still ours, nor that the user has not replaced it since.
 */
const BRIDGE_MARKER = '.skilldex-bridge.json'

/**
 * Compare two paths for identity.
 *
 * Case-folded on Windows, where `C:\Users\…` and `c:\users\…` are the same directory and a
 * literal string comparison would call a bridge someone else's and refuse to remove it.
 */
function samePath(a: string, b: string): boolean {
  const norm = (p: string) => (process.platform === 'win32' ? path.resolve(p).toLowerCase() : path.resolve(p))
  return norm(a) === norm(b)
}

/** The source recorded inside a copied bridge, or null if there is no readable marker. */
async function markedSource(entry: string): Promise<string | null> {
  try {
    const raw = await readFile(path.join(entry, BRIDGE_MARKER), 'utf8')
    const parsed = JSON.parse(raw) as { source?: unknown }
    return typeof parsed.source === 'string' ? parsed.source : null
  } catch {
    return null
  }
}

/**
 * How `entry` came to be ours, or null when it is not ours to touch.
 *
 * Only a null result protects a user's own directory, so every branch that cannot prove ownership
 * must return it — including a marker that names a *different* source, which is a bridge belonging
 * to some other install.
 */
async function bridgeOwnership(
  entry: string,
  source: string
): Promise<'symlink' | 'copy' | null> {
  let stats
  try {
    stats = await lstat(entry)
  } catch {
    return null
  }

  if (stats.isSymbolicLink()) {
    try {
      const dest = path.resolve(path.dirname(entry), await readlink(entry))
      if (samePath(dest, source)) return 'symlink'
      // realpath resolves the rest of the chain, and throws if either end is already gone.
      return samePath(await realpath(dest), await realpath(source)) ? 'symlink' : null
    } catch {
      return null
    }
  }

  // Defensive rather than load-bearing: reading a marker inside a non-directory fails anyway, so
  // this only saves a syscall and states the intent that a bridge is a link or a directory.
  if (!stats.isDirectory()) return null

  const marked = await markedSource(entry)
  return marked !== null && samePath(marked, source) ? 'copy' : null
}

/** Copy the skill and record where it came from, so it can be recognised later. */
async function copyBridge(source: string, entry: string): Promise<void> {
  await cp(source, entry, { recursive: true })
  await writeFile(
    path.join(entry, BRIDGE_MARKER),
    `${JSON.stringify({ source: path.resolve(source), createdAt: new Date().toISOString() }, null, 2)}\n`,
    'utf8'
  )
}

/**
 * Link an installed skill into every harness directory for its scope.
 *
 * Symlinks rather than copies: `.skilldex/` stays the single source of truth, so scoping
 * still decides what a session sees and uninstall stays coherent. Both major harnesses
 * document following them — Claude Code "follows the symlink and reads SKILL.md from the
 * target directory", Codex "supports symlinked skill folders". Windows without developer
 * mode cannot create them unprivileged, so fall back to copying there.
 *
 * An entry that exists and is not ours is **never** overwritten: it is somebody's
 * hand-authored skill, and silently replacing it would be the worst possible failure.
 */
export async function bridgeSkill(
  skillName: string,
  installedPath: string,
  scope: ScopeLevel,
  projectRoot: string
): Promise<BridgeLink[]> {
  const results: BridgeLink[] = []

  for (const { dir } of await applicableTargets(scope, projectRoot)) {
    const link = path.join(dir, skillName)
    const owned = await bridgeOwnership(link, installedPath)

    // A symlink is already live — it resolves to whatever the source holds now, so there is
    // nothing to do however many times the skill is reinstalled or updated.
    if (owned === 'symlink') {
      results.push({ target: link, linked: true, mechanism: 'symlink' })
      continue
    }

    // A copy is a snapshot and does not follow the source, so re-bridging has to rewrite it.
    // Every update goes through installFromPath with force, which lands here: leaving the copy
    // alone would let `skillpm update` report success while the harness kept reading the old
    // skill. Silent staleness is worse than a loud failure.
    if (owned === 'copy') {
      await rm(link, { recursive: true, force: true })
      await copyBridge(installedPath, link)
      results.push({ target: link, linked: true, mechanism: 'copy' })
      continue
    }

    let occupied = false
    try {
      await lstat(link)
      occupied = true
    } catch {
      // free
    }

    if (occupied) {
      results.push({
        target: link,
        linked: false,
        conflict: 'exists and was not created by skilldex',
      })
      continue
    }

    await mkdir(dir, { recursive: true })
    try {
      await symlink(installedPath, link, 'dir')
      results.push({ target: link, linked: true, mechanism: 'symlink' })
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'EPERM') throw e

      // EPERM is Windows without developer mode, where an unprivileged process cannot create a
      // symlink. A junction can be created without any privilege, and is a real reparse point:
      // lstat reports isSymbolicLink, readlink returns the target, and removing one unlinks the
      // junction rather than deleting through it. Everything downstream is therefore unchanged.
      //
      // Preferring it to a copy is not a tidiness point. A copy is a snapshot that silently goes
      // stale, doubles the bytes on disk, and — before the marker below existed — could not be
      // told apart from a directory the user wrote by hand. A junction has none of those
      // problems, and it is available on precisely the machines that were falling back to copying.
      if (process.platform === 'win32') {
        try {
          await symlink(installedPath, link, 'junction')
          results.push({ target: link, linked: true, mechanism: 'symlink' })
          continue
        } catch {
          // Junctions are local-volume and directory-only; fall through for anything they
          // cannot express rather than failing the install.
        }
      }

      await copyBridge(installedPath, link)
      results.push({ target: link, linked: true, mechanism: 'copy' })
    }
  }

  return results
}

/**
 * Remove only bridges belonging to this install; leave anything else alone.
 *
 * Copies are removed as well as symlinks, which is what the marker exists for. Before it, a copy
 * was unrecognisable, so uninstall silently left the skill loaded in every harness that read it
 * — and reinstalling then failed against Skilldex's own orphan.
 *
 * Ownership is re-checked here rather than read from a record: what matters at removal time is
 * that the entry is still ours, not that we once created it.
 */
export async function unbridgeSkill(
  skillName: string,
  installedPath: string,
  scope: ScopeLevel,
  projectRoot: string
): Promise<string[]> {
  const removed: string[] = []

  // Every candidate, not just the applicable ones: a guard may have gone false since install
  // (the harness was removed), and a link we created must still be ours to clean up.
  for (const { dir } of bridgeTargets(scope, projectRoot)) {
    const link = path.join(dir, skillName)
    if (await bridgeOwnership(link, installedPath)) {
      await rm(link, { recursive: true, force: true })
      removed.push(link)
    }
  }

  return removed
}
