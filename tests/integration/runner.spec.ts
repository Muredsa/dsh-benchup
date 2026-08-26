import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { BenchmarkRunner } from '../../src/runner/index.js'

describe('BenchmarkRunner', () => {
  it('keeps baseline deltas and custom metrics independent', async () => {
    const root = mkdtempSync(join(tmpdir(), 'dsh-benchup-runner-'))
    mkdirSync(join(root, 'fixture'))
    writeFileSync(join(root, 'task.md'), 'do work')
    writeFileSync(join(root, 'experiment.yml'), `version: 1\nruns: 1\nmodels:\n  test:\n    provider: test\n    model: model\nvariants:\n  baseline:\n    profile: baseline\n  memcore:\n    profile: memcore\nscenarios:\n  - id: memory/fact\n    fixture: fixture\n    task: task.md\n    evaluators:\n      type: command\n      command: [node, -e, process.exit(0)]\n`)
    const runner = new BenchmarkRunner({
      outputDir: join(root, 'out'),
      executeChild: async (request) => {
        mkdirSync(request.artifactDir, { recursive: true })
        const repeated = request.profile === 'baseline' ? 12 : 2
        writeFileSync(join(request.artifactDir, 'summary.json'), JSON.stringify({
          coreMetrics: { inputTokens: 80_000, outputTokens: 1, cachedInputTokens: 0, llmTurns: 1, toolCalls: 1, repeatedFileReads: repeated, repeatedSearches: 0, repeatedCommands: 0, duplicateToolCalls: 0, retries: 0, errors: 0, subagents: 0 },
          customMetrics: { definitions: [{ name: 'memcore.memory_hits', unit: 'count', aggregation: 'sum', dimension: 'diagnostic', scope: 'episode' }], values: { 'memcore.memory_hits': request.profile === 'memcore' ? 3 : 0 } },
        }))
        return { exitCode: 0, timedOut: false, stdout: '', stderr: '', durationMs: 1 }
      },
    })
    const report = await runner.run(join(root, 'experiment.yml'))
    const memcore = report.comparison.groups.find((group) => group.variant === 'memcore')!
    expect(memcore.quality.passRate).toBe(1)
    expect(memcore.diagnostics.repeatedFileReads.delta).toBe(-10)
    expect(memcore.diagnostics['memcore.memory_hits'].average).toBe(3)
  })
})
