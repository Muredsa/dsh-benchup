import { existsSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

/** A fully specified Node invocation for a DSH checkout launched from source. */
export interface SourceDshLaunch {
  command: string
  args: string[]
  cwd: string
}

/**
 * Build the Node invocation for an unbuilt DeepSeek Harness checkout.
 *
 * Node resolves the `tsx/esm` preload from the checkout, then the bootstrap changes into the
 * isolated benchmark workspace before importing DSH's TypeScript entry point. This preserves the
 * source launcher's module-resolution rules without making the agent treat the checkout as its
 * workspace.
 * @param sourceRoot - DeepSeek Harness repository root.
 * @param workspace - Isolated benchmark workspace supplied to the child agent.
 * @param dshArgs - Arguments for the ordinary DSH launcher.
 * @returns Node command, arguments, and the cwd used to resolve the source loader.
 */
export function sourceDshLaunch(sourceRoot: string, workspace: string, dshArgs: readonly string[]): SourceDshLaunch {
  const root = resolve(sourceRoot)
  const entry = join(root, 'apps', 'cli', 'src', 'bin.ts')
  requireFile(root, 'package.json', 'the Harness package manifest')
  requireFile(root, join('apps', 'cli', 'src', 'bin.ts'), 'the DSH TypeScript entry point')
  requireFile(root, join('node_modules', 'tsx', 'package.json'), 'the tsx source loader; run pnpm install in the Harness checkout')

  const entryUrl = pathToFileURL(entry).href
  const bootstrap = [
    `process.chdir(${JSON.stringify(resolve(workspace))})`,
    `process.argv = [process.execPath, ${JSON.stringify(entry)}, ...${JSON.stringify(dshArgs)}]`,
    `await import(${JSON.stringify(entryUrl)})`,
  ].join('; ')
  return {
    command: process.execPath,
    args: ['--import', 'tsx/esm', '--input-type=module', '--eval', bootstrap],
    cwd: root,
  }
}

/** Ensures a required checkout file exists before starting an opaque child process. */
function requireFile(root: string, relativePath: string, purpose: string): void {
  if (!existsSync(join(root, relativePath))) {
    throw new Error(`Invalid --dsh-source directory ${root}: missing ${purpose} (${relativePath}).`)
  }
}
