#!/usr/bin/env node
/**
 * Bundle each offline test with esbuild and run it under Node. These need no
 * Logseq: they are the CI gate. The live tier is tests/live/run.mjs.
 */
import { build } from 'esbuild'
import { execFileSync } from 'node:child_process'
import { mkdirSync } from 'node:fs'

const TESTS = ['tests/entities.ts', 'tests/assets.ts', 'tests/smoke.ts']
const outDir = 'node_modules/.cache/unit'
mkdirSync(outDir, { recursive: true })

let failed = 0
for (const entry of TESTS) {
  const outfile = `${outDir}/${entry.replace(/\W+/g, '_')}.mjs`
  await build({ entryPoints: [entry], bundle: true, platform: 'node', format: 'esm', outfile, logLevel: 'error' })
  console.log(`\n▶ ${entry}`)
  try {
    execFileSync(process.execPath, [outfile], { stdio: 'inherit' })
  } catch {
    failed++
  }
}
if (failed) {
  console.error(`\n${failed} test file(s) failed`)
  process.exit(1)
}
