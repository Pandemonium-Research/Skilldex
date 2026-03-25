import chalk from 'chalk'
import type { ValidationResult, ValidationDiagnostic } from '../../types/skill.js'

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

export function renderValidationReport(result: ValidationResult): string {
  const lines: string[] = []

  for (const diag of result.diagnostics) {
    const loc = diag.line !== undefined ? `line ${diag.line}: ` : ''
    lines.push(`  ${label(diag.severity)} ${loc}${diag.message}`)
  }

  lines.push('')

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
