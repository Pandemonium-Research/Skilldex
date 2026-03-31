import { readFile, writeFile, mkdir } from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'

export interface SkilldexConfig {
  registryUrl?: string
  token?: string
  anthropicApiKey?: string
  defaultScope?: 'global' | 'shared' | 'project'
}

function getConfigPath(): string {
  return path.join(os.homedir(), '.skilldex', 'config.json')
}

export async function readConfig(): Promise<SkilldexConfig> {
  try {
    const raw = await readFile(getConfigPath(), 'utf8')
    return JSON.parse(raw) as SkilldexConfig
  } catch {
    return {}
  }
}

export async function writeConfig(config: SkilldexConfig): Promise<void> {
  const configPath = getConfigPath()
  await mkdir(path.dirname(configPath), { recursive: true })
  await writeFile(configPath, JSON.stringify(config, null, 2) + '\n', 'utf8')
}

/**
 * Get a config value. Environment variables always win over config file values.
 * Keys map as follows:
 *   registryUrl   → SKILLDEX_REGISTRY_URL
 *   token         → SKILLDEX_TOKEN
 *   anthropicApiKey → ANTHROPIC_API_KEY
 *   defaultScope  → SKILLDEX_DEFAULT_SCOPE
 */
export async function getConfigValue<K extends keyof SkilldexConfig>(
  key: K
): Promise<SkilldexConfig[K] | undefined> {
  const envMap: Record<keyof SkilldexConfig, string> = {
    registryUrl: 'SKILLDEX_REGISTRY_URL',
    token: 'SKILLDEX_TOKEN',
    anthropicApiKey: 'ANTHROPIC_API_KEY',
    defaultScope: 'SKILLDEX_DEFAULT_SCOPE',
  }

  const envVal = process.env[envMap[key]]
  if (envVal !== undefined) return envVal as SkilldexConfig[K]

  const config = await readConfig()
  return config[key]
}
