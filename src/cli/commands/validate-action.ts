import { validateSkill } from '../../core/validator.js'
import { printValidationReport, printJson, printError } from '../ui/output.js'

export async function runValidate(
  skillPath: string,
  options: { json: boolean }
): Promise<void> {
  try {
    const result = await validateSkill(skillPath)
    if (options.json) {
      printJson(result)
    } else {
      printValidationReport(result)
    }
    // Exit with non-zero if there are errors
    if (result.errorCount > 0) {
      process.exit(1)
    }
  } catch (e) {
    printError(e instanceof Error ? e.message : String(e))
    process.exit(1)
  }
}
