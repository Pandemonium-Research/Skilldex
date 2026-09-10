import type { Command } from 'commander'

export function registerInit(program: Command): void {
  program
    .command('init [name]')
    .description('Scaffold a new skill directory with a SKILL.md template')
    .action(async (name?: string) => {
      const { runInit } = await import('./init-action.js')
      await runInit(name)
    })
}
