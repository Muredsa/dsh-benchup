/** Parsed benchmark configuration. The format is intentionally small and versioned. */

export interface ModelSpec {
  provider: string
  model: string
  reasoningEffort?: string
  maxTokens?: number
  temperature?: number
  stop?: string[]
}

export interface VariantSpec {
  profile: string
  model?: string
  plugins?: string[]
}

export interface EpisodeState {
  workspace: 'reset' | 'retain'
  persistent: 'reset' | 'retain'
  session: 'fresh' | 'continue'
  process: 'fresh' | 'restart' | 'reuse'
}

/** Exact comparison against either an inaccessible literal or a fixture file. */
export type ExactEvaluatorSpec =
  | { type: 'exact', expected: string, expectedValue?: never }
  | { type: 'exact', expectedValue: string, expected?: never }

export interface CommandEvaluatorSpec {
  type: 'command'
  command: string[]
  timeoutMs?: number
}

export interface JsonEvaluatorSpec {
  type: 'json'
  path: string
  schema: Record<string, unknown>
}

export interface FileEvaluatorSpec {
  type: 'file'
  path: string
  exists?: boolean
}

export type EvaluatorSpec = ExactEvaluatorSpec | CommandEvaluatorSpec | JsonEvaluatorSpec | FileEvaluatorSpec

export interface EvaluatorGroup {
  mode: 'all' | 'any'
  checks: EvaluatorSpec[]
}

export interface EpisodeSpec {
  id: string
  fixture?: string
  task: string
  state: EpisodeState
}

export interface ScenarioSpec {
  id: string
  fixture?: string
  episodes: EpisodeSpec[]
  evaluators: EvaluatorGroup
}

export interface ExperimentSpec {
  version: 1
  repetitions: number
  schedule: 'paired-shuffled' | 'ordered'
  models: Record<string, ModelSpec>
  variants: Record<string, VariantSpec>
  scenarios: ScenarioSpec[]
}

/** Thrown when the YAML document does not meet the public experiment format. */
export class ExperimentFormatError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ExperimentFormatError'
  }
}

function record(value: unknown, at: string): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new ExperimentFormatError(`${at} must be a mapping`)
  }
  return value as Record<string, unknown>
}

function stringValue(value: unknown, at: string): string {
  if (typeof value !== 'string' || value.length === 0) throw new ExperimentFormatError(`${at} must be a non-empty string`)
  return value
}

function integer(value: unknown, at: string, fallback?: number): number {
  if (value === undefined && fallback !== undefined) return fallback
  if (!Number.isInteger(value) || (value as number) < 1) throw new ExperimentFormatError(`${at} must be a positive integer`)
  return value as number
}

function optionalNumber(value: unknown, at: string): number | undefined {
  if (value === undefined) return undefined
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new ExperimentFormatError(`${at} must be a finite number`)
  return value
}

function stringArray(value: unknown, at: string): string[] | undefined {
  if (value === undefined) return undefined
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string')) throw new ExperimentFormatError(`${at} must be a list of strings`)
  return value as string[]
}

function parseModels(value: unknown): Record<string, ModelSpec> {
  const raw = record(value, 'models')
  const result: Record<string, ModelSpec> = {}
  for (const [name, candidate] of Object.entries(raw)) {
    const model = record(candidate, `models.${name}`)
    result[name] = {
      provider: stringValue(model.provider, `models.${name}.provider`),
      model: stringValue(model.model, `models.${name}.model`),
      reasoningEffort: model.reasoningEffort === undefined ? undefined : stringValue(model.reasoningEffort, `models.${name}.reasoningEffort`),
      maxTokens: optionalNumber(model.maxTokens, `models.${name}.maxTokens`),
      temperature: optionalNumber(model.temperature, `models.${name}.temperature`),
      stop: stringArray(model.stop, `models.${name}.stop`),
    }
  }
  if (Object.keys(result).length === 0) throw new ExperimentFormatError('models must contain at least one model')
  return result
}

function parseVariants(value: unknown, models: Record<string, ModelSpec>): Record<string, VariantSpec> {
  const raw = record(value, 'variants')
  const result: Record<string, VariantSpec> = {}
  for (const [name, candidate] of Object.entries(raw)) {
    const variant = record(candidate, `variants.${name}`)
    const model = variant.model === undefined ? undefined : stringValue(variant.model, `variants.${name}.model`)
    if (model !== undefined && models[model] === undefined) throw new ExperimentFormatError(`variants.${name}.model references unknown model ${model}`)
    result[name] = {
      profile: stringValue(variant.profile, `variants.${name}.profile`),
      model,
      plugins: stringArray(variant.plugins, `variants.${name}.plugins`),
    }
  }
  if (Object.keys(result).length === 0) throw new ExperimentFormatError('variants must contain at least one variant')
  return result
}

function parseState(value: unknown, at: string): EpisodeState {
  const raw = value === undefined ? {} : record(value, at)
  const option = <T extends string>(field: string, choices: readonly T[], fallback: T): T => {
    const candidate = raw[field]
    if (candidate === undefined) return fallback
    if (typeof candidate !== 'string' || !choices.includes(candidate as T)) throw new ExperimentFormatError(`${at}.${field} must be one of ${choices.join(', ')}`)
    return candidate as T
  }
  return {
    workspace: option('workspace', ['reset', 'retain'], 'reset'),
    persistent: option('persistent', ['reset', 'retain'], 'reset'),
    session: option('session', ['fresh', 'continue'], 'fresh'),
    process: option('process', ['fresh', 'restart', 'reuse'], 'fresh'),
  }
}

