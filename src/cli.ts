#!/usr/bin/env node
import { resolve } from 'node:path'
import { BenchmarkRunner } from './runner/index.js'

function usage(): string {
  return 'Usage: dsh-benchup run <experiment.yml> [--output <directory>] [--dsh <command> | --dsh-source <Harness directory>] [--keep-workspaces]'
}

/** CLI entry point for the standalone benchmark runner. */
async function main(argv: string[]): Promise<void> {
  if (argv.length === 0 || argv[0] === '--help' || argv[0] === '-h') {
    process.stdout.write(`${usage()}\n`)
    return
  }
  if (argv[0] !== 'run' || argv[1] === undefined) throw new Error(usage())
  let outputDir: string | undefined
  let dshCommand: string | undefined
  let dshSourceRoot: string | undefined
  let keepWorkspaces = false
  for (let index = 2; index < argv.length; index += 1) {
    const option = argv[index]
    if (option === '--output') { outputDir = optionValue(argv, ++index, option); continue }
    if (option === '--dsh') { dshCommand = optionValue(argv, ++index, option); continue }
    if (option === '--dsh-source') { dshSourceRoot = optionValue(argv, ++index, option); continue }
    if (option === '--keep-workspaces') { keepWorkspaces = true; continue }
    throw new Error(`Unknown option: ${option}\n${usage()}`)
  }
  if (dshCommand !== undefined && dshSourceRoot !== undefined) throw new Error('--dsh and --dsh-source are mutually exclusive')
  const report = await new BenchmarkRunner({ outputDir, dshCommand, dshSourceRoot, keepWorkspaces }).run(resolve(argv[1]))
  const root = resolve(outputDir ?? '.dsh-benchup', 'runs', report.runId)
  process.stdout.write(`DSH BenchUp finished: ${root}\n`)
  process.stdout.write(`Passed cells: ${report.results.filter((result) => result.passed).length}/${report.results.length}\n`)
  if (report.results.some((result) => !result.passed)) process.exitCode = 1
}

/** Reads a required value immediately following a CLI option. */
function optionValue(argv: string[], index: number, option: string): string {
  const value = argv[index]
  if (value === undefined || value.startsWith('--')) throw new Error(`${option} needs a value\n${usage()}`)
  return value
}

main(process.argv.slice(2)).catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : String(error)}\n`)
  process.exitCode = 2
})
