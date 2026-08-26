# DSH BenchUp

[English](README.md) | [Русский](README.ru.md) | [简体中文](README.zh-CN.md)

[![npm version](https://img.shields.io/npm/v/dsh-benchup?logo=npm)](https://www.npmjs.com/package/dsh-benchup)
[![CI](https://github.com/Muredsa/dsh-benchup/actions/workflows/ci.yml/badge.svg)](https://github.com/Muredsa/dsh-benchup/actions/workflows/ci.yml)
[![license](https://img.shields.io/npm/l/dsh-benchup)](LICENSE)
[![Node.js](https://img.shields.io/node/v/dsh-benchup)](package.json)

> Reproducible, profile-aware benchmarks for [DeepSeek Harness](https://github.com/deepseek-ai/DeepSeek-Harness).

DSH BenchUp answers one practical question: **did this change make the agent better, or merely more expensive?** It runs the same scenarios across models, profiles, prompts, compaction strategies, subagent setups, and plugins — then compares the evidence without collapsing it into a single misleading score.

## What it measures

| Dimension | Signals |
| --- | --- |
| **Quality** | task success, exact output, tests, files, JSON Schema |
| **Efficiency** | input/output tokens, LLM turns, tool calls, repeated work, wall time |
| **Robustness** | retries, errors, timeouts, variance across repetitions |
| **Diagnostics** | namespaced metrics contributed by the plugin under test |

## Quick start

BenchUp has a CLI and a temporary observer plugin. Install [`dsh-benchup` from npm](https://www.npmjs.com/package/dsh-benchup) into every Harness profile that a benchmark starts; it is deliberately a plain dependency, not an always-on `dsh.bundle`, so normal sessions are never traced.

### Installed Harness

When `dsh` is installed on your `PATH`, use its profile-aware installer. It initializes the built-in `headless` profile on first use and works whether or not `DSH_HOME` is set:

```powershell
dsh plugin --profile headless add dsh-benchup
```

DSH may print `declares no dsh.bundle`; that is expected for BenchUp. Resolve the profile directory with the same fallback DSH uses, then run the installed local CLI:

```powershell
$dshHome = if ([string]::IsNullOrWhiteSpace($env:DSH_HOME)) { Join-Path $HOME '.dsh' } else { $env:DSH_HOME }
$profile = Join-Path $dshHome 'profiles\headless'
$experiment = 'C:\path\to\benchmarks\examples\basic-experiment.yml'
$output = 'C:\path\to\benchmarks\.dsh-benchup'

Push-Location $profile
try { pnpm exec dsh-benchup run $experiment --output $output } finally { Pop-Location }
```

The included `basic-experiment.yml` is a one-run smoke benchmark using only `headless`; it needs the model credentials and default provider that your Harness profile normally uses.

### Harness source checkout

For a cloned Harness repository, do not run `pnpm dsh` from an arbitrary directory. Run the installer from the checkout, then pass `--dsh-source` to BenchUp. This invokes the checkout's `node --import tsx/esm` launcher while still giving the agent an isolated benchmark workspace:

```powershell
$harness = 'C:\path\to\deepseek-harness'
$benchmarks = 'C:\path\to\dsh-benchup'

Set-Location $harness
pnpm dsh plugin --profile headless add dsh-benchup

$dshHome = if ([string]::IsNullOrWhiteSpace($env:DSH_HOME)) { Join-Path $HOME '.dsh' } else { $env:DSH_HOME }
$profile = Join-Path $dshHome 'profiles\headless'
Push-Location $profile
try {
  pnpm exec dsh-benchup run (Join-Path $benchmarks 'examples\basic-experiment.yml') --dsh-source $harness --output (Join-Path $benchmarks '.dsh-benchup')
} finally { Pop-Location }
```

`--dsh <command>` remains available when a non-default `dsh` executable is already available. It and `--dsh-source` are mutually exclusive.

### Compare profiles

Create an experiment profile by copying the initialized baseline profile, then install the variant under test. Copying preserves the `headless` bundle stack; creating an arbitrary new profile with `dsh plugin` alone starts from the minimal base stack and cannot run headless tasks.

```powershell
$baseline = Join-Path $dshHome 'profiles\headless'
$experimentProfile = Join-Path $dshHome 'profiles\headless-experiment'
if (-not (Test-Path $experimentProfile)) { Copy-Item $baseline $experimentProfile -Recurse }

dsh plugin --profile headless-experiment add dsh-memcore
```

Install BenchUp into any profile that was not copied from an already configured profile. To try an unreleased BenchUp revision, substitute `github:Muredsa/dsh-benchup` for `dsh-benchup` in the installation command.

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

Pushing a version tag such as `v0.1.2` starts the `Publish to npm` GitHub Actions workflow. It validates and builds with Node 24 before running `npm publish`; it uses npm Trusted Publishing through GitHub OIDC and therefore stores no npm access token in GitHub.

After configuring the trusted publisher once in npm, make a release with:

```powershell
pnpm check
npm version patch -m "release: v%s"
git push --follow-tags
```

Use `minor` or `major` instead of `patch` when SemVer requires it. A tag only publishes a version that does not already exist in npm.

Licensed under [MIT](LICENSE).
