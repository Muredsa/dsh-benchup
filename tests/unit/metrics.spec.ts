import { describe, expect, it } from 'vitest'
import { RepeatWorkTracker } from '../../src/metrics/index.js'

describe('RepeatWorkTracker', () => {
  it('counts a mechanically identical file read but resets its revision after a write', () => {
    const tracker = new RepeatWorkTracker()
    expect(tracker.record({ name: 'read_file', arguments: { path: 'auth.py' } }).repeatedFileRead).toBe(false)
    expect(tracker.record({ name: 'read_file', arguments: { path: 'auth.py' } }).repeatedFileRead).toBe(true)
    tracker.markWrite({ name: 'write_file', arguments: { path: 'auth.py' } })
    expect(tracker.record({ name: 'read_file', arguments: { path: 'auth.py' } }).repeatedFileRead).toBe(false)
  })

  it('does not claim semantically different shell spelling is repeated', () => {
    const tracker = new RepeatWorkTracker()
    tracker.record({ name: 'shell', arguments: { command: 'pnpm test' } })
    expect(tracker.record({ name: 'shell', arguments: { command: 'pnpm  test' } }).repeatedCommand).toBe(false)
  })
})
