import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, dirname, join, relative, resolve } from 'node:path'
import { parseDocument, stringify } from 'yaml'
import { ArtifactWriter } from '../artifacts/index.js'
import { evaluate, runCommand, type CommandResult, type EvaluationSummary } from '../evaluators/index.js'
import type { CoreMetrics } from '../observer/index.js'
import type { MetricDefinition } from '../metrics/index.js'
import { parseExperiment, type EpisodeSpec, type ExperimentSpec, type ModelSpec, type ScenarioSpec, type VariantSpec } from '../schema/index.js'

export interface ChildRunRequest {
  profile: string
  model: ModelSpec
  task: string
  cwd: string
  stateRoot: string
  artifactDir: string
  runId: string
  episodeId: string
  timeoutMs: number
}

export type ChildExecutor = (request: ChildRunRequest) => Promise<CommandResult>

export interface BenchmarkRunnerOptions {
  outputDir?: string
  dshCommand?: string
  dshArgs?: string[]
  timeoutMs?: number
  keepWorkspaces?: boolean
  executeChild?: ChildExecutor
}

export interface EpisodeRunResult {
  id: string
  state: EpisodeSpec['state']
  command: CommandResult
  coreMetrics: CoreMetrics
  customMetrics: Record<string, number>
  metricDefinitions: MetricDefinition[]
}

export interface BenchmarkRunResult {
  id: string
  repetition: number
  model: string
  variant: string
  scenario: string
  passed: boolean
  durationMs: number
  evaluation: EvaluationSummary
  episodes: EpisodeRunResult[]
  coreMetrics: CoreMetrics
  customMetrics: Record<string, number>
  metricDefinitions: MetricDefinition[]
}

export interface BenchmarkReport {
  version: 1
  runId: string
  generatedAt: string
  results: BenchmarkRunResult[]
  comparison: ComparisonReport
}

export interface ComparisonReport {
  baseline: string | null
  groups: Array<{
    model: string
    scenario: string
    variant: string
    runs: number
    quality: { passRate: number; deltaPassRate?: number }
    efficiency: Record<string, { average: number; delta?: number }>
    robustness: Record<string, { average: number; delta?: number }>
    diagnostics: Record<string, { average: number; delta?: number }>
  }>
}

const ZERO_CORE: CoreMetrics = {
  inputTokens: 0, outputTokens: 0, cachedInputTokens: 0, llmTurns: 0, toolCalls: 0,
  repeatedFileReads: 0, repeatedSearches: 0, repeatedCommands: 0, duplicateToolCalls: 0,
  retries: 0, errors: 0, subagents: 0,
}

/** Loads and validates an experiment YAML document without executing it. */
export function loadExperimentFile(path: string): ExperimentSpec {
  const document = parseDocument(readFileSync(path, 'utf8'), { prettyErrors: true, strict: true })
  if (document.errors.length > 0) throw new Error(`Invalid YAML in ${path}: ${document.errors.map((error) => error.message).join('; ')}`)
  return parseExperiment(document.toJS({ maxAliasCount: 100 }))
}

/**
 * Executes an experiment as isolated short-lived Harness processes. Results preserve independent
 * quality, efficiency, robustness, and diagnostic measurements; no aggregate score is calculated.
 */
export class BenchmarkRunner {
  private readonly outputDir: string
  private readonly timeoutMs: number
  private readonly keepWorkspaces: boolean
  private readonly executeChild: ChildExecutor

  constructor(private readonly options: BenchmarkRunnerOptions = {}) {
    this.outputDir = resolve(options.outputDir ?? '.dsh-benchup')
    this.timeoutMs = options.timeoutMs ?? 300_000
    this.keepWorkspaces = options.keepWorkspaces ?? false
    this.executeChild = options.executeChild ?? this.executeDshChild.bind(this)
  }

  /** Runs all model × variant × scenario × repetition cells and writes durable artifacts. */
  async run(experimentPath: string): Promise<BenchmarkReport> {
    const experiment = loadExperimentFile(experimentPath)
    const runId = makeRunId()
    const root = join(this.outputDir, 'runs', runId)
    const writer = new ArtifactWriter(root)
    const sourceRoot = dirname(resolve(experimentPath))
    const scratch = mkdtempSync(join(tmpdir(), 'dsh-benchup-'))
    try {
      const cells = scheduleCells(experiment)
      const results: BenchmarkRunResult[] = []
      for (const cell of cells) results.push(await this.runCell(cell, sourceRoot, root, scratch))
      const comparison = compare(results)
      const report: BenchmarkReport = { version: 1, runId, generatedAt: new Date().toISOString(), results, comparison }
      writer.writeJson('experiment.json', experiment)
      writer.writeJson('runs.json', results)
      writer.writeJson('comparison.json', comparison)
      writer.writeJson('report.json', report)
      writeFileSync(join(root, 'report.md'), markdownReport(report), 'utf8')
      return report
    } finally {
      if (!this.keepWorkspaces) rmSync(scratch, { recursive: true, force: true })
    }
  }

