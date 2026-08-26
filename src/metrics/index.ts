import { Service, type Context } from '@deepseek-ai/cordis'

/** A plugin-defined metric. Names are namespaced so independent plugins cannot collide. */
export interface MetricDefinition {
  name: string
  unit: 'count' | 'tokens' | 'ms' | 'ratio'
  aggregation: 'sum' | 'max' | 'last'
  dimension: 'quality' | 'efficiency' | 'robustness' | 'diagnostic'
  scope: 'episode' | 'scenario'
  description?: string
}

export interface MetricSnapshot {
  definitions: MetricDefinition[]
  values: Record<string, number>
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    benchMetrics: BenchMetrics
  }
}

/**
 * Service through which an observed plugin contributes diagnostic numbers to a BenchUp run.
 * Core counters are kept separately; this registry only holds intentionally plugin-specific data.
 */
export class BenchMetrics extends Service {
  private readonly definitions = new Map<string, MetricDefinition>()
  private readonly values = new Map<string, number>()

  constructor(ctx: Context) {
    super(ctx, 'benchMetrics')
  }

  /** Registers a metric name and its aggregation semantics. */
  register(definition: MetricDefinition): void {
    if (!/^[a-z][a-z0-9-]*(?:\.[a-z][a-z0-9_-]*)+$/.test(definition.name)) {
      throw new Error(`BenchUp metric names must be namespaced: ${definition.name}`)
    }
    const existing = this.definitions.get(definition.name)
    if (existing !== undefined && JSON.stringify(existing) !== JSON.stringify(definition)) {
      throw new Error(`BenchUp metric ${definition.name} was registered with conflicting metadata`)
    }
    this.definitions.set(definition.name, { ...definition })
  }

  /** Adds a finite value to a metric registered with sum aggregation. */
  add(name: string, value = 1): void {
    this.ensure(name, 'sum')
    this.assertFinite(value, name)
    this.values.set(name, (this.values.get(name) ?? 0) + value)
  }

  /** Records a finite value for a max or last metric. */
  set(name: string, value: number): void {
    const definition = this.ensure(name)
    this.assertFinite(value, name)
    this.values.set(name, definition.aggregation === 'max' ? Math.max(this.values.get(name) ?? Number.NEGATIVE_INFINITY, value) : value)
  }

  /** Returns a serializable immutable snapshot for the run artifact. */
  snapshot(): MetricSnapshot {
    return {
      definitions: [...this.definitions.values()].sort((left, right) => left.name.localeCompare(right.name)),
      values: Object.fromEntries([...this.values.entries()].sort(([left], [right]) => left.localeCompare(right))),
    }
  }

  private ensure(name: string, requiredAggregation?: MetricDefinition['aggregation']): MetricDefinition {
    const definition = this.definitions.get(name)
    if (definition === undefined) throw new Error(`BenchUp metric ${name} was not registered`)
    if (requiredAggregation !== undefined && definition.aggregation !== requiredAggregation) {
      throw new Error(`BenchUp metric ${name} uses ${definition.aggregation}, not ${requiredAggregation}`)
    }
    return definition
  }

  private assertFinite(value: number, name: string): void {
    if (!Number.isFinite(value)) throw new Error(`BenchUp metric ${name} must be finite`)
  }
}

/** Normalized input retained between a tool call and its result. */
export interface ToolCallInput {
  name: string
  arguments?: unknown
}

export interface RepeatObservation {
  duplicateToolCall: boolean
  repeatedFileRead: boolean
  repeatedSearch: boolean
  repeatedCommand: boolean
}

/**
 * Detects mechanical duplicate tool work without pretending to understand shell commands
 * or arbitrary tool argument semantics. Writes advance a resource revision, so a re-read
 * after a recorded write is not marked as repeated work.
 */
export class RepeatWorkTracker {
  private readonly seen = new Set<string>()
  private readonly resourceRevisions = new Map<string, number>()

  /** Records a tool call and returns the repeat categories it matches. */
  record(call: ToolCallInput): RepeatObservation {
    const canonical = stableJson({ name: call.name, arguments: call.arguments ?? null })
    const duplicateToolCall = this.seen.has(canonical)
    this.seen.add(canonical)
    const args = asRecord(call.arguments)
    const read = isRead(call.name) ? resourceKey(args) : undefined
    const search = isSearch(call.name) ? searchKey(args) : undefined
    const command = isCommand(call.name) ? commandKey(args) : undefined
    const repeatedFileRead = read === undefined ? false : this.repeat(`read:${read}@${this.resourceRevisions.get(read) ?? 0}`)
    const repeatedSearch = search === undefined ? false : this.repeat(`search:${search}`)
    const repeatedCommand = command === undefined ? false : this.repeat(`command:${command}`)
    return { duplicateToolCall, repeatedFileRead, repeatedSearch, repeatedCommand }
  }

  /** Advances a resource revision after a successful write-like tool result. */
  markWrite(call: ToolCallInput): void {
    if (!isWrite(call.name)) return
    const target = resourceKey(asRecord(call.arguments))
    if (target !== undefined) this.resourceRevisions.set(target, (this.resourceRevisions.get(target) ?? 0) + 1)
  }

  private repeat(key: string): boolean {
    const seen = this.seen.has(key)
    this.seen.add(key)
    return seen
  }
}

function asRecord(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
}

function isRead(name: string): boolean { return /(?:^|[_-])(read|cat|view)(?:$|[_-])|read_file|filesystem\.read/i.test(name) }
function isSearch(name: string): boolean { return /search|grep|glob|find/i.test(name) }
function isCommand(name: string): boolean { return /shell|command|terminal|exec|bash|powershell/i.test(name) }
function isWrite(name: string): boolean { return /write|edit|replace|patch|apply/i.test(name) }

function resourceKey(args: Record<string, unknown>): string | undefined {
  const path = firstString(args, ['path', 'file', 'filename', 'resource', 'uri'])
  if (path === undefined) return undefined
  const range = firstString(args, ['range', 'line_range', 'lines']) ?? ''
  return `${path}:${range}`
}

function searchKey(args: Record<string, unknown>): string | undefined {
  const query = firstString(args, ['query', 'pattern', 'search', 'glob'])
  if (query === undefined) return undefined
  return stableJson({ query, path: firstString(args, ['path', 'cwd', 'directory']) ?? '' })
}

function commandKey(args: Record<string, unknown>): string | undefined {
  const command = firstString(args, ['command', 'cmd', 'script'])
  const argv = Array.isArray(args.argv) && args.argv.every((item) => typeof item === 'string') ? args.argv : undefined
  if (command === undefined && argv === undefined) return undefined
  return stableJson({ command, argv, cwd: firstString(args, ['cwd', 'path']) ?? '' })
}

function firstString(args: Record<string, unknown>, names: string[]): string | undefined {
  for (const name of names) if (typeof args[name] === 'string') return args[name]
  return undefined
}

function stableJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`
  const record = value as Record<string, unknown>
  return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${stableJson(record[key])}`).join(',')}}`
}
