import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import {
  createEmptyManifest,
  readManifest,
  writeManifest,
  addSkillToManifest,
  removeSkillFromManifest,
} from '../../src/core/manifest.js'
import type { ScopeConfig } from '../../src/types/scope.js'
import type { InstalledSkill } from '../../src/types/manifest.js'

let tmpDir: string
let scopeConfig: ScopeConfig

beforeEach(async () => {
  tmpDir = await mkdtemp(path.join(os.tmpdir(), 'skilldex-test-'))
  scopeConfig = {
    level: 'project',
    rootPath: tmpDir,
    manifestPath: path.join(tmpDir, 'skilldex.json'),
    skillsDir: path.join(tmpDir, 'skills'),
  }
})

afterEach(async () => {
  await rm(tmpDir, { recursive: true, force: true })
})

const makeSkill = (name: string): InstalledSkill => ({
  name,
  version: '1.0.0',
  source: 'local',
  installedAt: new Date().toISOString(),
  specVersion: '1.0',
  score: 90,
  path: `skills/${name}`,
})

describe('createEmptyManifest', () => {
  it('creates a manifest with no skills', () => {
    const m = createEmptyManifest('project')
    expect(m.scope).toBe('project')
    expect(m.skills).toEqual({})
    expect(m.skilldexVersion).toBe('1')
  })
})

describe('readManifest', () => {
  it('returns empty manifest when file does not exist', async () => {
    const m = await readManifest(scopeConfig)
    expect(m.skills).toEqual({})
    expect(m.scope).toBe('project')
  })
})

describe('writeManifest + readManifest', () => {
  it('round-trips correctly', async () => {
    const skill = makeSkill('test-skill')
    const manifest = createEmptyManifest('project')
    manifest.skills['test-skill'] = skill
    await writeManifest(scopeConfig, manifest)

    const read = await readManifest(scopeConfig)
    expect(read.skills['test-skill'].name).toBe('test-skill')
    expect(read.skills['test-skill'].score).toBe(90)
  })
})

describe('addSkillToManifest', () => {
  it('adds a skill and persists it', async () => {
    await addSkillToManifest(scopeConfig, makeSkill('new-skill'))
    const m = await readManifest(scopeConfig)
    expect('new-skill' in m.skills).toBe(true)
  })

  it('overwrites an existing skill', async () => {
    await addSkillToManifest(scopeConfig, makeSkill('skill-a'))
    const updated = { ...makeSkill('skill-a'), score: 50 }
    await addSkillToManifest(scopeConfig, updated)
    const m = await readManifest(scopeConfig)
    expect(m.skills['skill-a'].score).toBe(50)
  })
})

describe('removeSkillFromManifest', () => {
  it('removes an installed skill', async () => {
    await addSkillToManifest(scopeConfig, makeSkill('skill-to-remove'))
    await removeSkillFromManifest(scopeConfig, 'skill-to-remove')
    const m = await readManifest(scopeConfig)
    expect('skill-to-remove' in m.skills).toBe(false)
  })

  it('throws if skill not in manifest', async () => {
    await expect(removeSkillFromManifest(scopeConfig, 'nonexistent')).rejects.toThrow()
  })
})
