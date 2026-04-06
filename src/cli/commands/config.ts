import type { Command } from 'commander'
import chalk from 'chalk'
import { readConfig, writeConfig } from '../../core/config.js'
import { printJson, printError, printSuccess } from '../ui/output.js'
import type { SkilldexConfig } from '../../core/config.js'
import os from 'node:os'
import path from 'node:path'

const CONFIG_PATH = () => path.join(os.homedir(), '.skilldex', 'config.json')

const VALID_KEYS: Array<keyof SkilldexConfig> = [
  'registryUrl',
  'token',
  'anthropicApiKey',
  'defaultScope',
]

const KEY_DESCRIPTIONS: Record<keyof SkilldexConfig, string> = {
  registryUrl: 'Registry API base URL (overrides SKILLDEX_REGISTRY_URL)',
  token: 'Publisher auth token (overrides SKILLDEX_TOKEN)',
  anthropicApiKey: 'Anthropic API key for suggest command (overrides ANTHROPIC_API_KEY)',
  defaultScope: 'Default install scope: global, shared, or project (overrides SKILLDEX_DEFAULT_SCOPE)',
}

export function registerConfig(program: Command): void {
  const cmd = program
    .command('config')
    .description('View and set Skilldex configuration')

  cmd
    .command('get [key]')
    .description('Get a config value (or all values if no key given)')
    .option('--json', 'Output as JSON')
    .action(async (key: string | undefined, options: { json: boolean }) => {
      const config = await readConfig()

      if (!key) {
        if (options.json) {
          printJson(config)
        } else {
          console.log(chalk.dim(`Config file: ${CONFIG_PATH()}\n`))
          if (Object.keys(config).length === 0) {
            console.log(chalk.dim('No configuration set. Use `skillpm config set <key> <value>` to configure.'))
          } else {
            for (const k of VALID_KEYS) {
              const val = config[k]
              if (val !== undefined) {
                const masked = k === 'token' || k === 'anthropicApiKey'
                  ? val.slice(0, 6) + '…'
                  : val
                console.log(`  ${chalk.cyan(k.padEnd(20))} ${masked}`)
              }
            }
          }
        }
        return
      }

      if (!VALID_KEYS.includes(key as keyof SkilldexConfig)) {
        printError(`Unknown config key "${key}". Valid keys: ${VALID_KEYS.join(', ')}`)
        process.exit(1)
      }

      const val = config[key as keyof SkilldexConfig]
      if (val === undefined) {
        console.log(chalk.dim(`(not set)`))
      } else if (options.json) {
        printJson({ [key]: val })
      } else {
        console.log(val)
      }
    })

  cmd
    .command('set <key> <value>')
    .description('Set a config value')
    .action(async (key: string, value: string) => {
      if (!VALID_KEYS.includes(key as keyof SkilldexConfig)) {
        printError(`Unknown config key "${key}". Valid keys: ${VALID_KEYS.join(', ')}`)
        console.log('')
        for (const k of VALID_KEYS) {
          console.log(`  ${chalk.cyan(k.padEnd(20))} ${chalk.dim(KEY_DESCRIPTIONS[k])}`)
        }
        process.exit(1)
      }

      if (key === 'defaultScope' && !['global', 'shared', 'project'].includes(value)) {
        printError('defaultScope must be one of: global, shared, project')
        process.exit(1)
      }

      const config = await readConfig()
      ;(config as Record<string, string>)[key] = value
      await writeConfig(config)
      printSuccess(`Set ${key} in ${CONFIG_PATH()}`)
    })

  cmd
    .command('unset <key>')
    .description('Remove a config value')
    .action(async (key: string) => {
      if (!VALID_KEYS.includes(key as keyof SkilldexConfig)) {
        printError(`Unknown config key "${key}". Valid keys: ${VALID_KEYS.join(', ')}`)
        process.exit(1)
      }

      const config = await readConfig()
      delete (config as Record<string, unknown>)[key]
      await writeConfig(config)
      printSuccess(`Unset ${key}`)
    })

  cmd
    .command('list')
    .description('List all valid config keys and their descriptions')
    .action(() => {
      console.log(chalk.bold('\nConfig keys:'))
      for (const k of VALID_KEYS) {
        console.log(`  ${chalk.cyan(k.padEnd(20))} ${chalk.dim(KEY_DESCRIPTIONS[k])}`)
      }
      console.log('')
      console.log(chalk.dim('Environment variables always override config file values.'))
      console.log(chalk.dim(`Config file: ${CONFIG_PATH()}`))
      console.log('')
    })
}
