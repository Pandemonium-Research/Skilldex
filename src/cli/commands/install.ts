import type { Command } from 'commander'
import type { ScopeLevel } from '../../types/scope.js'

export function registerInstall(program: Command): void {
  program
    .command('install <source>')
    .description('Install a skill from a local path, git URL, or registry')
    .option('-s, --scope <scope>', 'Installation scope: global, shared, or project', 'project')
    .option('-f, --force', 'Overwrite if already installed', false)
    .option('--json', 'Output as JSON')
    .action(async (source: string, options: { scope: ScopeLevel; force: boolean; json: boolean }) => {
      const { runInstall } = await import('./install-action.js')
      await runInstall(source, options)
    })
}
