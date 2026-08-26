import { existsSync, readFileSync } from 'node:fs'
import { resolve, sep } from 'node:path'
import { spawn } from 'node:child_process'
import { Ajv } from 'ajv'
import type { EvaluatorGroup, EvaluatorSpec } from '../schema/index.js'

export interface CommandResult {
  exitCode: number | null
  timedOut: boolean
  stdout: string
  stderr: string
  durationMs: number
}

export interface EvaluationContext {
  workspace: string
  finalText: string
}

export interface EvaluationResult {
  type: EvaluatorSpec['type']
  passed: boolean
  message: string
  details?: unknown
}

export interface EvaluationSummary {
  passed: boolean
  mode: 'all' | 'any'
  results: EvaluationResult[]
}

/** Executes a command without a shell, preserving argv exactly for reproducible evaluation. */
export async function runCommand(argv: string[], cwd: string, timeoutMs = 300_000, environment?: NodeJS.ProcessEnv): Promise<CommandResult> {
  if (argv.length === 0) throw new Error('Command evaluator must have at least one argv element')
  const started = performance.now()
  return new Promise((resolveResult) => {
    const child = spawn(argv[0]!, argv.slice(1), { cwd, shell: false, windowsHide: true, env: environment })
    let stdout = ''
    let stderr = ''
    let timedOut = false
    let spawnError: Error | undefined
    const timer = setTimeout(() => {
      timedOut = true
      child.kill()
    }, timeoutMs)
    child.stdout.setEncoding('utf8')
    child.stderr.setEncoding('utf8')
    child.stdout.on('data', (chunk: string) => { stdout += chunk })
    child.stderr.on('data', (chunk: string) => { stderr += chunk })
    child.on('error', (error) => { spawnError = error })
    child.on('close', (exitCode) => {
      clearTimeout(timer)
      if (spawnError !== undefined) stderr += `${stderr.length === 0 ? '' : '\n'}${spawnError.message}`
      resolveResult({ exitCode, timedOut, stdout, stderr, durationMs: performance.now() - started })
    })
  })
}

/** Runs the objective evaluator group and deliberately returns its independent checks. */
export async function evaluate(group: EvaluatorGroup, context: EvaluationContext): Promise<EvaluationSummary> {
  const results = await Promise.all(group.checks.map((check) => evaluateOne(check, context)))
  const passed = results.length === 0 || (group.mode === 'all' ? results.every((result) => result.passed) : results.some((result) => result.passed))
  return { passed, mode: group.mode, results }
}

async function evaluateOne(spec: EvaluatorSpec, context: EvaluationContext): Promise<EvaluationResult> {
  if (spec.type === 'exact') {
    const expected = readFileSync(resolveWithin(context.workspace, spec.expected), 'utf8')
    const passed = context.finalText === expected
    return { type: spec.type, passed, message: passed ? 'Exact output matched.' : 'Exact output did not match.', details: passed ? undefined : { expected, actual: context.finalText } }
  }
  if (spec.type === 'command') {
    const result = await runCommand(spec.command, context.workspace, spec.timeoutMs)
    const passed = result.exitCode === 0 && !result.timedOut
    return { type: spec.type, passed, message: passed ? 'Command passed.' : 'Command failed.', details: result }
  }
  if (spec.type === 'file') {
    const present = existsSync(resolveWithin(context.workspace, spec.path))
    const expected = spec.exists ?? true
    return { type: spec.type, passed: present === expected, message: present === expected ? 'File presence matched.' : 'File presence did not match.', details: { path: spec.path, expected, actual: present } }
  }
  const path = resolveWithin(context.workspace, spec.path)
  try {
    const instance = JSON.parse(readFileSync(path, 'utf8')) as unknown
    const ajv = new Ajv({ allErrors: true, strict: false })
    const validate = ajv.compile(spec.schema)
    const passed = Boolean(validate(instance))
    return { type: spec.type, passed, message: passed ? 'JSON schema matched.' : ajv.errorsText(validate.errors), details: passed ? undefined : { errors: validate.errors } }
  } catch (error) {
    return { type: spec.type, passed: false, message: error instanceof Error ? error.message : String(error) }
  }
}

function resolveWithin(root: string, relative: string): string {
  const target = resolve(root, relative)
  const rootWithSep = root.endsWith(sep) ? root : `${root}${sep}`
  if (target !== root && !target.startsWith(rootWithSep)) throw new Error(`Evaluator path escapes workspace: ${relative}`)
  return target
}
