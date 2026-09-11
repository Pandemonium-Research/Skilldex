import chalk from 'chalk'
import type { ValidationResult, ValidationDiagnostic, CheckScore } from '../../types/skill.js'

const LABEL_WIDTH = 7

function label(severity: ValidationDiagnostic['severity']): string {
  switch (severity) {
    case 'error':
      return chalk.red('error'.padEnd(LABEL_WIDTH))
    case 'warning':
      return chalk.yellow('warn'.padEnd(LABEL_WIDTH))
    case 'pass':
      return chalk.green('pass'.padEnd(LABEL_WIDTH))
  }
}

/**
 * Each check's points, so the aggregate can be read rather than trusted.
 *
 * Full marks are dimmed and shortfalls coloured by severity, which puts the eye on whatever cost
 * points: a 94 can hide the one failure that decides whether an agent ever invokes the skill. A
 * check that never ran is shown as not evaluated rather than as a zero, which would read as failed.
 */
function renderBreakdown(breakdown: CheckScore[]): string[] {
  if (breakdown.length === 0) return []
  const width = Math.max(...breakdown.map((r) => r.check.length))
  const rows = breakdown.map((r) => {
    const name = r.check.padEnd(width)
    const possible = String(r.possible)
    if (r.status === 'skipped') {
      return `  ${chalk.dim(`${name}   —/${possible.padEnd(2)}  not evaluated`)}`
    }
    const points = `${String(r.earned).padStart(2)}/${possible}`
    if (r.earned === r.possible) return `  ${chalk.dim(`${name}  ${points}`)}`
    const colour = r.status === 'error' ? chalk.red : chalk.yellow
    return `  ${name}  ${colour(points)}`
  })
  return ['Score breakdown:', ...rows]
}

export function renderValidationReport(result: ValidationResult): string {
  const lines: string[] = []

  for (const diag of result.diagnostics) {
    const loc = diag.line !== undefined ? `line ${diag.line}: ` : ''
    lines.push(`  ${label(diag.severity)} ${loc}${diag.message}`)
  }

  lines.push('')

  const breakdown = renderBreakdown(result.breakdown)
  if (breakdown.length > 0) lines.push(...breakdown, '')

  const scoreColor =
    result.score >= 80 ? chalk.green : result.score >= 50 ? chalk.yellow : chalk.red
  lines.push(`Format conformance score: ${scoreColor(String(result.score))}/100`)
  lines.push(`Validated against: skill-format v${result.specVersion}`)

  return lines.join('\n')
}

export function printValidationReport(result: ValidationResult): void {
  console.log(renderValidationReport(result))
}

export function printJson(data: unknown): void {
  console.log(JSON.stringify(data, null, 2))
}

export function printError(message: string): void {
  console.error(chalk.red(`Error: ${message}`))
}

export function printSuccess(message: string): void {
  console.log(chalk.green(`✓ ${message}`))
}

export function printWarning(message: string): void {
  console.log(chalk.yellow(`⚠ ${message}`))
}

export function printInfo(message: string): void {
  console.log(chalk.dim(message))
}
