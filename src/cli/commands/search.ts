import type { Command } from 'commander'

export function registerSearch(program: Command): void {
  program
    .command('search <query>')
    .description('Search the Skilldex registry for skills')
    .option('--tier <tier>', 'Filter by trust tier: verified or community')
    // No default. The registry resolves an absent sort to relevance when there is a query, and a
    // default here is not "the default" — it is an override, because resolveSort returns any
    // explicit value unchanged and so never reaches its relevance branch.
    //
    // It used to default to 'installs', which opted every CLI search out of BM25 ranking. That was
    // not merely a different order: the highest install_count in the 1.6M-row corpus is 4, so the
    // sort key is constant across effectively every row and the `seq` tiebreaker decided the
    // results — i.e. seed insertion order. Searching "commit" returned security-scan and
    // supabase-policy-guardrails ahead of git-commit, and shared no result with the website's
    // first page for the same query.
    .option('--sort <sort>', 'Sort by: relevance, installs, score, recent, name')
    .option('--limit <n>', 'Number of results (max 50)', '10')
    .option('--json', 'Output as JSON')
    .action(async (query: string, options: { tier?: string; sort?: string; limit: string; json: boolean }) => {
      const { runSearch } = await import('./search-action.js')
      await runSearch(query, options)
    })
}
