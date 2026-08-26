# MemCore benchmark suite

This is a 24-scenario, provider-neutral comparison of the same model without MemCore (`baseline`) and with it (`memcore`). It answers whether persistent external memory improves a fresh agent session, whether it selects the newest fact, and what it costs.

The checked-in configuration currently pins ChatGPT OAuth model `gpt-5.3-codex-spark` at its account-reported default reasoning effort, `high`. Both variants must have `dsh-openai-oauth` installed and use the same signed-in ChatGPT account. The Codex app-server does not expose a temperature control, so the recorded `temperature: 1` is descriptive rather than a provider-side generation setting.

## What it tests

| Group | Scenarios | Objective signal |
| --- | ---: | --- |
| `fact` | 5 | Recall an unguessable fact in a new process and session. |
| `update` | 4 | Return the replacement value and reject a stale value. |
| `exact` | 4 | Reproduce punctuation- and case-sensitive values exactly. |
| `procedure` | 3 | Retrieve a previously approved coding/operations procedure. |
| `multihop` | 3 | Join two separately stored records. |
| `distractor` | 2 | Select a target fact among similar irrelevant records. |
| `control` | 3 | Preserve normal instruction following, JSON writing, and code repair. |

The 21 memory scenarios use fresh workspaces, processes, and sessions for recall. Only the runner-controlled persistent directory is retained. A seed value is never present in the recall workspace, and expected answers are held in `memcore-suite.yml` through `expectedValue`, not in agent-visible files.

`runs: 3` gives 144 comparison cells. Because multi-episode scenarios start a new short-lived agent for each episode, that is 312 child agent runs. This is intentionally a substantial experiment: run it only with a provider budget you accept. For an inexpensive wiring smoke test, temporarily change `runs` to `1`; do not draw a conclusion from one repetition.

## Prepare the two profiles

Run this from a PowerShell session that has the same provider credentials your normal `headless` profile uses:

```powershell
$harness = 'C:\Users\dliba\OneDrive\Рабочий стол\deepseek-harness'
$benchmarks = 'C:\Users\dliba\OneDrive\Рабочий стол\dsh-benchup'

& (Join-Path $benchmarks 'examples\memcore\setup-profiles.ps1') -Harness $harness
```

The script preserves `headless` as the baseline, copies it only if `headless-memcore` does not yet exist, and pins MemCore in that second profile. Both profiles therefore have the same Harness bundles, provider setup, and BenchUp observer.

## Run and read the result

Build the local BenchUp checkout so this suite can use its new evaluator and per-episode-fixture support, then run it through the same profile-local dependency that provides the temporary observer plugin:

```powershell
Set-Location $benchmarks
pnpm build

$output = Join-Path $benchmarks '.dsh-benchup'
node .\dist\cli.js run .\examples\memcore-suite.yml --dsh-source $harness --output $output
```

The CLI prints the run directory. Generate the short decision-oriented report from it:

```powershell
node .\examples\memcore\summarize.mjs 'C:\path\to\.dsh-benchup\runs\<run-id>'
```

It writes `MEMCORE_SCORECARD.md` beside `runs.json`. Inspect the raw `report.md`, `comparison.json`, and per-episode traces for any surprising result.

## Decision rule

MemCore has positive evidence only when all of the following hold:

1. The combined `fact`/`update`/`exact`/`procedure`/`multihop`/`distractor` pass rate is higher than baseline.
2. `control` does not regress materially.
3. The report shows the token, wall-time, tool-call, repeat-work, retry, and error deltas separately; a quality win does not automatically justify a large efficiency loss.

The suite does not treat a higher score as proof by itself. If the memory set does not improve, or controls regress, its result is evidence against the current MemCore design.