  private async runCell(cell: ScheduledCell, sourceRoot: string, root: string, scratch: string): Promise<BenchmarkRunResult> {
    const id = `${cell.modelName}-${cell.variantName}-${cell.scenario.id}-r${cell.repetition}`.replace(/[^a-zA-Z0-9_.-]/g, '_')
    const cellRoot = join(scratch, id)
    const workspace = join(cellRoot, 'workspace')
    const persistent = join(cellRoot, 'persistent')
    const runRoot = join(root, 'cells', id)
    const episodes: EpisodeRunResult[] = []
    const started = performance.now()
    for (const episode of cell.scenario.episodes) {
      if (episode.state.session === 'continue' || episode.state.process === 'reuse') {
        throw new Error(`Scenario ${cell.scenario.id} episode ${episode.id} requests ${episode.state.session}/${episode.state.process}; BenchUp MVP only supports fresh short-lived agent sessions. Use process: restart and session: fresh until a persistent driver is added.`)
      }
      prepareEpisode(workspace, persistent, resolveFixture(cell.scenario.fixture, sourceRoot), episode)
      const taskPath = resolveWithin(sourceRoot, episode.task)
      const task = readFileSync(taskPath, 'utf8')
      const artifactDir = join(runRoot, 'episodes', safeName(episode.id))
      mkdirSync(artifactDir, { recursive: true })
      const command = await this.executeChild({
        profile: cell.variant.profile,
        model: cell.model,
        task,
        cwd: workspace,
        stateRoot: persistent,
        artifactDir,
        runId: id,
        episodeId: episode.id,
        timeoutMs: this.timeoutMs,
      })
      const summary = readObserverSummary(artifactDir)
      episodes.push({ id: episode.id, state: episode.state, command, ...summary })
    }
    const last = episodes.at(-1)
    const evaluation = await evaluate(cell.scenario.evaluators, { workspace, finalText: last?.command.stdout ?? '' })
    const childrenPassed = episodes.every((episode) => episode.command.exitCode === 0 && !episode.command.timedOut)
    const coreMetrics = sumCore(episodes.map((episode) => episode.coreMetrics))
    const custom = combineCustom(episodes)
    return {
      id, repetition: cell.repetition, model: cell.modelName, variant: cell.variantName, scenario: cell.scenario.id,
      passed: childrenPassed && evaluation.passed,
      durationMs: performance.now() - started,
      evaluation,
      episodes,
      coreMetrics,
      customMetrics: custom.values,
      metricDefinitions: custom.definitions,
    }
  }

  private async executeDshChild(request: ChildRunRequest): Promise<CommandResult> {
    const patchPath = join(request.artifactDir, 'benchup.patch.yml')
    const patch = [{ insert: [{
      id: 'dsh-benchup',
      name: 'dsh-benchup',
      config: {
        outputDir: request.artifactDir,
        runId: request.runId,
        episodeId: request.episodeId,
        model: request.model,
      },
    }] }]
    writeFileSync(patchPath, stringify(patch), 'utf8')
    const command = this.options.dshCommand ?? 'dsh'
    const args = [...(this.options.dshArgs ?? []), '--profile', request.profile, '--patch', patchPath, request.task]
    return runCommand([command, ...args], request.cwd, request.timeoutMs, {
      ...process.env,
      DSH_BENCHUP_STATE_ROOT: request.stateRoot,
      DSH_BENCHUP_OUTPUT_DIR: request.artifactDir,
      DSH_BENCHUP_RUN_ID: request.runId,
      DSH_BENCHUP_EPISODE_ID: request.episodeId,
    })
  }
}

interface ScheduledCell {
  repetition: number
  modelName: string
  model: ModelSpec
  variantName: string
  variant: VariantSpec
  scenario: ScenarioSpec
}

