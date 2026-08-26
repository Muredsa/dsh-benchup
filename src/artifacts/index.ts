import { appendFileSync, mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

/** Synchronous, append-only artifact writer used inside short-lived agent child processes. */
export class ArtifactWriter {
  constructor(private readonly root: string) {
    mkdirSync(root, { recursive: true })
  }

  /** Writes one JSON artifact below this run directory. */
  writeJson(name: string, value: unknown): void {
    if (!/^[a-zA-Z0-9][a-zA-Z0-9_.-]*\.json$/.test(name)) throw new Error(`Unsafe BenchUp artifact name: ${name}`)
    writeFileSync(join(this.root, name), `${JSON.stringify(value, null, 2)}\n`, 'utf8')
  }

  /** Appends a raw session event as JSON Lines without transforming its diagnostic data. */
  appendTrace(sessionId: string, event: unknown): void {
    const traces = join(this.root, 'traces')
    mkdirSync(traces, { recursive: true })
    appendFileSync(join(traces, `${safeSegment(sessionId)}.jsonl`), `${JSON.stringify(event)}\n`, 'utf8')
  }
}

function safeSegment(value: string): string {
  return value.replace(/[^a-zA-Z0-9_.-]/g, '_') || 'unknown'
}
