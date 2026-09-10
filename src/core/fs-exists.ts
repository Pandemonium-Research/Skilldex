import { stat } from 'node:fs/promises'

/**
 * Existence as a value, rather than as control flow.
 *
 * The obvious shape — `try { await stat(p); bail() } catch { proceed }` — puts the bail inside a
 * try whose catch means "not there". `process.exit` throws before it terminates, so the bail is
 * caught by the handler for the opposite case and execution continues, straight into the write
 * the check was protecting against. It only looks safe because exit normally ends the process
 * first; anything that stops the process from dying turns the guard into its opposite.
 *
 * That defect was fixed in `skillpm init` and left standing in `skillpm skillset init`, where it
 * was demonstrated to overwrite a hand-written SKILLSET.md with the template. One copy of the
 * rule is the point — the same reasoning as `source-kind.ts`, and the same failure mode: a fix
 * applied to one spelling of a rule leaves the others broken.
 *
 * Returning a boolean also makes the two cases testable independently of `process.exit`, which
 * the try/catch shape does not.
 */
export async function exists(target: string): Promise<boolean> {
  try {
    await stat(target)
    return true
  } catch {
    return false
  }
}
