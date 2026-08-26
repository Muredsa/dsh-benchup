# DSH BenchUp

[![npm version](https://img.shields.io/npm/v/dsh-benchup?logo=npm)](https://www.npmjs.com/package/dsh-benchup)
[![CI](https://github.com/Muredsa/dsh-benchup/actions/workflows/ci.yml/badge.svg)](https://github.com/Muredsa/dsh-benchup/actions/workflows/ci.yml)

DSH BenchUp is a small, reproducible benchmark runner for [DeepSeek Harness](https://github.com/deepseek-ai/DeepSeek-Harness). It compares model, profile, prompt, compaction, subagent, and plugin variants without reducing the result to one misleading score.

It reports independent dimensions:

- **Quality:** task success and objective evaluator results.
- **Efficiency:** token usage, LLM turns, tool calls, wall time, and repeated work.
- **Robustness:** retries, errors, timeouts, and variation over repetitions.
- **Diagnostics:** arbitrary, namespaced metrics from the plugin being tested.

## Install

Install [`dsh-benchup` from npm](https://www.npmjs.com/package/dsh-benchup) into every Harness profile that a benchmark will start, so its temporary profile patch can resolve the observer plugin:

```powershell
cd $env:DSH_HOME\profiles\headless
pnpm add dsh-benchup
```

Repeat for each comparison profile, including a `headless-experiment` profile that contains the plugin or configuration under test. To test an unreleased GitHub revision, use `pnpm add github:Muredsa/dsh-benchup` instead. The package exposes the standalone CLI:

```powershell
pnpm exec dsh-benchup run .\examples\basic-experiment.yml
```

`dsh-benchup` is the supported command in this release. A future DSH application bundle may add the shorter `dsh benchup` alias without changing experiment files.

## An experiment

```yaml
version: 1
runs: 5
models:
  gpt:
    provider: openai
    model: gpt-5
    temperature: 0
variants:
  baseline:
    profile: headless
  memcore:
    profile: headless-memcore
scenarios:
  - id: coding/auth-fix
    fixture: fixtures/auth
    task: tasks/auth-fix.md
    evaluators:
      mode: all
      checks:
        - type: command
          command: [pnpm, test]
        - type: file
          path: src/auth.ts
```

Every model runs every compatible variant and scenario. The default `paired-shuffled` schedule changes cell order deterministically to reduce systematic “first run” effects. Set `temperature: 0`, pin model IDs and profile dependencies, and use objective evaluators whenever possible.

### Multi-episode cold/warm scenarios

```yaml
scenarios:
  - id: coding/auth-memory
    fixture: fixtures/auth
    episodes:
      - id: create
        task: tasks/01-create-auth.md
        state: { workspace: reset, persistent: reset, session: fresh, process: fresh }
      - id: fix
        task: tasks/02-fix-refresh.md
        state: { workspace: retain, persistent: retain, session: fresh, process: restart }
      - id: new-session
        task: tasks/03-change-policy.md
        state: { workspace: retain, persistent: retain, session: fresh, process: restart }
```

This models a cold first episode followed by warm persistent memory while each agent process and session is new. The runner exports `DSH_BENCHUP_STATE_ROOT`; a persistent-memory plugin must use that location to participate in reset/retain control. `session: continue` and `process: reuse` are retained in the public schema but intentionally fail in the MVP instead of producing ambiguous data.

## Objective evaluators

`exact` compares the final child stdout with an expected file; it is best for deliberately minimal reply scenarios. `command` runs explicit argv with no shell. `file` checks workspace file presence. `json` validates a workspace JSON document with JSON Schema via Ajv. Evaluators are `all` by default and may be grouped as `any`.

LLM-as-a-judge is intentionally not included in the MVP. Add it only as a supplemental evaluator with its own pinned judge model and preserved judgement trace; do not use it as the only definition of success.

## Plugin diagnostics

A plugin can register its own numbers through the `benchMetrics` service:

```ts
ctx.benchMetrics.register({
  name: 'memcore.memory_hits',
  unit: 'count',
  aggregation: 'sum',
  dimension: 'diagnostic',
  scope: 'episode',
  description: 'Memory retrievals that produced at least one usable record.',
})
ctx.benchMetrics.add('memcore.memory_hits')
```

Use namespaces such as `memcore.memory_hits`, `context_manager.injected_tokens`, or `tool_router.reroutes`. Definitions and values are persisted with the trace and independently averaged in `comparison.json`.

## Artifacts and safety

Runs go to `.dsh-benchup/runs/<run-id>/` unless `--output` is supplied. The directory includes the expanded configuration, child patch, per-episode summary, raw session event JSONL, result table, comparison, and Markdown report. A trace may include prompts, responses, paths, and tool arguments; treat it as sensitive.

See [the architecture note](docs/architecture.md) for lifecycle details, reproducibility rules, and the current MVP limitation.

## Development

```powershell
pnpm install
pnpm check
pnpm build
pnpm exec dsh-benchup --help
```

## Releases

Pushing a version tag such as `v0.1.1` starts the `Publish to npm` GitHub Actions workflow. It validates and builds with Node 24 before running `npm publish`; it uses npm Trusted Publishing through GitHub OIDC and therefore stores no npm access token in GitHub.

After configuring the trusted publisher once in npm, make a release with:

```powershell
pnpm check
npm version patch -m "release: v%s"
git push --follow-tags
```

Use `minor` or `major` instead of `patch` when SemVer requires it. A tag only publishes a version that does not already exist in npm.

Licensed under [MIT](LICENSE).
