import { Command } from 'commander'
import type { ScopeLevel } from '../../types/scope.js'

export function registerSkillset(program: Command): void {
  const skillset = new Command('skillset').description('Manage skillsets — bundles of skills for a specific agent')

  skillset
    .command('init [name]')
    .description('Scaffold a new skillset directory with a SKILLSET.md template')
    .action(async (name?: string) => {
      const { runSkillsetInit } = await import('./skillset-init-action.js')
      await runSkillsetInit(name)
    })

  skillset
    .command('install <source>')
    .description('Install a skillset from a local path, git URL, or registry')
    .option('-s, --scope <scope>', 'Installation scope: global, shared, or project', 'project')
    .option('-f, --force', 'Overwrite if already installed', false)
    .option('--json', 'Output as JSON')
    .action(async (source: string, options: { scope: ScopeLevel; force: boolean; json: boolean }) => {
      const { runSkillsetInstall } = await import('./skillset-install-action.js')
      await runSkillsetInstall(source, options)
    })

  skillset
    .command('publish')
    .description('Publish a skillset to the Skilldex registry')
    .option('--source-url <url>', 'GitHub URL of the skillset (auto-detected from git remote if omitted)')
    .option('--tags <tags>', 'Comma-separated tags (e.g. forensics,ctf)')
    .option('--update', 'Re-fetch and re-score an already-published skillset')
    .option('--json', 'Output as JSON')
    .action(async (options: { sourceUrl?: string; tags?: string; update?: boolean; json: boolean }) => {
      const { runSkillsetPublish } = await import('./skillset-publish-action.js')
      await runSkillsetPublish(options)
    })

  skillset
    .command('list')
    .description('List installed skillsets')
    .option('-s, --scope <scope>', 'Filter by scope: global, shared, or project')
    .option('--json', 'Output as JSON')
    .action(async (options: { scope?: ScopeLevel; json: boolean }) => {
      const { runSkillsetList } = await import('./skillset-list-action.js')
      await runSkillsetList(options)
    })

  skillset
    .command('validate [path]')
    .description('Validate a skillset directory structure and score SKILLSET.md')
    .option('--json', 'Output as JSON')
    .action(async (skillsetPath: string | undefined, options: { json: boolean }) => {
      const { runSkillsetValidate } = await import('./skillset-validate-action.js')
      await runSkillsetValidate(skillsetPath ?? process.cwd(), options)
    })

  skillset
    .command('uninstall <name>')
    .description('Remove an installed skillset and its skills')
    .option('-s, --scope <scope>', 'Scope to uninstall from: global, shared, or project', 'project')
    .option('--json', 'Output as JSON')
    .action(async (name: string, options: { scope: ScopeLevel; json: boolean }) => {
      const { runSkillsetUninstall } = await import('./skillset-uninstall-action.js')
      await runSkillsetUninstall(name, options)
    })

  skillset
    .command('update [skillset-name]')
    .description('Re-fetch and reinstall an installed skillset from its source URL')
    .option('-s, --scope <scope>', 'Scope to update in: global, shared, or project', 'project')
    .option('--all', 'Update all skillsets in the specified scope')
    .option('--json', 'Output as JSON')
    .action(async (skillsetName: string | undefined, options: { scope: ScopeLevel; all: boolean; json: boolean }) => {
      const { runSkillsetUpdate } = await import('./skillset-update-action.js')
      await runSkillsetUpdate(skillsetName, options)
    })

  program.addCommand(skillset)
}
