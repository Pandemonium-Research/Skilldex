import type { Command } from 'commander'

export function registerValidate(program: Command): void {
  program
    .command('validate [path]')
    .description('Validate a skill folder and show its format conformance score')
    .option('--json', 'Output as JSON')
    .action(async (skillPath: string | undefined, options: { json: boolean }) => {
      const { runValidate } = await import('./validate-action.js')
      await runValidate(skillPath ?? process.cwd(), options)
    })
}
