import type { Command } from 'commander'

export function registerSuggest(program: Command): void {
  program
    .command('suggest')
    .description('AI-powered skill suggestion loop for your project')
    .option('-p, --project-path <path>', 'Path to project (defaults to cwd)')
    .option('-y, --yes', 'Auto-approve all suggestions without prompting', false)
    .option('--json', 'Output as JSON')
    .action(async (options: { projectPath?: string; yes: boolean; json: boolean }) => {
      const { runSuggest } = await import('./suggest-action.js')
      await runSuggest(options)
    })
}
