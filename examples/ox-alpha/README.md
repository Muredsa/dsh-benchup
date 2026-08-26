# Ox Alpha baseline

This is a small, objective baseline for [Ox Alpha](https://openrouter.ai/stealth/ox-alpha) through OpenRouter. It checks exact instruction following, workspace file use with JSON output, and a small code repair. The test pins `reasoningEffort: max` and `temperature: 1`, the defaults OpenRouter currently reports for Ox Alpha, so it cannot inherit different settings from another profile.

The experiment is one run so that it is safe as a first smoke test. After it passes, change `runs: 1` to `runs: 3` or `runs: 5` before comparing Harness profiles or plugins.

## One-time setup

`C:\Users\dliba\.dsh\settings.yaml` must contain the canonical model id `stealth/ox-alpha` and the `reasoning: max` provider default on the `openrouter` route. The local setup has already been updated. Keep `OPENROUTER_API_KEY` available to the Harness process.

## Run

From the Harness checkout:

```powershell
$harness = 'C:\Users\dliba\OneDrive\Рабочий стол\deepseek-harness'
$benchmarks = 'C:\Users\dliba\OneDrive\Рабочий стол\dsh-benchup'
$profile = Join-Path $HOME '.dsh\profiles\headless'

Push-Location $profile
try {
  pnpm exec dsh-benchup run (Join-Path $benchmarks 'examples\ox-alpha-baseline.yml') --dsh-source $harness --output (Join-Path $benchmarks '.dsh-benchup')
} finally { Pop-Location }
```

Read `report.md` and `runs.json` in the new `.dsh-benchup\runs\<timestamp>` directory. The report keeps quality, efficiency, and robustness separate.
