import { Command } from 'commander'
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

export function createCli(): Command {
  const program = new Command()

  program
    .name('skillpm')
    .description('Package manager for Claude skill packages')
    .version('0.1.0')
    .option('--no-color', 'Disable colored output')

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
