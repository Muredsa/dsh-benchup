import { readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

const runDirectory = process.argv[2]
if (runDirectory === undefined) throw new Error('Usage: node summarize.mjs <run-directory>')

const root = resolve(runDirectory)
const results = JSON.parse(readFileSync(join(root, 'runs.json'), 'utf8'))
if (!Array.isArray(results)) throw new Error('runs.json must contain an array')

const variants = new Set(results.map((result) => result.variant))
if (!variants.has('baseline') || !variants.has('memcore')) {
  throw new Error('The scorecard requires baseline and memcore variants in runs.json')
}

const category = (scenario) => scenario.split('/', 1)[0] ?? 'other'
const memoryCategories = new Set(['fact', 'update', 'exact', 'procedure', 'multihop', 'distractor'])
const groups = new Map()
for (const result of results) {
  const name = category(result.scenario)
  for (const key of [name, memoryCategories.has(name) ? 'memory-total' : undefined, 'suite-total']) {
    if (key === undefined) continue
    const cells = groups.get(key) ?? []
    cells.push(result)
    groups.set(key, cells)
  }
}

const metricNames = ['inputTokens', 'outputTokens', 'llmTurns', 'toolCalls', 'durationMs', 'repeatedFileReads', 'repeatedSearches', 'repeatedCommands', 'duplicateToolCalls', 'retries', 'errors']
const mean = (values) => values.length === 0 ? 0 : values.reduce((sum, value) => sum + value, 0) / values.length
const summary = (cells) => ({
  runs: cells.length,
  passRate: mean(cells.map((cell) => Number(cell.passed))),
  metrics: Object.fromEntries(metricNames.map((name) => [name, mean(cells.map((cell) => name === 'durationMs' ? cell.durationMs : cell.coreMetrics[name] ?? 0))])),
  custom: Object.fromEntries([...new Set(cells.flatMap((cell) => Object.keys(cell.customMetrics ?? {})))].sort().map((name) => [name, mean(cells.map((cell) => cell.customMetrics?.[name] ?? 0))])),
})
const byVariant = (cells, variant) => summary(cells.filter((cell) => cell.variant === variant))
const percent = (value) => `${(value * 100).toFixed(1)}%`
const signed = (value, digits = 2) => `${value >= 0 ? '+' : ''}${value.toFixed(digits)}`

const lines = [
  '# MemCore benchmark scorecard',
  '',
  `Source: \`${root}\``,
  '',
  '## Quality',
  '',
  '| Group | Baseline pass rate | MemCore pass rate | Delta | Cells / variant |',
  '| --- | ---: | ---: | ---: | ---: |',
]
for (const name of [...groups.keys()].sort()) {
  const baseline = byVariant(groups.get(name), 'baseline')
  const memcore = byVariant(groups.get(name), 'memcore')
  lines.push(`| ${name} | ${percent(baseline.passRate)} | ${percent(memcore.passRate)} | ${signed((memcore.passRate - baseline.passRate) * 100)} pp | ${baseline.runs} |`)
}

const memoryBaseline = byVariant(groups.get('memory-total') ?? [], 'baseline')
const memoryMemcore = byVariant(groups.get('memory-total') ?? [], 'memcore')
const controlCells = groups.get('control') ?? []
const controlBaseline = byVariant(controlCells, 'baseline')
const controlMemcore = byVariant(controlCells, 'memcore')
const memoryDelta = memoryMemcore.passRate - memoryBaseline.passRate
const controlDelta = controlMemcore.passRate - controlBaseline.passRate

lines.push('', '## Efficiency and robustness', '', '| Metric | Baseline | MemCore | Delta (MemCore − baseline) |', '| --- | ---: | ---: | ---: |')
const suiteBaseline = byVariant(groups.get('suite-total') ?? [], 'baseline')
const suiteMemcore = byVariant(groups.get('suite-total') ?? [], 'memcore')
for (const name of metricNames) {
  const base = suiteBaseline.metrics[name]
  const mem = suiteMemcore.metrics[name]
  lines.push(`| ${name} | ${base.toFixed(2)} | ${mem.toFixed(2)} | ${signed(mem - base)} |`)
}
for (const name of Object.keys(suiteMemcore.custom).sort()) {
  const base = suiteBaseline.custom[name] ?? 0
  const mem = suiteMemcore.custom[name]
  lines.push(`| ${name} | ${base.toFixed(2)} | ${mem.toFixed(2)} | ${signed(mem - base)} |`)
}

let verdict
if (controlCells.length === 0) {
  verdict = 'This run is a wiring smoke test, not evidence of an overall improvement: it has no control scenarios. Run the full suite before drawing a quality conclusion.'
} else if (memoryDelta > 0 && controlDelta >= -0.05) {
  verdict = 'Evidence supports the current MemCore design: memory-task quality improved without a material control-task regression. Decide separately whether the listed efficiency cost is acceptable.'
} else if (memoryDelta <= 0) {
  verdict = 'The benchmark does not support the current MemCore design: memory-task quality did not improve over baseline. Inspect traces before changing the design or increasing the memory budget.'
} else {
  verdict = 'Memory-task quality improved, but controls regressed materially. Treat this as a trade-off or regression, not a clear win.'
}
lines.push('', '## Verdict', '', verdict, '')

const output = join(root, 'MEMCORE_SCORECARD.md')
writeFileSync(output, lines.join('\n'), 'utf8')
process.stdout.write(`${output}\n`)
