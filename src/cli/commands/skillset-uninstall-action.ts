import ora from 'ora'
import type { ScopeLevel } from '../../types/scope.js'
import { uninstallSkillset } from '../../core/skillset-installer.js'
import { printJson, printError, printSuccess } from '../ui/output.js'

export async function runSkillsetUninstall(
  name: string,
  options: { scope: ScopeLevel; json: boolean }
): Promise<void> {
  const spinner = options.json ? null : ora(`Uninstalling skillset "${name}"...`).start()

  try {
    await uninstallSkillset(name, options.scope)

    if (spinner) spinner.succeed(`Uninstalled skillset "${name}" from ${options.scope} scope`)

    if (options.json) {
      printJson({ uninstalled: true, skillsetName: name, scope: options.scope })
    } else {
      printSuccess(`Skillset "${name}" and its skills removed from ${options.scope} scope`)
    }
  } catch (e) {
    if (spinner) spinner.fail()
    printError(e instanceof Error ? e.message : String(e))
    process.exit(1)
  }
}
