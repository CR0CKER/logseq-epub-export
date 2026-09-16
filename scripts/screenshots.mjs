#!/usr/bin/env node
/**
 * Retake the README screenshots.
 *
 *   npm run build && node scripts/screenshots.mjs [--target=legacy]
 *
 * 1. screenshots/panel.png: Logseq (the released 0.10.15 by default) with the
 *    live-test graph open on a page and the export panel after an export.
 * 2. screenshots/book.png: the generated cover and one chapter of that very
 *    EPUB, rendered with the book's own stylesheet at e-reader proportions
 *    inside the same Logseq window (a browser rendering, not KOReader). Not
 *    the Chromium flatpak: its sandboxed fontconfig renders plain "Georgia" in
 *    the italic face.
 *
 * Uses the live suite's isolated launch, so nothing real is touched.
 */
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import JSZip from 'jszip'
import { resolveTargets } from '../tests/lib/targets.mjs'
import { launch, teardown, openFileGraph, PLUGIN_ID } from '../tests/lib/scratch.mjs'
import { waitFor } from '../tests/lib/cdp.mjs'
import { writeFileGraph, seedDbGraph, EXPECT } from '../tests/live/fixture.mjs'

const REPO = new URL('..', import.meta.url).pathname
const OUT = join(REPO, 'screenshots')
const id = process.argv.find((a) => a.startsWith('--target='))?.slice(9) ?? 'legacy'
const [target] = resolveTargets([id])
if (!target.available) throw new Error(target.unavailableReason)
mkdirSync(OUT, { recursive: true })

const FRAME = `document.querySelector('iframe#${PLUGIN_ID}_iframe')`
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function click(cdp, expr) {
  const [x, y] = JSON.parse(await cdp.evaluate(`(() => { const b = (${expr}).getBoundingClientRect(); return JSON.stringify([b.left + b.width / 2, b.top + b.height / 2]) })()`))
  for (const type of ['mousePressed', 'mouseReleased']) await cdp.call('Input.dispatchMouseEvent', { type, x, y, button: 'left', clickCount: 1 })
}

const session = await launch(target)
try {
  const { cdp } = session
  await cdp.call('Emulation.setDeviceMetricsOverride', { width: 1280, height: 800, deviceScaleFactor: 1.5, mobile: false })
  let graphPath
  if (target.id === 'db') {
    await waitFor(cdp, `(async () => Boolean((await logseq.api.get_current_graph())?.path))()`, { timeoutMs: 45000 })
    await seedDbGraph(cdp)
    graphPath = JSON.parse(await cdp.evaluate(`(async () => JSON.stringify(await logseq.api.get_current_graph()))()`)).path
  } else {
    graphPath = writeFileGraph(join(session.root, 'Change Management'))
    await openFileGraph(session, graphPath)
  }
  await waitFor(cdp, `(async () => Boolean(await logseq.api.get_page('ADKAR')))()`, { timeoutMs: 45000, label: 'the graph to index' })
  await cdp.evaluate(`location.hash = '#/page/' + encodeURIComponent('ADKAR'); true`)
  await sleep(3000)

  // Toolbar icon → panel → Export now, with real clicks.
  await click(cdp, `document.querySelector('a[data-on-click="openPanel"]')`)
  await waitFor(cdp, `Boolean(${FRAME}?.contentDocument?.querySelector('#ee-export')) && ${FRAME}.offsetParent !== null`, { timeoutMs: 15000 })
  const f = await cdp.evaluate(`JSON.stringify(${FRAME}.getBoundingClientRect())`)
  const fb = JSON.parse(f)
  const [bx, by] = JSON.parse(await cdp.evaluate(`(() => { const b = ${FRAME}.contentDocument.querySelector('#ee-export').getBoundingClientRect(); return JSON.stringify([b.left + b.width / 2, b.top + b.height / 2]) })()`))
  for (const type of ['mousePressed', 'mouseReleased']) await cdp.call('Input.dispatchMouseEvent', { type, x: fb.x + bx, y: fb.y + by, button: 'left', clickCount: 1 })
  await waitFor(cdp, `${FRAME}.contentDocument.querySelector('#ee-log').textContent.includes('Saved:')`, { timeoutMs: 60000, label: 'the export to finish' })
  await cdp.call('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 5, y: 790 })
  await sleep(800)
  const shot = await cdp.call('Page.captureScreenshot', { format: 'png' })
  writeFileSync(join(OUT, 'panel.png'), Buffer.from(shot.data, 'base64'))

  const dir = join(graphPath, 'assets/storages', PLUGIN_ID)
  const zip = await JSZip.loadAsync(readFileSync(join(dir, readdirSync(dir).find((n) => n.endsWith('.epub')))))
  const files = Object.keys(zip.files)
  let chapter = null
  for (const n of files.filter((f) => f.endsWith('.xhtml'))) {
    const x = await zip.file(n).async('string')
    if (x.includes(`<h1>${EXPECT.pages[0]}</h1>`)) chapter = x
  }
  const css = await zip.file('OEBPS/style.css').async('string')
  const coverName = files.find((n) => /OEBPS\/cover\.(jpe?g|png)$/.test(n))
  const coverUrl = `data:image/${coverName.endsWith('png') ? 'png' : 'jpeg'};base64,${await zip.file(coverName).async('base64')}`
  const chapterDoc = chapter.replace(/<link rel="stylesheet"[^>]*\/>/, `<style>${css}</style>`)

  // Close the panel and lay the two "devices" over the Logseq window.
  await cdp.evaluate(`${FRAME}.contentDocument.querySelector('#ee-close').click(); true`)
  await waitFor(cdp, `${FRAME}.offsetParent === null`, { timeoutMs: 10000 })
  const size = JSON.parse(await cdp.evaluate(`(() => {
    const sheet = document.createElement('div')
    sheet.id = 'epub-shot'
    sheet.style.cssText = 'position:fixed;left:0;top:0;z-index:2147483647;background:#d9dde1;display:flex;gap:40px;padding:40px;'
    const device = (inner) => { const d = document.createElement('div'); d.style.cssText = 'background:#fbfbf8;border-radius:18px;padding:22px;box-shadow:0 8px 30px rgba(0,0,0,.25)'; d.appendChild(inner); return d }
    const img = document.createElement('img'); img.src = ${JSON.stringify(coverUrl)}
    img.style.cssText = 'display:block;width:450px;height:600px;object-fit:contain;background:#fff'
    const frame = document.createElement('iframe'); frame.srcdoc = ${JSON.stringify(chapterDoc)}
    frame.style.cssText = 'display:block;width:450px;height:600px;border:0;background:#fff'
    sheet.append(device(img), device(frame))
    document.body.appendChild(sheet)
    const r = sheet.getBoundingClientRect()
    return JSON.stringify({ width: r.width, height: r.height })
  })()`))
  await sleep(2000)
  const book = await cdp.call('Page.captureScreenshot', { format: 'png', clip: { x: 0, y: 0, width: size.width, height: size.height, scale: 1 } })
  writeFileSync(join(OUT, 'book.png'), Buffer.from(book.data, 'base64'))
} finally {
  teardown(session)
}
console.log('wrote screenshots/panel.png and screenshots/book.png')
