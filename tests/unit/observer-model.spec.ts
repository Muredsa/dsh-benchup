import { describe, expect, it } from 'vitest'
import { applyModelSpec } from '../../src/observer/index.js'

describe('benchmark model override', () => {
  it('does not add undefined fields to the durable request header', () => {
    const result = applyModelSpec(
      { provider: 'deepseek-official', model: 'deepseek-v4-flash' },
      { provider: 'openrouter', model: 'stealth/ox-alpha', reasoningEffort: 'max', temperature: 1 },
    )

    expect(result).toEqual({
      provider: 'openrouter',
      model: 'stealth/ox-alpha',
      reasoningEffort: 'max',
      temperature: 1,
    })
    expect(Object.values(result)).not.toContain(undefined)
  })

  it('retains a defined request parameter when the benchmark leaves it open', () => {
    const result = applyModelSpec(
      { provider: 'old', model: 'old', maxTokens: 2048, stop: ['<END>'] },
      { provider: 'openrouter', model: 'stealth/ox-alpha' },
    )

    expect(result).toMatchObject({ provider: 'openrouter', model: 'stealth/ox-alpha', maxTokens: 2048, stop: ['<END>'] })
  })
})
