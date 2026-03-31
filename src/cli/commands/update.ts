import type { Command } from 'commander'
import type { ScopeLevel } from '../../types/scope.js'

export function registerUpdate(program: Command): void {
  program
    .command('update [skill-name]')
    .description('Re-fetch and reinstall an installed skill from its source URL')
    .option('--scope <scope>', 'Scope to update in: global, shared, or project', 'project')
    .option('--all', 'Update all skills in the specified scope')
    .option('--json', 'Output as JSON')
    .action(
      async (
        skillName: string | undefined,
        options: { scope: ScopeLevel; all: boolean; json: boolean }
      ) => {
        const { runUpdate } = await import('./update-action.js')
        await runUpdate(skillName, options)
      }
    )
}
