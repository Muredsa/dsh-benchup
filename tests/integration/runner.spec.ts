import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
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

  it('replaces a scenario fixture with each episode fixture', async () => {
    const root = mkdtempSync(join(tmpdir(), 'dsh-benchup-runner-'))
    mkdirSync(join(root, 'seed'))
    mkdirSync(join(root, 'recall'))
    writeFileSync(join(root, 'seed', 'marker.txt'), 'seed')
    writeFileSync(join(root, 'recall', 'marker.txt'), 'recall')
    writeFileSync(join(root, 'seed.md'), 'store')
    writeFileSync(join(root, 'recall.md'), 'recall')
    writeFileSync(join(root, 'experiment.yml'), `version: 1\nmodels:\n  test:\n    provider: test\n    model: model\nvariants:\n  baseline:\n    profile: baseline\nscenarios:\n  - id: memory/fact\n    episodes:\n      - id: seed\n        fixture: seed\n        task: seed.md\n        state: { workspace: reset, persistent: reset, session: fresh, process: fresh }\n      - id: recall\n        fixture: recall\n        task: recall.md\n        state: { workspace: reset, persistent: retain, session: fresh, process: restart }\n    evaluators:\n      type: command\n      command: [node, -e, process.exit(0)]\n`)
    const markers: string[] = []
    const runner = new BenchmarkRunner({
      outputDir: join(root, 'out'),
      executeChild: async (request) => {
        markers.push(readFileSync(join(request.cwd, 'marker.txt'), 'utf8'))
        return { exitCode: 0, timedOut: false, stdout: '', stderr: '', durationMs: 1 }
      },
    })

    await runner.run(join(root, 'experiment.yml'))

    expect(markers).toEqual(['seed', 'recall'])
  })
})
