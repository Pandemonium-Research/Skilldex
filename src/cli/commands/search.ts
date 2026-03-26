import type { Command } from 'commander'

export function registerSearch(program: Command): void {
  program
    .command('search <query>')
    .description('Search the Skilldex registry for skills')
    .option('--tier <tier>', 'Filter by trust tier: verified or community')
    .option('--sort <sort>', 'Sort by: installs, score, recent, name', 'installs')
    .option('--limit <n>', 'Number of results (max 50)', '10')
    .option('--json', 'Output as JSON')
    .action(async (query: string, options: { tier?: string; sort: string; limit: string; json: boolean }) => {
      const { runSearch } = await import('./search-action.js')
      await runSearch(query, options)
    })
}
