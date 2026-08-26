import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { evaluate } from '../../src/evaluators/index.js'

describe('JSON evaluator', () => {
  it('uses JSON Schema rather than truthiness', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'dsh-benchup-evaluator-'))
    writeFileSync(join(directory, 'result.json'), '{"ok":true}')
    const summary = await evaluate({ mode: 'all', checks: [{ type: 'json', path: 'result.json', schema: { type: 'object', required: ['ok'], properties: { ok: { const: true } } } }] }, { workspace: directory, finalText: '' })
    expect(summary.passed).toBe(true)
  })
})
