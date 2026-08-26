import { type Context } from '@deepseek-ai/cordis'
import { ArtifactWriter } from '../artifacts/index.js'
import { BenchMetrics, RepeatWorkTracker, type ToolCallInput } from '../metrics/index.js'
import type { ModelSpec } from '../schema/index.js'

/** Configuration injected by the runner in its short-lived profile patch. */
export interface BenchupObserverConfig {
  outputDir: string
  runId?: string
  episodeId?: string
  model?: ModelSpec
}

export interface CoreMetrics {
  inputTokens: number
  outputTokens: number
  cachedInputTokens: number
  llmTurns: number
  toolCalls: number
  repeatedFileReads: number
  repeatedSearches: number
  repeatedCommands: number
  duplicateToolCalls: number
  subagents: number
  retries: number
  errors: number
}

/** Event observer that captures raw session traces and derives neutral runtime counters. */
export class BenchupObserver {
  private readonly writer: ArtifactWriter
  private readonly repeats = new RepeatWorkTracker()
  private readonly pendingCalls = new Map<string, ToolCallInput>()
  private readonly metrics: CoreMetrics = {
    inputTokens: 0, outputTokens: 0, cachedInputTokens: 0, llmTurns: 0, toolCalls: 0,
    repeatedFileReads: 0, repeatedSearches: 0, repeatedCommands: 0, duplicateToolCalls: 0,
    retries: 0, errors: 0, subagents: 0,
  }

  constructor(private readonly ctx: Context, private readonly customMetrics: BenchMetrics, private readonly config: BenchupObserverConfig) {
    this.writer = new ArtifactWriter(config.outputDir)
    const events = ctx as unknown as LooseContext
    events.on('session/event', (session: unknown, event: unknown) => this.observe(session, event))
    if (config.model !== undefined) {
      events.on('agent/request', async (_payload: unknown, next: () => unknown) => {
        const proposal = await next()
        return this.applyModel(proposal)
      })
    }
    events.effect(() => () => this.flush())
  }

  /** Writes the current summary; public for hosts that intentionally flush before disposal. */
  flush(): void {
    this.writer.writeJson('summary.json', {
      version: 1,
      runId: this.config.runId,
      episodeId: this.config.episodeId,
      model: this.config.model,
      coreMetrics: this.metrics,
      customMetrics: this.customMetrics.snapshot(),
    })
  }

  private observe(session: unknown, event: unknown): void {
    const eventRecord = asRecord(event)
    const sessionId = readString(asRecord(session), ['id', 'sessionId']) ?? 'unknown'
    this.writer.appendTrace(sessionId, event)
    const type = readString(eventRecord, ['type', 'name'])
    const data = asRecord(eventRecord.data)
    if (type === 'step/start') this.metrics.llmTurns += 1
    if (type === 'llm/retry') this.metrics.retries += 1
    if (type === 'turn/end' && (asRecord(data.reason).kind === 'error' || data.error !== undefined)) this.metrics.errors += 1
    if (type === 'subagent/descriptor') this.metrics.subagents += 1
    if (type === 'tool/call') this.onToolCall(data)
    if (type === 'tool/result') this.onToolResult(data)
    if (type === 'assistant/message' || type === 'assistant') this.onAssistant(data)
  }

  private onToolCall(data: Record<string, unknown>): void {
    const name = readString(data, ['name', 'toolName'])
    if (name === undefined) return
    const call: ToolCallInput = { name, arguments: parseToolArguments(data.arguments ?? data.input) }
    const callId = readString(data, ['callId', 'id'])
    if (callId !== undefined) this.pendingCalls.set(callId, call)
    this.metrics.toolCalls += 1
    const repeat = this.repeats.record(call)
    if (repeat.duplicateToolCall) this.metrics.duplicateToolCalls += 1
    if (repeat.repeatedFileRead) this.metrics.repeatedFileReads += 1
    if (repeat.repeatedSearch) this.metrics.repeatedSearches += 1
    if (repeat.repeatedCommand) this.metrics.repeatedCommands += 1
  }

  private onToolResult(data: Record<string, unknown>): void {
    const source = asRecord(asRecord(data.message).source)
    const callId = readString(data, ['callId']) ?? readString(source, ['callId'])
    const call = callId === undefined ? undefined : this.pendingCalls.get(callId)
    if (call === undefined) return
    this.pendingCalls.delete(callId!)
    const content = asRecord(data.message).content
    const firstContent = Array.isArray(content) ? asRecord(content[0]) : {}
    const failed = data.error !== undefined || firstContent.isError === true
    if (failed) this.metrics.errors += 1
    else this.repeats.markWrite(call)
  }

  private onAssistant(data: Record<string, unknown>): void {
    const usage = asRecord(data.usage)
    this.metrics.inputTokens += numberValue(usage, ['inputTokens', 'promptTokens', 'input_tokens'])
    this.metrics.outputTokens += numberValue(usage, ['outputTokens', 'completionTokens', 'output_tokens'])
    this.metrics.cachedInputTokens += numberValue(usage, ['cacheReadTokens', 'cachedInputTokens', 'cached_input_tokens'])
  }

  private applyModel(proposal: unknown): unknown {
    return applyModelSpec(proposal, this.config.model!)
  }
}

/** Applies a benchmark's pinned model fields without adding undefined event data. */
export function applyModelSpec(proposal: unknown, model: ModelSpec): Record<string, unknown> {
  const request = asRecord(proposal)
  const reasoningEffort = model.reasoningEffort ?? request.reasoningEffort
  const maxTokens = model.maxTokens ?? request.maxTokens
  const temperature = model.temperature ?? request.temperature
  const stop = model.stop ?? request.stop
  return {
    ...request,
    provider: model.provider,
    model: model.model,
    ...reasoningEffort === undefined ? {} : { reasoningEffort },
    ...maxTokens === undefined ? {} : { maxTokens },
    ...temperature === undefined ? {} : { temperature },
    ...stop === undefined ? {} : { stop },
  }
}

interface LooseContext {
  on(name: string, listener: (...args: any[]) => any): unknown
  effect(callback: () => () => void): unknown
}

function asRecord(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
}

function readString(value: Record<string, unknown>, keys: string[]): string | undefined {
  for (const key of keys) if (typeof value[key] === 'string') return value[key]
  return undefined
}

function numberValue(value: Record<string, unknown>, keys: string[]): number {
  for (const key of keys) if (typeof value[key] === 'number' && Number.isFinite(value[key])) return value[key]
  return 0
}

/** Parses the core's raw JSON tool arguments, retaining malformed strings as opaque values. */
function parseToolArguments(value: unknown): unknown {
  if (typeof value !== 'string') return value
  try { return JSON.parse(value) as unknown } catch { return value }
}