function scheduleCells(experiment: ExperimentSpec): ScheduledCell[] {
  const cells: ScheduledCell[] = []
  for (let repetition = 1; repetition <= experiment.repetitions; repetition += 1) {
    for (const [variantName, variant] of Object.entries(experiment.variants)) {
      const models = variant.model === undefined ? Object.entries(experiment.models) : [[variant.model, experiment.models[variant.model]!]] as const
      for (const [modelName, model] of models) for (const scenario of experiment.scenarios) cells.push({ repetition, modelName, model, variantName, variant, scenario })
    }
  }
  if (experiment.schedule === 'paired-shuffled') cells.sort((left, right) => stableHash(`${left.repetition}/${left.modelName}/${left.scenario.id}/${left.variantName}`) - stableHash(`${right.repetition}/${right.modelName}/${right.scenario.id}/${right.variantName}`))
  return cells
}

function prepareEpisode(workspace: string, persistent: string, fixture: string | undefined, episode: EpisodeSpec): void {
  if (episode.state.workspace === 'reset') {
    rmSync(workspace, { recursive: true, force: true })
    mkdirSync(workspace, { recursive: true })
    if (fixture !== undefined) cpSync(fixture, workspace, { recursive: true })
  } else mkdirSync(workspace, { recursive: true })
  if (episode.state.persistent === 'reset') rmSync(persistent, { recursive: true, force: true })
  mkdirSync(persistent, { recursive: true })
}

function resolveFixture(fixture: string | undefined, sourceRoot: string): string | undefined {
  if (fixture === undefined) return undefined
  const resolved = resolveWithin(sourceRoot, fixture)
  if (!existsSync(resolved)) throw new Error(`Fixture does not exist: ${fixture}`)
  return resolved
}

function readObserverSummary(artifactDir: string): Pick<EpisodeRunResult, 'coreMetrics' | 'customMetrics' | 'metricDefinitions'> {
  const path = join(artifactDir, 'summary.json')
  if (!existsSync(path)) return { coreMetrics: { ...ZERO_CORE }, customMetrics: {}, metricDefinitions: [] }
  const value = JSON.parse(readFileSync(path, 'utf8')) as { coreMetrics?: CoreMetrics, customMetrics?: { values?: Record<string, number>, definitions?: MetricDefinition[] } }
  return {
    coreMetrics: { ...ZERO_CORE, ...value.coreMetrics },
    customMetrics: value.customMetrics?.values ?? {},
    metricDefinitions: value.customMetrics?.definitions ?? [],
  }
}

function sumCore(metrics: CoreMetrics[]): CoreMetrics {
  const result = { ...ZERO_CORE }
  for (const metric of metrics) for (const key of Object.keys(result) as Array<keyof CoreMetrics>) result[key] += metric[key]
  return result
}

function combineCustom(episodes: EpisodeRunResult[]): { values: Record<string, number>; definitions: MetricDefinition[] } {
  const definitions = new Map<string, MetricDefinition>()
  const values = new Map<string, number>()
  for (const episode of episodes) {
    for (const definition of episode.metricDefinitions) definitions.set(definition.name, definition)
    for (const [name, value] of Object.entries(episode.customMetrics)) {
      const aggregation = definitions.get(name)?.aggregation ?? 'sum'
      const old = values.get(name)
      values.set(name, aggregation === 'max' ? Math.max(old ?? Number.NEGATIVE_INFINITY, value) : aggregation === 'last' ? value : (old ?? 0) + value)
    }
  }
  return { values: Object.fromEntries(values), definitions: [...definitions.values()].sort((left, right) => left.name.localeCompare(right.name)) }
}

function compare(results: BenchmarkRunResult[]): ComparisonReport {
  const baseline = results.some((result) => result.variant === 'baseline') ? 'baseline' : null
  const grouped = new Map<string, BenchmarkRunResult[]>()
  for (const result of results) {
    const key = `${result.model}\u0000${result.scenario}\u0000${result.variant}`
    const group = grouped.get(key) ?? []
    group.push(result)
    grouped.set(key, group)
  }
  const averages = new Map<string, FlattenedAverages>()
  for (const [key, group] of grouped) averages.set(key, summarize(group))
  const groups = [...grouped.entries()].map(([key, group]) => {
    const [model, scenario, variant] = key.split('\u0000') as [string, string, string]
    const summary = averages.get(key)!
    const base = baseline === null ? undefined : averages.get(`${model}\u0000${scenario}\u0000${baseline}`)
    return {
      model, scenario, variant, runs: group.length,
      quality: { passRate: summary.passRate, deltaPassRate: base === undefined ? undefined : summary.passRate - base.passRate },
      efficiency: deltaMetrics(summary.efficiency, base?.efficiency),
      robustness: deltaMetrics(summary.robustness, base?.robustness),
      diagnostics: deltaMetrics(summary.diagnostics, base?.diagnostics),
    }
  }).sort((left, right) => `${left.model}/${left.scenario}/${left.variant}`.localeCompare(`${right.model}/${right.scenario}/${right.variant}`))
  return { baseline, groups }
}

