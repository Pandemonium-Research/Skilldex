import { cp, rm, mkdir } from 'node:fs/promises'
import path from 'node:path'
import type { ScopeLevel } from '../types/scope.js'
import type { InstalledSkill } from '../types/manifest.js'
import type { ValidationResult } from '../types/skill.js'
import { validateSkill, SPEC_VERSION } from './validator.js'
import { resolveScope, resolveAllScopes } from './resolver.js'
import { addSkillToManifest, removeSkillFromManifest, readManifest } from './manifest.js'

export interface InstallOptions {
  scope: ScopeLevel
  force?: boolean
  dryRun?: boolean
  sourceUrl?: string
}

export interface InstallResult {
  skillName: string
  scope: ScopeLevel
  installedPath: string
  validation: ValidationResult
  alreadyExisted: boolean
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

  return {
    skillName,
    scope: options.scope,
    installedPath: targetDir,
    validation,
    alreadyExisted,
  }
}

export async function uninstallSkill(skillName: string, scope: ScopeLevel): Promise<void> {
  const scopeConfig = await resolveScope(scope)
  const manifest = await readManifest(scopeConfig)

  if (!(skillName in manifest.skills)) {
    throw new Error(`Skill "${skillName}" is not installed at ${scope} scope`)
  }

  const skillDir = path.join(scopeConfig.skillsDir, skillName)
  await rm(skillDir, { recursive: true, force: true })
  await removeSkillFromManifest(scopeConfig, skillName)
}
