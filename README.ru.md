# DSH BenchUp

[English](README.md) | [Русский](README.ru.md) | [简体中文](README.zh-CN.md)

[![версия npm](https://img.shields.io/npm/v/dsh-benchup?logo=npm)](https://www.npmjs.com/package/dsh-benchup)
[![CI](https://github.com/Muredsa/dsh-benchup/actions/workflows/ci.yml/badge.svg)](https://github.com/Muredsa/dsh-benchup/actions/workflows/ci.yml)
[![лицензия](https://img.shields.io/npm/l/dsh-benchup)](LICENSE)
[![Node.js](https://img.shields.io/node/v/dsh-benchup)](package.json)

> Воспроизводимые benchmark-тесты DeepSeek Harness с учётом профиля и конфигурации.

DSH BenchUp отвечает на практический вопрос: **стало ли изменение лучше, или агент просто стал дороже?** Он запускает одинаковые сценарии для моделей, профилей, prompt'ов, стратегий compaction, subagent-схем и плагинов, после чего показывает сравнение без искусственного единого score.

## Что измеряет BenchUp

| Измерение | Показатели |
| --- | --- |
| **Качество** | успех задачи, точное совпадение ответа, тесты, файлы, JSON Schema |
| **Эффективность** | input/output tokens, LLM turns, tool calls, повторная работа, wall time |
| **Надёжность** | retries, ошибки, timeouts, разброс между повторами |
| **Диагностика** | namespaced-метрики от проверяемого плагина |

## Установка

```sh
npm i dsh-benchup
```

Для benchmark в Harness пакет должен быть установлен в каждый запускаемый profile. Команды ниже запускают установку через DSH, поэтому dependency попадёт в правильный каталог profile.

## Быстрый запуск

BenchUp состоит из CLI и временного observer-плагина. Установите [`dsh-benchup` из npm](https://www.npmjs.com/package/dsh-benchup) в каждый профиль Harness, который будет запущен в benchmark. Это намеренно обычная dependency, а не всегда активный `dsh.bundle`: обычные сессии не записывают traces.

### Установленный Harness

Если `dsh` находится в `PATH`, используйте штатную установку в профиль. Она создаст встроенный `headless` profile при первом запуске и работает независимо от того, задан ли `DSH_HOME`:

```powershell
dsh plugin --profile headless add dsh-benchup
```

DSH может вывести `declares no dsh.bundle`; для BenchUp это нормально. Определите каталог профиля по тем же правилам, что и DSH, затем запустите локальный CLI:

```powershell
$dshHome = if ([string]::IsNullOrWhiteSpace($env:DSH_HOME)) { Join-Path $HOME '.dsh' } else { $env:DSH_HOME }
$profile = Join-Path $dshHome 'profiles\headless'
$experiment = 'C:\path\to\benchmarks\examples\basic-experiment.yml'
$output = 'C:\path\to\benchmarks\.dsh-benchup'

Push-Location $profile
try { pnpm exec dsh-benchup run $experiment --output $output } finally { Pop-Location }
```

Встроенный `basic-experiment.yml` — smoke benchmark из одного запуска через `headless`. Для него нужны те же credentials и provider по умолчанию, которые обычно использует ваш профиль Harness.

### Checkout исходников Harness

Для клона Harness не запускайте `pnpm dsh` из произвольной папки. Установите пакет из root checkout, затем передайте BenchUp `--dsh-source`. Он использует source launcher `node --import tsx/esm`, но сохраняет отдельную benchmark-папку как workspace агента:

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

`--dsh <command>` остаётся доступен, если вам нужен нестандартный исполняемый файл `dsh`; вместе с `--dsh-source` его использовать нельзя.

### Сравнение профилей

Создайте экспериментальный profile копированием готового baseline profile и установите в него проверяемую модификацию. Копирование сохраняет headless bundle stack. Новый произвольный profile, созданный только через `dsh plugin`, начинается с минимального base stack и не может выполнять headless-задачи.

```powershell
$baseline = Join-Path $dshHome 'profiles\headless'
$experimentProfile = Join-Path $dshHome 'profiles\headless-experiment'
if (-not (Test-Path $experimentProfile)) { Copy-Item $baseline $experimentProfile -Recurse }

dsh plugin --profile headless-experiment add dsh-memcore
```

Установите BenchUp в любой profile, который не был скопирован с уже настроенного profile. Чтобы испытать ещё не опубликованную ревизию BenchUp, замените `dsh-benchup` на `github:Muredsa/dsh-benchup` в команде установки.

В этом релизе поддерживаемая команда — `dsh-benchup`. Будущий application bundle Harness сможет добавить короткий alias `dsh benchup`, не меняя experiment-файлы.

## Формат эксперимента

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

Каждая модель запускается для каждого совместимого variant и scenario. Расписание `paired-shuffled` по умолчанию детерминированно меняет порядок ячеек, уменьшая эффект «первого запуска». Для честного сравнения фиксируйте model IDs, temperature и версии dependencies профилей, а качество оценивайте объективными evaluators.

### Многоэпизодные cold/warm scenarios

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

Так описывается холодный первый эпизод и тёплая persistent memory при новом процессе и новой сессии агента в каждом эпизоде. Runner экспортирует `DSH_BENCHUP_STATE_ROOT`; persistent-memory плагин должен использовать этот путь для управляемого reset/retain. Поля `session: continue` и `process: reuse` есть в публичной schema, но в MVP намеренно завершаются ошибкой, а не создают двусмысленные данные.

## Объективные evaluators

`exact` сравнивает финальный stdout дочернего процесса с ожидаемым файлом. `command` запускает явный argv без shell. `file` проверяет наличие файла в workspace. `json` проверяет JSON-документ по JSON Schema через Ajv. По умолчанию evaluators объединяются как `all`; их можно сгруппировать как `any`.

LLM-as-a-judge сознательно не входит в MVP. Добавляйте его только как дополнительный evaluator с закреплённой judge-моделью и сохранённым trace оценки, но не как единственный критерий успеха.

## Диагностика плагинов

Плагин может зарегистрировать собственные числовые метрики через сервис `benchMetrics`:

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

Используйте namespaces наподобие `memcore.memory_hits`, `context_manager.injected_tokens` и `tool_router.reroutes`. Definitions и values сохраняются в trace и независимо усредняются в `comparison.json`.

## Артефакты и безопасность

Результаты сохраняются в `.dsh-benchup/runs/<run-id>/`, если не указан `--output`. Каталог включает нормализованный experiment, child patches, summary каждого эпизода, raw session event JSONL, таблицу запусков, comparison и Markdown report. Trace может содержать prompts, responses, пути и tool arguments, поэтому обращайтесь с ним как с чувствительными инженерными данными.

Подробнее о lifecycle, воспроизводимости и ограничениях MVP: [architecture note](docs/architecture.md).

## Разработка

```powershell
pnpm install
pnpm check
pnpm build
node dist/cli.js --help
```

## Релизы

Push version tag, например `v0.1.2`, запускает GitHub Actions workflow `Publish to npm`. Он проверяет и собирает пакет в Node 24, затем выполняет `npm publish` через npm Trusted Publishing и GitHub OIDC; npm access token в GitHub не хранится.

После однократной настройки trusted publisher выпускайте новую версию так:

```powershell
pnpm check
npm version patch -m "release: v%s"
git push --follow-tags
```

Используйте `minor` или `major` вместо `patch`, когда этого требует SemVer. Один tag публикует только версию, которой ещё нет в npm.

Лицензия: [MIT](LICENSE).
