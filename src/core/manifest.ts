import { readFile, writeFile, mkdir } from 'node:fs/promises'
import path from 'node:path'
import { z } from 'zod'
import type { SkillManifest, InstalledSkill } from '../types/manifest.js'
import type { ScopeConfig } from '../types/scope.js'

const MANIFEST_VERSION = '1'

const InstalledSkillSchema = z.object({
  name: z.string(),
  version: z.string(),
  source: z.enum(['official', 'community', 'local']),
  sourceUrl: z.string().optional(),
  installedAt: z.string(),
  specVersion: z.string(),
  score: z.number(),
  path: z.string(),
})

const SkillManifestSchema = z.object({
  skilldexVersion: z.string(),
  scope: z.enum(['global', 'shared', 'project']),
  skills: z.record(InstalledSkillSchema),
  updatedAt: z.string(),
})

export function createEmptyManifest(scope: SkillManifest['scope']): SkillManifest {
  return {
    skilldexVersion: MANIFEST_VERSION,
    scope,
    skills: {},
    updatedAt: new Date().toISOString(),
  }
}

export async function readManifest(scopeConfig: ScopeConfig): Promise<SkillManifest> {
  try {
    const raw = await readFile(scopeConfig.manifestPath, 'utf8')
    const parsed = JSON.parse(raw)
    return SkillManifestSchema.parse(parsed) as SkillManifest
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') {
      return createEmptyManifest(scopeConfig.level)
    }
    throw new Error(`Failed to read manifest at ${scopeConfig.manifestPath}: ${e instanceof Error ? e.message : String(e)}`)
  }
}

export async function writeManifest(scopeConfig: ScopeConfig, manifest: SkillManifest): Promise<void> {
  await mkdir(path.dirname(scopeConfig.manifestPath), { recursive: true })
  const tmp = `${scopeConfig.manifestPath}.tmp`
  const content = JSON.stringify({ ...manifest, updatedAt: new Date().toISOString() }, null, 2)
  await writeFile(tmp, content, 'utf8')
  await writeFile(scopeConfig.manifestPath, content, 'utf8')
}

export async function addSkillToManifest(
  scopeConfig: ScopeConfig,
  skill: InstalledSkill
): Promise<void> {
  const manifest = await readManifest(scopeConfig)
  manifest.skills[skill.name] = skill
  await writeManifest(scopeConfig, manifest)
}

export async function removeSkillFromManifest(
  scopeConfig: ScopeConfig,
  skillName: string
): Promise<void> {
  const manifest = await readManifest(scopeConfig)
  if (!(skillName in manifest.skills)) {
    throw new Error(`Skill "${skillName}" not found in ${scopeConfig.level} manifest`)
  }
  delete manifest.skills[skillName]
  await writeManifest(scopeConfig, manifest)
}