interface FlattenedAverages { passRate: number; efficiency: Record<string, number>; robustness: Record<string, number>; diagnostics: Record<string, number> }

function summarize(results: BenchmarkRunResult[]): FlattenedAverages {
  const average = (values: number[]) => values.reduce((sum, value) => sum + value, 0) / values.length
  const efficiency: Record<string, number> = {
    inputTokens: average(results.map((result) => result.coreMetrics.inputTokens)), outputTokens: average(results.map((result) => result.coreMetrics.outputTokens)),
    cachedInputTokens: average(results.map((result) => result.coreMetrics.cachedInputTokens)), llmTurns: average(results.map((result) => result.coreMetrics.llmTurns)),
    toolCalls: average(results.map((result) => result.coreMetrics.toolCalls)), wallTimeMs: average(results.map((result) => result.durationMs)),
  }
  const robustness: Record<string, number> = {
    retries: average(results.map((result) => result.coreMetrics.retries)), errors: average(results.map((result) => result.coreMetrics.errors)),
    timeouts: average(results.map((result) => Number(result.episodes.some((episode) => episode.command.timedOut)))), subagents: average(results.map((result) => result.coreMetrics.subagents)),
  }
  const diagnostics: Record<string, number> = {
    repeatedFileReads: average(results.map((result) => result.coreMetrics.repeatedFileReads)), repeatedSearches: average(results.map((result) => result.coreMetrics.repeatedSearches)),
    repeatedCommands: average(results.map((result) => result.coreMetrics.repeatedCommands)), duplicateToolCalls: average(results.map((result) => result.coreMetrics.duplicateToolCalls)),
  }
  for (const name of new Set(results.flatMap((result) => Object.keys(result.customMetrics)))) diagnostics[name] = average(results.map((result) => result.customMetrics[name] ?? 0))
  return { passRate: average(results.map((result) => Number(result.passed))), efficiency, robustness, diagnostics }
}

function deltaMetrics(metrics: Record<string, number>, baseline: Record<string, number> | undefined): Record<string, { average: number; delta?: number }> {
  return Object.fromEntries(Object.entries(metrics).sort(([left], [right]) => left.localeCompare(right)).map(([name, average]) => [name, { average, delta: baseline === undefined || baseline[name] === undefined ? undefined : average - baseline[name] }]))
}

function markdownReport(report: BenchmarkReport): string {
  const lines = ['# DSH BenchUp report', '', `Run: \`${report.runId}\``, '', '## Quality', '', '| Model | Scenario | Variant | Pass rate | Delta |', '| --- | --- | --- | ---: | ---: |']
  for (const group of report.comparison.groups) lines.push(`| ${group.model} | ${group.scenario} | ${group.variant} | ${(group.quality.passRate * 100).toFixed(1)}% | ${formatDelta(group.quality.deltaPassRate, '%', 100)} |`)
  lines.push('', '## Efficiency, robustness, and diagnostics', '', 'See `comparison.json` for each independent metric and its baseline delta. BenchUp deliberately does not produce a composite score.', '')
  return lines.join('\n')
}

function formatDelta(value: number | undefined, suffix = '', multiplier = 1): string { return value === undefined ? '—' : `${value >= 0 ? '+' : ''}${(value * multiplier).toFixed(2)}${suffix}` }
function resolveWithin(root: string, path: string): string { const target = resolve(root, path); const relation = relative(root, target); if (relation === '..' || relation.startsWith(`..${process.platform === 'win32' ? '\\' : '/'}`) || relation === '') { if (relation === '') return target; throw new Error(`Path escapes experiment directory: ${path}`) } return target }
function safeName(value: string): string { return basename(value).replace(/[^a-zA-Z0-9_.-]/g, '_') }
function stableHash(value: string): number { let hash = 2166136261; for (let index = 0; index < value.length; index += 1) { hash ^= value.charCodeAt(index); hash = Math.imul(hash, 16777619) } return hash >>> 0 }
function makeRunId(): string { return new Date().toISOString().replace(/[:.]/g, '-').replace('T', '_').replace('Z', '') }
