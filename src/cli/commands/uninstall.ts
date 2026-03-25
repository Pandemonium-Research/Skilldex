import type { Command } from 'commander'
import type { ScopeLevel } from '../../types/scope.js'

export function registerUninstall(program: Command): void {
  program
    .command('uninstall <skill-name>')
    .description('Uninstall a skill from a scope')
    .option('-s, --scope <scope>', 'Scope to remove from: global, shared, or project', 'project')
    .option('--json', 'Output as JSON')
    .action(async (skillName: string, options: { scope: ScopeLevel; json: boolean }) => {
      const { runUninstall } = await import('./uninstall-action.js')
      await runUninstall(skillName, options)
    })
}