function parseEvaluator(value: unknown, at: string): EvaluatorSpec {
  const raw = record(value, at)
  const type = stringValue(raw.type, `${at}.type`)
  if (type === 'exact') {
    const expected = raw.expected === undefined ? undefined : stringValue(raw.expected, `${at}.expected`)
    const expectedValue = raw.expectedValue === undefined ? undefined : stringValue(raw.expectedValue, `${at}.expectedValue`)
    if (expected === undefined && expectedValue === undefined) throw new ExperimentFormatError(`${at} needs expected or expectedValue`)
    if (expected !== undefined && expectedValue !== undefined) throw new ExperimentFormatError(`${at} cannot specify both expected and expectedValue`)
    return expected === undefined ? { type, expectedValue: expectedValue! } : { type, expected }
  }
  if (type === 'command') return { type, command: stringArray(raw.command, `${at}.command`) ?? [], timeoutMs: raw.timeoutMs === undefined ? undefined : integer(raw.timeoutMs, `${at}.timeoutMs`) }
  if (type === 'json') return { type, path: stringValue(raw.path, `${at}.path`), schema: record(raw.schema, `${at}.schema`) }
  if (type === 'file') {
    if (raw.exists !== undefined && typeof raw.exists !== 'boolean') throw new ExperimentFormatError(`${at}.exists must be boolean`)
    return { type, path: stringValue(raw.path, `${at}.path`), exists: raw.exists as boolean | undefined }
  }
  throw new ExperimentFormatError(`${at}.type must be exact, command, json, or file`)
}

function parseEvaluators(value: unknown, at: string): EvaluatorGroup {
  if (value === undefined) return { mode: 'all', checks: [] }
  if (Array.isArray(value)) return { mode: 'all', checks: value.map((item, index) => parseEvaluator(item, `${at}[${index}]`)) }
  const raw = record(value, at)
  if (raw.type !== undefined) return { mode: 'all', checks: [parseEvaluator(raw, at)] }
  const mode = raw.mode === undefined ? 'all' : raw.mode
  if (mode !== 'all' && mode !== 'any') throw new ExperimentFormatError(`${at}.mode must be all or any`)
  if (!Array.isArray(raw.checks)) throw new ExperimentFormatError(`${at}.checks must be a list`)
  return { mode, checks: raw.checks.map((item, index) => parseEvaluator(item, `${at}.checks[${index}]`)) }
}

function parseScenarios(value: unknown): ScenarioSpec[] {
  if (!Array.isArray(value) || value.length === 0) throw new ExperimentFormatError('scenarios must be a non-empty list')
  const seen = new Set<string>()
  return value.map((candidate, index) => {
    const at = `scenarios[${index}]`
    const raw = record(candidate, at)
    const id = stringValue(raw.id, `${at}.id`)
    if (seen.has(id)) throw new ExperimentFormatError(`scenario id ${id} is duplicated`)
    seen.add(id)
    const hasTask = raw.task !== undefined
    const hasEpisodes = raw.episodes !== undefined
    if (hasTask === hasEpisodes) throw new ExperimentFormatError(`${at} must specify exactly one of task or episodes`)
    let episodes: EpisodeSpec[]
    if (hasTask) {
      episodes = [{ id: 'main', task: stringValue(raw.task, `${at}.task`), state: parseState(raw.state, `${at}.state`) }]
    } else {
      if (!Array.isArray(raw.episodes) || raw.episodes.length === 0) throw new ExperimentFormatError(`${at}.episodes must be a non-empty list`)
      const episodeIds = new Set<string>()
      episodes = raw.episodes.map((entry, episodeIndex) => {
        const episodeAt = `${at}.episodes[${episodeIndex}]`
        const episode = record(entry, episodeAt)
        const episodeId = episode.id === undefined ? String(episodeIndex + 1).padStart(2, '0') : stringValue(episode.id, `${episodeAt}.id`)
        if (episodeIds.has(episodeId)) throw new ExperimentFormatError(`${episodeAt}.id is duplicated`)
        episodeIds.add(episodeId)
        return {
          id: episodeId,
          fixture: episode.fixture === undefined ? undefined : stringValue(episode.fixture, `${episodeAt}.fixture`),
          task: stringValue(episode.task, `${episodeAt}.task`),
          state: parseState(episode.state, `${episodeAt}.state`),
        }
      })
    }
    return {
      id,
      fixture: raw.fixture === undefined ? undefined : stringValue(raw.fixture, `${at}.fixture`),
      episodes,
      evaluators: parseEvaluators(raw.evaluators, `${at}.evaluators`),
    }
  })
}

/** Parses already-materialized YAML/JSON data into the public configuration model. */
export function parseExperiment(value: unknown): ExperimentSpec {
  const raw = record(value, 'experiment')
  if (raw.version !== 1) throw new ExperimentFormatError('version must be 1')
  const models = parseModels(raw.models)
  const schedule = raw.schedule === undefined ? 'paired-shuffled' : raw.schedule
  if (schedule !== 'paired-shuffled' && schedule !== 'ordered') throw new ExperimentFormatError('schedule must be paired-shuffled or ordered')
  return {
    version: 1,
    repetitions: integer(raw.runs ?? raw.repetitions, 'repetitions', 1),
    schedule,
    models,
    variants: parseVariants(raw.variants, models),
    scenarios: parseScenarios(raw.scenarios),
  }
}
