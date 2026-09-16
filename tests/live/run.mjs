#!/usr/bin/env node
/**
 * Live regression suite: drive real Logseq builds, export, and check the book.
 *
 * Local-only by design: it needs Logseq binaries, so CI cannot run it. The
 * smoke test (npm test) is the CI gate; this tier proves the plugin works
 * against what each build's API really returns.
 *
 *   npm run test:live                  # every available target
 *   npm run test:live -- --target=og   # one target
 *
 *   LOGSEQ_OG_BIN   path to the Logseq OG binary
 *   LOGSEQ_DB_BIN   path to a Logseq 2.x binary
 *
 * It loads the plugin from this repo's dist/, so run `npm run build` first
 * (`npm run test:live` does).
 */
import { resolveTargets } from '../lib/targets.mjs'
import { launch, teardown } from '../lib/scratch.mjs'
import { cases } from './cases.mjs'

// --install=marketplace installs the built plugin the way a marketplace or
// release-zip install does, instead of loading the repo unpacked.
const install = process.argv.find((a) => a.startsWith('--install='))?.slice('--install='.length) ?? 'unpacked'

const requested = process.argv
  .slice(2)
  .filter((a) => a.startsWith('--target='))
  .flatMap((a) => a.slice('--target='.length).split(','))
  .filter(Boolean)

const green = (s) => `\x1b[32m${s}\x1b[0m`
const red = (s) => `\x1b[31m${s}\x1b[0m`
const dim = (s) => `\x1b[2m${s}\x1b[0m`

let failures = 0
let ran = 0
let skipped = 0

for (const target of resolveTargets(requested)) {
  console.log(`\n${target.label}`)
  if (!target.available) {
    console.log(`  ${dim(`skipped — ${target.unavailableReason}`)}`)
    skipped += cases.length
    continue
  }

  let session
  try {
    session = await launch(target, { install })
    const version = await session.cdp.evaluate(`(async () => (await logseq.api.get_app_info?.())?.version ?? 'unknown')()`)
    console.log(`  ${dim(`version ${version}, ${install} install`)}`)
    const ctx = {}
    for (const c of cases) {
      try {
        const outcome = await c.run({ cdp: session.cdp, session, target, ctx })
        if (outcome?.skipped) {
          console.log(`  ${dim(`skip  ${c.name}`)}`)
          console.log(`        ${dim(outcome.skipped)}`)
          skipped++
          continue
        }
        console.log(`  ${green('pass')}  ${c.name}`)
      } catch (err) {
        console.log(`  ${red('FAIL')}  ${c.name}`)
        console.log(`        ${err.message.split('\n').join('\n        ')}`)
        failures++
      }
      ran++
    }
  } catch (err) {
    console.log(`  ${red('FAIL')}  could not start the target`)
    console.log(`        ${err.message.split('\n')[0]}`)
    failures++
  } finally {
    if (session) teardown(session)
  }
}

console.log(`\n${'-'.repeat(52)}`)
console.log(`ran ${ran}   failed ${failures}   skipped ${skipped}`)
process.exit(failures > 0 ? 1 : 0)
