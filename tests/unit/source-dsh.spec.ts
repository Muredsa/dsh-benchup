import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { sourceDshLaunch } from '../../src/runner/source-dsh.js'

describe('sourceDshLaunch', () => {
  it('resolves tsx from the checkout and changes into the benchmark workspace before DSH imports', () => {
    const root = mkdtempSync(join(tmpdir(), 'dsh-benchup-source-'))
    mkdirSync(join(root, 'apps', 'cli', 'src'), { recursive: true })
    mkdirSync(join(root, 'node_modules', 'tsx'), { recursive: true })
    writeFileSync(join(root, 'package.json'), '{}')
    writeFileSync(join(root, 'apps', 'cli', 'src', 'bin.ts'), '')
    writeFileSync(join(root, 'node_modules', 'tsx', 'package.json'), '{}')

    const launch = sourceDshLaunch(root, join(root, 'workspace'), ['--profile', 'headless', 'task'])

    expect(launch.command).toBe(process.execPath)
    expect(launch.cwd).toBe(resolve(root))
    expect(launch.args.slice(0, 3)).toEqual(['--import', 'tsx/esm', '--input-type=module'])
    expect(launch.args.at(-1)).toContain(`process.chdir(${JSON.stringify(resolve(root, 'workspace'))})`)
    expect(launch.args.at(-1)).toContain('"--profile","headless","task"')
  })

  it('rejects a directory that cannot run the Harness source launcher', () => {
    const root = mkdtempSync(join(tmpdir(), 'dsh-benchup-source-'))
    expect(() => sourceDshLaunch(root, join(root, 'workspace'), [])).toThrow('missing the Harness package manifest')
  })
})
