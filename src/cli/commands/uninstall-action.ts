import ora from 'ora'
import type { ScopeLevel } from '../../types/scope.js'
import { uninstallSkill } from '../../core/installer.js'
import { printJson, printError, printSuccess } from '../ui/output.js'

export async function runUninstall(
  skillName: string,
  options: { scope: ScopeLevel; json: boolean }
): Promise<void> {
  const spinner = options.json ? null : ora(`Uninstalling "${skillName}"...`).start()

  try {
    await uninstallSkill(skillName, options.scope)

    if (spinner) spinner.succeed(`Uninstalled "${skillName}" from ${options.scope} scope`)

    if (options.json) {
      printJson({ removed: true, skillName, scope: options.scope })
    }
  } catch (e) {
    if (spinner) spinner.fail()
    printError(e instanceof Error ? e.message : String(e))
    process.exit(1)
  }
}
