import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { loadExperimentFile } from '../../src/runner/index.js'

describe('Ox Alpha baseline example', () => {
  it('uses the canonical OpenRouter model id and objective evaluators', () => {
    const experiment = loadExperimentFile(resolve(import.meta.dirname, '../../examples/ox-alpha-baseline.yml'))

    expect(experiment.models['ox-alpha']).toEqual({
      provider: 'openrouter',
      model: 'stealth/ox-alpha',
      temperature: 1,
      reasoningEffort: 'max',
      maxTokens: undefined,
      stop: undefined,
    })
    expect(experiment.scenarios.map((scenario) => scenario.id)).toEqual([
      'baseline/exact-response',
      'baseline/file-to-json',
      'baseline/code-repair',
    ])
    expect(experiment.scenarios.flatMap((scenario) => scenario.evaluators.checks.map((check) => check.type))).toEqual([
      'exact', 'file', 'json', 'command', 'file',
    ])
  })

  it('keeps the code-repair fixture initially failing', () => {
    const source = readFileSync(resolve(import.meta.dirname, '../../examples/ox-alpha/code-repair/src/slug.js'), 'utf8')

    expect(source).toContain("replace(/\\s+/g, '-')")
  })
})
