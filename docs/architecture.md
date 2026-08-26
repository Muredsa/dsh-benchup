# Architecture

DSH BenchUp has two deliberately separate parts.

`dsh-benchup` is a host-side CLI. It expands an experiment into the product of models, variants, scenarios, and repetitions; gives each cell an isolated workspace and persistent-state directory; starts a short-lived `dsh --profile` child; then evaluates the resulting workspace and response.

The package is also the Cordis plugin `dsh-benchup`. The runner inserts it only into benchmark children. It observes the durable `session/event` stream, writes raw JSONL traces, derives core counters, and exposes `ctx.benchMetrics` for the variant under test to add diagnostics. Its `agent/request` waterfall listener applies the configured provider/model/generation fields, so the effective request remains visible in the Harness session log.

## Isolation and state

Each cell gets a private scratch tree:

```text
cell/
  workspace/     # agent-visible files
  persistent/    # passed as DSH_BENCHUP_STATE_ROOT
```

Episode state controls whether each directory is reset or retained. `cold` is represented by resetting both. `warm memory` retains `persistent` while resetting the workspace and starting a fresh process. A persistent-memory plugin must intentionally use `DSH_BENCHUP_STATE_ROOT` (or provide an equivalent configured root); BenchUp never changes `DSH_HOME`, because profiles and settings live there.

The first release runs every episode in a fresh child. The schema already accepts `session: continue` and `process: reuse`, but the runner rejects them loudly rather than silently giving a false warm-session result. A future persistent driver can add those modes without changing experiment files.

## Measurements

Core metrics are derived from the session event stream: prompt/output/cache token usage, LLM turns, tool calls, subagent descriptors, retries, tool-result errors, wall time, repeated file reads, repeated searches, repeated commands, and mechanically identical tool calls. Repeated reads include the file/range and a local write revision, so reading a file again after a successful recorded write is not counted as wasted repetition.

Custom metrics use a small extension API:

```ts
ctx.benchMetrics.register({
  name: 'memcore.memory_hits',
  unit: 'count', aggregation: 'sum', dimension: 'diagnostic', scope: 'episode',
})
ctx.benchMetrics.add('memcore.memory_hits')
```

Names must be namespaced. Each run artifact includes their definitions and values, and comparison output shows them independently instead of folding them into a score.

## Results

`runs/<run-id>/` contains the normalized experiment, per-cell child patches, raw `traces/*.jsonl`, per-episode `summary.json`, machine-readable `runs.json`, and `comparison.json`, plus a concise `report.md`. Reports keep quality, efficiency, robustness, and diagnostics separate. `baseline` is a conventionally named variant; deltas are only calculated against a matching baseline model and scenario.

Trace artifacts can contain prompts, tool arguments, output, and file paths. Store them as sensitive engineering data and do not upload them blindly.
