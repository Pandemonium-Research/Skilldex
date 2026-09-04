import { cp, rm, mkdir } from 'node:fs/promises'
import path from 'node:path'
import type { ScopeLevel } from '../types/scope.js'
import type { InstalledSkill } from '../types/manifest.js'
import type { ValidationResult } from '../types/skill.js'
import { validateSkill, SPEC_VERSION } from './validator.js'
import { resolveScope, resolveAllScopes } from './resolver.js'
import { addSkillToManifest, removeSkillFromManifest, readManifest } from './manifest.js'
import { bridgeSkill, unbridgeSkill, type BridgeLink } from './harness-bridge.js'

export interface InstallOptions {
  scope: ScopeLevel
  force?: boolean
  dryRun?: boolean
  sourceUrl?: string
  /** Called when a repo contains multiple skill folders. Return the name of the folder to install. */
  onMultipleSkills?: (names: string[]) => Promise<string>
  /** Link the skill into the harness directories for its scope. Default true. */
  bridge?: boolean
}

export interface InstallResult {
  skillName: string
  scope: ScopeLevel
  installedPath: string
  validation: ValidationResult
  alreadyExisted: boolean
  /** Harness directories linked, and any left alone because something else owned them. */
  bridged: BridgeLink[]
}

export async function installFromPath(
  sourcePath: string,
  options: InstallOptions
): Promise<InstallResult> {
  const absSource = path.resolve(sourcePath)
  const validation = await validateSkill(absSource)
  const skillName = validation.skill

  const scopeConfig = await resolveScope(options.scope)

  // Check for conflicts across all scopes
  if (!options.force) {
    const allScopes = await resolveAllScopes()
    for (const sc of allScopes) {
      if (sc.level === options.scope) continue
      const manifest = await readManifest(sc)
      if (skillName in manifest.skills) {
        // Just a warning — we don't block
        // Caller should surface this
      }
    }
  }

  const targetDir = path.join(scopeConfig.skillsDir, skillName)

  let alreadyExisted = false
  // Check if already installed at this scope
  const existingManifest = await readManifest(scopeConfig)
  if (skillName in existingManifest.skills) {
    if (!options.force) {
      throw new Error(
        `Skill "${skillName}" is already installed at ${options.scope} scope. Use --force to overwrite.`
      )
    }
    alreadyExisted = true
    await rm(targetDir, { recursive: true, force: true })
  }

  if (!options.dryRun) {
    await mkdir(scopeConfig.skillsDir, { recursive: true })
    await cp(absSource, targetDir, { recursive: true })

    const installed: InstalledSkill = {
      name: skillName,
      version: '1.0.0',
      source: options.sourceUrl ? 'community' : 'local',
      sourceUrl: options.sourceUrl,
      installedAt: new Date().toISOString(),
      specVersion: SPEC_VERSION,
      score: validation.score,
      path: path.join('skills', skillName),
    }

    await addSkillToManifest(scopeConfig, installed)
  }

  // Bridging is what makes an install visible to an agent: `.skilldex/` is ours alone, and
  // no harness reads it. Do it after the manifest write so nothing is ever linked before it
  // is really installed.
  let bridged: BridgeLink[] = []
  if (!options.dryRun && options.bridge !== false) {
    bridged = await bridgeSkill(skillName, targetDir, options.scope, projectRootFor(scopeConfig))
  }

  return {
    skillName,
    scope: options.scope,
    installedPath: targetDir,
    validation,
    alreadyExisted,
    bridged,
  }
}

/** For project scope, `rootPath` is `<projectRoot>/.skilldex`; other scopes ignore this. */
function projectRootFor(scopeConfig: { rootPath: string }): string {
  return path.dirname(scopeConfig.rootPath)
}

export async function uninstallSkill(skillName: string, scope: ScopeLevel): Promise<void> {
  const scopeConfig = await resolveScope(scope)
  const manifest = await readManifest(scopeConfig)

  if (!(skillName in manifest.skills)) {
    throw new Error(`Skill "${skillName}" is not installed at ${scope} scope`)
  }

  const skillDir = path.join(scopeConfig.skillsDir, skillName)

  // Unlink before removing the target, so the check that a link is ours can still resolve it.
  await unbridgeSkill(skillName, skillDir, scope, projectRootFor(scopeConfig))

  await rm(skillDir, { recursive: true, force: true })
  await removeSkillFromManifest(scopeConfig, skillName)
}
