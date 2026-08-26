# DSH BenchUp

[English](README.md) | [Русский](README.ru.md) | [简体中文](README.zh-CN.md)

[![npm 版本](https://img.shields.io/npm/v/dsh-benchup?logo=npm)](https://www.npmjs.com/package/dsh-benchup)
[![CI](https://github.com/Muredsa/dsh-benchup/actions/workflows/ci.yml/badge.svg)](https://github.com/Muredsa/dsh-benchup/actions/workflows/ci.yml)
[![许可证](https://img.shields.io/npm/l/dsh-benchup)](LICENSE)
[![Node.js](https://img.shields.io/node/v/dsh-benchup)](package.json)

> 面向 DeepSeek Harness 的、可复现且理解 profile 配置的 benchmark 工具。

DSH BenchUp 回答一个实际问题：**这项改动让 agent 变好了，还是只是变贵了？** 它会在模型、profile、prompt、compaction 策略、subagent 方案和插件之间运行相同场景，并展示证据，而不是把结果压缩成一个容易误导的总分。

## 衡量什么

| 维度 | 信号 |
| --- | --- |
| **质量** | 任务成功、精确输出、测试、文件、JSON Schema |
| **效率** | 输入/输出 token、LLM turns、tool calls、重复工作、wall time |
| **稳健性** | retries、错误、timeouts、多次运行的方差 |
| **诊断数据** | 被测插件提供的带命名空间指标 |

## 快速开始

BenchUp 包含 CLI 和一个临时 observer 插件。请把 [`dsh-benchup` 从 npm](https://www.npmjs.com/package/dsh-benchup) 安装到每个 benchmark 会启动的 Harness profile 中。它有意保持为普通 dependency，而不是始终启用的 `dsh.bundle`，因此正常 session 不会被记录。

### 已安装的 Harness

当 `dsh` 已在 `PATH` 中时，使用 profile 感知的安装命令。首次使用时它会初始化内置的 `headless` profile，且不依赖 `DSH_HOME` 是否设置：

```powershell
dsh plugin --profile headless add dsh-benchup
```

DSH 可能输出 `declares no dsh.bundle`；这对 BenchUp 是预期行为。按 DSH 相同的回退规则定位 profile 目录，然后运行本地 CLI：

```powershell
$dshHome = if ([string]::IsNullOrWhiteSpace($env:DSH_HOME)) { Join-Path $HOME '.dsh' } else { $env:DSH_HOME }
$profile = Join-Path $dshHome 'profiles\headless'
$experiment = 'C:\path\to\benchmarks\examples\basic-experiment.yml'
$output = 'C:\path\to\benchmarks\.dsh-benchup'

Push-Location $profile
try { pnpm exec dsh-benchup run $experiment --output $output } finally { Pop-Location }
```

自带的 `basic-experiment.yml` 是只使用 `headless` 的单次 smoke benchmark。它需要您的 Harness profile 平时使用的模型 credentials 和默认 provider。

### Harness 源码 checkout

对于克隆的 Harness 仓库，不要从任意目录运行 `pnpm dsh`。请从 checkout 根目录安装包，并向 BenchUp 传入 `--dsh-source`。它会使用 `node --import tsx/esm` 的源码 launcher，同时仍将隔离后的 benchmark 目录作为 agent workspace：

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

当需要非默认的 `dsh` 可执行文件时，仍可使用 `--dsh <command>`；它不能与 `--dsh-source` 同时使用。

### 比较 profiles

复制已初始化的 baseline profile 来创建实验 profile，然后安装待测改动。复制会保留 `headless` bundle stack；仅通过 `dsh plugin` 创建任意新 profile 时，它从最小的 base stack 开始，无法运行 headless 任务。

```powershell
$baseline = Join-Path $dshHome 'profiles\headless'
$experimentProfile = Join-Path $dshHome 'profiles\headless-experiment'
if (-not (Test-Path $experimentProfile)) { Copy-Item $baseline $experimentProfile -Recurse }

dsh plugin --profile headless-experiment add dsh-memcore
```

对于并非从已配置 profile 复制而来的 profile，请单独安装 BenchUp。若要测试尚未发布的 BenchUp revision，请在安装命令中将 `dsh-benchup` 替换为 `github:Muredsa/dsh-benchup`。

本版本支持的命令是 `dsh-benchup`。未来的 Harness application bundle 可以提供简写 `dsh benchup`，而无需修改 experiment 文件。

## Experiment 格式

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

每个模型都会运行每个兼容的 variant 和 scenario。默认的 `paired-shuffled` 调度会确定性地改变 cell 顺序，以降低“先运行”带来的系统性影响。请固定 model ID、temperature 和 profile dependency 版本，并尽可能使用客观的 evaluators。

### 多 episode 的 cold/warm scenarios

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

这表示第一个 episode 为 cold，随后在每个 episode 都使用新 agent process 和新 session 的前提下保留 persistent memory。Runner 会导出 `DSH_BENCHUP_STATE_ROOT`；persistent-memory 插件必须使用该位置，才能参与可控的 reset/retain。公共 schema 保留 `session: continue` 和 `process: reuse`，但 MVP 会明确报错，而不会生成含义不清的数据。

## 客观 evaluators

`exact` 将子进程最终 stdout 与预期文件比较。`command` 以显式 argv 运行，不使用 shell。`file` 检查 workspace 中的文件是否存在。`json` 通过 Ajv 按 JSON Schema 验证 workspace JSON 文档。默认情况下 evaluators 使用 `all`；也可以组合为 `any`。

MVP 有意不包含 LLM-as-a-judge。若需使用，请只把它作为补充 evaluator，并固定 judge model、保存评判 trace；不要把它作为唯一成功标准。

## 插件诊断指标

插件可通过 `benchMetrics` 服务注册自己的数值指标：

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

请使用类似 `memcore.memory_hits`、`context_manager.injected_tokens` 或 `tool_router.reroutes` 的 namespace。Definitions 和 values 会随 trace 保存，并在 `comparison.json` 中独立求平均值。

## Artifacts 与安全性

未指定 `--output` 时，结果位于 `.dsh-benchup/runs/<run-id>/`。目录包含规范化 experiment、child patch、每个 episode 的 summary、原始 session event JSONL、运行结果表、comparison 和 Markdown report。Trace 可能包含 prompts、responses、路径和 tool arguments，请将其视为敏感的工程数据。

关于 lifecycle、可复现性规则和当前 MVP 限制，请参阅 [architecture note](docs/architecture.md)。

## 开发

```powershell
pnpm install
pnpm check
pnpm build
node dist/cli.js --help
```

## 发布

推送版本 tag（例如 `v0.1.2`）会启动 GitHub Actions 的 `Publish to npm` workflow。它会在 Node 24 上验证并构建包，然后通过 npm Trusted Publishing 和 GitHub OIDC 执行 `npm publish`；GitHub 中不保存 npm access token。

完成一次 trusted publisher 配置后，按以下方式发布：

```powershell
pnpm check
npm version patch -m "release: v%s"
git push --follow-tags
```

当 SemVer 需要时，请将 `patch` 替换为 `minor` 或 `major`。一个 tag 只能发布 npm 中尚不存在的版本。

许可证：[MIT](LICENSE)。
