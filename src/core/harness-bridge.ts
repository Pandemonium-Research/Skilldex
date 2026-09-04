import { mkdir, symlink, lstat, readlink, rm, cp, realpath } from 'node:fs/promises'
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
}

export interface BridgeLink {
  target: string
  linked: boolean
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
  return [
    { dir: path.join(base, '.agents', 'skills'), readers: AGENTS_READERS },
    { dir: path.join(base, '.claude', 'skills'), readers: CLAUDE_READERS },
  ]
}

/** Does `entry` already point at `source`? Only then is it ours to replace or remove. */
async function pointsAt(entry: string, source: string): Promise<boolean> {
  try {
    const stats = await lstat(entry)
    if (!stats.isSymbolicLink()) return false
    const dest = path.resolve(path.dirname(entry), await readlink(entry))
    return path.resolve(dest) === path.resolve(source) || (await realpath(dest)) === (await realpath(source))
  } catch {
    return false
  }
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

  for (const { dir } of bridgeTargets(scope, projectRoot)) {
    const link = path.join(dir, skillName)

    if (await pointsAt(link, installedPath)) {
      results.push({ target: link, linked: true })
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
      results.push({ target: link, linked: true })
    } catch (e) {
      // EPERM is the Windows-without-developer-mode case: copy so the skill still loads.
      if ((e as NodeJS.ErrnoException).code === 'EPERM') {
        await cp(installedPath, link, { recursive: true })
        results.push({ target: link, linked: true })
      } else {
        throw e
      }
    }
  }

  return results
}

/** Remove only links that point at this install; leave anything else alone. */
export async function unbridgeSkill(
  skillName: string,
  installedPath: string,
  scope: ScopeLevel,
  projectRoot: string
): Promise<string[]> {
  const removed: string[] = []

  for (const { dir } of bridgeTargets(scope, projectRoot)) {
    const link = path.join(dir, skillName)
    if (await pointsAt(link, installedPath)) {
      await rm(link, { recursive: true, force: true })
      removed.push(link)
    }
  }

  return removed
}
