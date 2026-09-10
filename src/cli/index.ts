import { Command } from 'commander'
import { registerInit } from './commands/init.js'
import { registerInstall } from './commands/install.js'
import { registerUninstall } from './commands/uninstall.js'
import { registerList } from './commands/list.js'
import { registerValidate } from './commands/validate.js'
import { registerSuggest } from './commands/suggest.js'
import { registerPublish } from './commands/publish.js'
import { registerSearch } from './commands/search.js'
import { registerSkillset } from './commands/skillset.js'
import { registerUpdate } from './commands/update.js'
import { registerConfig } from './commands/config.js'
import { readBuildInfo, checkoutHead, stalenessWarning } from '../core/build-info.js'

// The version this build was built at, not the version package.json says now — see
// core/build-info.ts.
const build = readBuildInfo()

export function createCli(): Command {
  const program = new Command()

  // Registered before `.version()` so it runs ahead of commander's own handler, which prints the
  // version and exits. Written to stderr, so anything parsing `--version` from stdout is unaffected.
  program.on('option:version', () => {
    const warning = stalenessWarning(build, checkoutHead())
    if (warning) process.stderr.write(`${warning}\n`)
  })

  program
    .name('skillpm')
    .description('Package manager for Claude skill packages')
    .version(build.version)
    .option('--no-color', 'Disable colored output')

  registerInit(program)
  registerInstall(program)
  registerUninstall(program)
  registerUpdate(program)
  registerList(program)
  registerValidate(program)
  registerSuggest(program)
  registerPublish(program)
  registerSearch(program)
  registerSkillset(program)
  registerConfig(program)

  // Hidden MCP server command
  program
    .command('mcp', { hidden: true })
    .description('Start the MCP server')
    .action(async () => {
      const { startMcpServer } = await import('../mcp/server.js')
      await startMcpServer()
    })

  return program
}
