import { describe, expect, it } from 'vitest'
import { ExperimentFormatError, parseExperiment } from '../../src/schema/index.js'

describe('parseExperiment', () => {
  it('normalizes one-task scenario into a main episode', () => {
    const experiment = parseExperiment({
      version: 1,
      models: { test: { provider: 'test', model: 'model' } },
      variants: { baseline: { profile: 'headless' } },
      scenarios: [{ id: 'reply', task: 'reply.md' }],
    })
    expect(experiment.repetitions).toBe(1)
    expect(experiment.scenarios[0]!.episodes).toEqual([{ id: 'main', task: 'reply.md', state: { workspace: 'reset', persistent: 'reset', session: 'fresh', process: 'fresh' } }])
  })

  it('rejects a variant that references an unknown model', () => {
    expect(() => parseExperiment({
      version: 1,
      models: { test: { provider: 'test', model: 'model' } },
      variants: { baseline: { profile: 'headless', model: 'missing' } },
      scenarios: [{ id: 'reply', task: 'reply.md' }],
    })).toThrow(ExperimentFormatError)
  })
})
