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

  it('keeps a literal exact answer outside the agent workspace', () => {
    const experiment = parseExperiment({
      version: 1,
      models: { test: { provider: 'test', model: 'model' } },
      variants: { baseline: { profile: 'headless' } },
      scenarios: [{ id: 'reply', task: 'reply.md', evaluators: { type: 'exact', expectedValue: 'private-answer' } }],
    })
    expect(experiment.scenarios[0]!.evaluators.checks).toEqual([{ type: 'exact', expectedValue: 'private-answer' }])
  })

  it('allows an episode fixture to replace the scenario fixture', () => {
    const experiment = parseExperiment({
      version: 1,
      models: { test: { provider: 'test', model: 'model' } },
      variants: { baseline: { profile: 'headless' } },
      scenarios: [{
        id: 'reply', fixture: 'default-fixture', episodes: [
          { id: 'seed', fixture: 'seed-fixture', task: 'seed.md' },
          { id: 'recall', fixture: 'recall-fixture', task: 'recall.md' },
        ],
      }],
    })
    expect(experiment.scenarios[0]!.episodes.map((episode) => episode.fixture)).toEqual(['seed-fixture', 'recall-fixture'])
  })

  it('rejects ambiguous exact expectations', () => {
    expect(() => parseExperiment({
      version: 1,
      models: { test: { provider: 'test', model: 'model' } },
      variants: { baseline: { profile: 'headless' } },
      scenarios: [{ id: 'reply', task: 'reply.md', evaluators: { type: 'exact', expected: 'expected.txt', expectedValue: 'answer' } }],
    })).toThrow(ExperimentFormatError)
  })
})
