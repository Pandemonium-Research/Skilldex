import { cp, rm, mkdir, stat } from 'node:fs/promises'
import path from 'node:path'
import type { ScopeLevel } from '../types/scope.js'
import type { InstalledSkillset } from '../types/manifest.js'
import type { SkillsetValidationResult, RemoteSkillRef } from '../types/skillset.js'
import type { InstallResult } from './installer.js'
import { validateSkillset, SKILLSET_SPEC_VERSION } from './skillset-validator.js'
import { resolveScope } from './resolver.js'
import { addSkillsetToManifest, removeSkillsetFromManifest, readManifest } from './manifest.js'
import { installFromPath, uninstallSkill, projectRootFor } from './installer.js'
import {
  bridgeEntry,
  bridgeSkill,
  unbridgeEntry,
  unbridgeSkill,
  type BridgeLink,
} from './harness-bridge.js'

/** The skillset-level directory members reference as `../assets/…`. */
const ASSETS_DIR = 'assets'

export interface SkillsetInstallOptions {
  scope: ScopeLevel
  force?: boolean
  dryRun?: boolean
  sourceUrl?: string
}

export interface SkillsetInstallResult {
  skillsetName: string
  scope: ScopeLevel
  installedPath: string
  validation: SkillsetValidationResult
  embeddedResults: InstallResult[]
  remoteResults: InstallResult[]
  alreadyExisted: boolean
  /** Where the shared assets are served beside the members (empty for a skillset without assets). */
  assetLinks: BridgeLink[]
}

export async function installSkillsetFromPath(
  sourcePath: string,
  options: SkillsetInstallOptions
): Promise<SkillsetInstallResult> {
  const absSource = path.resolve(sourcePath)
  const validation = await validateSkillset(absSource)

  if (validation.errorCount > 0) {
    throw new Error(
      `Skillset validation failed with ${validation.errorCount} error(s). Run "skillpm skillset validate" for details.`
    )
  }

  const skillsetName = validation.skillset
  const scopeConfig = await resolveScope(options.scope)

  const existingManifest = await readManifest(scopeConfig)
  let alreadyExisted = false

  if (skillsetName in existingManifest.skillsets) {
    if (!options.force) {
      throw new Error(
        `Skillset "${skillsetName}" is already installed at ${options.scope} scope. Use --force to overwrite.`
      )
    }
    alreadyExisted = true
    // Remove the old skillset directory but leave individual skills (they'll be overwritten by installFromPath --force)
    const oldDir = path.join(scopeConfig.skillsetsDir, skillsetName)
    await rm(oldDir, { recursive: true, force: true })
  }

  if (options.dryRun) {
    return {
      skillsetName,
      scope: options.scope,
      installedPath: path.join(scopeConfig.skillsetsDir, skillsetName),
      validation,
      embeddedResults: [],
      remoteResults: [],
      alreadyExisted,
      assetLinks: [],
    }
  }

  // Install embedded skills
  const embeddedResults: InstallResult[] = []
  for (const skillName of validation.embeddedSkills) {
    const skillPath = path.join(absSource, skillName)
    const result = await installFromPath(skillPath, {
      scope: options.scope,
      force: options.force,
      sourceUrl: options.sourceUrl,
    })
    embeddedResults.push(result)
  }

  // Install remote skills
  const remoteResults: InstallResult[] = []
  for (const ref of validation.remoteSkills) {
    const { installFromGitUrl } = await import('../registry/sources/github.js')
    const result = await installFromGitUrl(`git+${ref.source_url}`, {
      scope: options.scope,
      force: options.force,
      sourceUrl: ref.source_url,
    })
    remoteResults.push(result)
  }

  // Copy SKILLSET.md + assets/ into skillsetsDir/<name>/
  const targetDir = path.join(scopeConfig.skillsetsDir, skillsetName)
  await mkdir(targetDir, { recursive: true })
  await cp(path.join(absSource, 'SKILLSET.md'), path.join(targetDir, 'SKILLSET.md'))

  const assetsPath = path.join(absSource, ASSETS_DIR)
  let hasAssets = false
  try {
    await stat(assetsPath)
    hasAssets = true
  } catch {
    // no assets dir — that's fine
  }
  if (hasAssets) await cp(assetsPath, path.join(targetDir, ASSETS_DIR), { recursive: true })

  // Members reach the shared assets as `../assets/…`, relative to wherever the member is read from.
  // In the source that is the skillset directory; once installed, the members sit in skills/<name>
  // and in every harness directory they are linked into, while the assets sit in
  // skillsets/<name>/assets — so `../assets` found nothing, and an agent following a member's own
  // instruction to load the shared convention could not. Serve the assets beside the members:
  // in skills/, for a path resolved through the member's link, and in each harness directory, for
  // a path resolved as text from where the harness found the member. One `assets` entry fits in a
  // directory, so a second skillset with its own assets is reported as a conflict, never swapped in.
  let assetLinks: BridgeLink[] = []
  if (hasAssets) {
    const shared = path.join(targetDir, ASSETS_DIR)
    assetLinks = [
      await bridgeEntry(path.join(scopeConfig.skillsDir, ASSETS_DIR), shared),
      ...(await bridgeSkill(ASSETS_DIR, shared, options.scope, projectRootFor(scopeConfig))),
    ]
  }

  const installed: InstalledSkillset = {
    name: skillsetName,
    version: '1.0.0',
    source: options.sourceUrl ? 'community' : 'local',
    sourceUrl: options.sourceUrl,
    installedAt: new Date().toISOString(),
    specVersion: SKILLSET_SPEC_VERSION,
    score: validation.score,
    path: path.join('skillsets', skillsetName),
    embeddedSkills: validation.embeddedSkills,
    remoteSkills: validation.remoteSkills.map((r: RemoteSkillRef) => r.name),
  }

  await addSkillsetToManifest(scopeConfig, installed)

  return {
    skillsetName,
    scope: options.scope,
    installedPath: targetDir,
    validation,
    embeddedResults,
    remoteResults,
    alreadyExisted,
    assetLinks,
  }
}

export async function uninstallSkillset(skillsetName: string, scope: ScopeLevel): Promise<void> {
  const scopeConfig = await resolveScope(scope)
  const manifest = await readManifest(scopeConfig)

  if (!(skillsetName in manifest.skillsets)) {
    throw new Error(`Skillset "${skillsetName}" is not installed at ${scope} scope`)
  }

  const skillset = manifest.skillsets[skillsetName]

  // Uninstall all skills that were installed as part of this skillset
  const allSkillNames = [...skillset.embeddedSkills, ...skillset.remoteSkills]
  for (const skillName of allSkillNames) {
    try {
      await uninstallSkill(skillName, scope)
    } catch {
      // Skill might have been manually removed — continue
    }
  }

  // Remove the skillset directory, and first the entries serving its assets beside the members —
  // only those that are still ours, which is checked against the assets they point at.
  const skillsetDir = path.join(scopeConfig.skillsetsDir, skillsetName)
  const shared = path.join(skillsetDir, ASSETS_DIR)
  await unbridgeEntry(path.join(scopeConfig.skillsDir, ASSETS_DIR), shared)
  await unbridgeSkill(ASSETS_DIR, shared, scope, projectRootFor(scopeConfig))
  await rm(skillsetDir, { recursive: true, force: true })

  await removeSkillsetFromManifest(scopeConfig, skillsetName)
}
