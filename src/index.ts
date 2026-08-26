import type { Context } from '@deepseek-ai/cordis'
import { BenchMetrics } from './metrics/index.js'
import { BenchupObserver, type BenchupObserverConfig } from './observer/index.js'

export * from './artifacts/index.js'
export * from './evaluators/index.js'
export * from './metrics/index.js'
export * from './observer/index.js'
export * from './runner/index.js'
export * from './schema/index.js'

/** Cordis plugin name used in profile patches. */
export const name = 'dsh-benchup'

/**
 * Installs an observer for one benchmark child process and provides the custom metric registry.
 * The runner only enables this plugin for its own child processes, never for normal sessions.
 */
export function apply(ctx: Context, config: BenchupObserverConfig): void {
  const metrics = new BenchMetrics(ctx)
  new BenchupObserver(ctx, metrics, config)
}
