import type { Command } from 'commander'
import type { ScopeLevel } from '../../types/scope.js'

export function registerList(program: Command): void {
  program
    .command('list')
    .description('List installed skills')
    .option('-s, --scope <scope>', 'Filter by scope: global, shared, or project')
    .option('--json', 'Output as JSON')
    .action(async (options: { scope?: ScopeLevel; json: boolean }) => {
      const { runList } = await import('./list-action.js')
      await runList(options)
    })
}
