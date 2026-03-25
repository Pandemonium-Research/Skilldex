import type { Command } from 'commander'

export function registerPublish(program: Command): void {
  program
    .command('publish')
    .description('Publish a skill to the Skilldex registry (coming soon)')
    .action(() => {
      console.error('publish is not yet implemented.')
      process.exit(1)
    })
}
