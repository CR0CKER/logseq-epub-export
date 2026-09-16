/**
 * The live cases: a real Logseq exports the seeded graph, and the book on disk
 * is taken apart and checked.
 *
 * The static smoke test feeds render.ts a hand-built model, so it cannot see
 * what this tier exists for: the shape the host API *actually* returns on each
 * build. Logseq 2.x stores links as [[uuid]], lowercases `name`, keeps headings
 * in a property and lists its built-in property pages as ordinary pages — all
 * invisible to a synthetic model, all visible in the exported book.
 *
 * Cases run in order and share `ctx`; `setup` cases build it. A case that
 * finds nothing to check returns { skipped: reason } and never passes silently.
 */
import assert from 'node:assert/strict'
import { readdirSync, readFileSync, statSync, existsSync } from 'node:fs'
import { join, basename } from 'node:path'
import JSZip from 'jszip'
import { waitFor } from '../lib/cdp.mjs'
import { PLUGIN_ID, openFileGraph } from '../lib/scratch.mjs'
import { EXPECT, IMAGES, writeFileGraph, seedDbGraph, pasteDbImages } from './fixture.mjs'

const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i
const TOOLBAR_BUTTON = 'a[data-on-click="runExport"]'

/** A real pointer click at an element's centre, the way a user clicks. */
async function realClick(cdp, selector) {
  const rect = await cdp.evaluate(`(() => {
    const e = document.querySelector(${JSON.stringify(selector)})
    if (!e) return null
    const b = e.getBoundingClientRect()
    return JSON.stringify([b.left + b.width / 2, b.top + b.height / 2, b.width, b.height])
  })()`)
  assert.ok(rect, `nothing matches ${selector}`)
  const [x, y, w, h] = JSON.parse(rect)
  assert.ok(w > 0 && h > 0, `${selector} has no size (${w}x${h}), so it cannot be clicked`)
  for (const type of ['mousePressed', 'mouseReleased']) {
    await cdp.call('Input.dispatchMouseEvent', { type, x, y, button: 'left', clickCount: 1 })
  }
}

const FRAME = `document.querySelector('iframe#${PLUGIN_ID}_iframe')`
const PLUGIN = `LSPluginCore.registeredPlugins.get(${JSON.stringify(PLUGIN_ID)})`

/** A real pointer click on an element inside the plugin's iframe. */
async function realClickInPlugin(cdp, selector) {
  const rect = await cdp.evaluate(`(() => {
    const f = ${FRAME}
    const e = f?.contentDocument?.querySelector(${JSON.stringify(selector)})
    if (!e) return null
    const fb = f.getBoundingClientRect(), b = e.getBoundingClientRect()
    return JSON.stringify([fb.left + b.left + b.width / 2, fb.top + b.top + b.height / 2, b.width, b.height])
  })()`)
  assert.ok(rect, `nothing in the plugin frame matches ${selector}`)
  const [x, y, w, h] = JSON.parse(rect)
  assert.ok(w > 0 && h > 0, `${selector} in the plugin frame has no size`)
  for (const type of ['mousePressed', 'mouseReleased']) {
    await cdp.call('Input.dispatchMouseEvent', { type, x, y, button: 'left', clickCount: 1 })
  }
}

/**
 * Replace the folder picker, which needs a native dialog, with one that acts
 * like Chromium's: without user activation in the frame it throws the same
 * SecurityError; with it, it returns a real folder handle from the frame's
 * private file system, which the plugin stores and writes like a picked one.
 * Every call records whether activation was there.
 */
async function stubFolderPicker(cdp, folder) {
  await cdp.evaluate(`(() => {
    const w = ${FRAME}.contentWindow
    w.__pickerCalls = []
    w.showDirectoryPicker = async () => {
      const active = w.navigator.userActivation.isActive
      w.__pickerCalls.push(active)
      if (!active) throw new w.DOMException('Must be handling a user gesture to show a file picker.', 'SecurityError')
      return (await w.navigator.storage.getDirectory()).getDirectoryHandle(${JSON.stringify(folder)}, { create: true })
    }
    return true
  })()`)
}

const pickerCalls = async (cdp) => JSON.parse(await cdp.evaluate(`JSON.stringify(${FRAME}.contentWindow.__pickerCalls)`))

/** { size, lastModified } of a file in the stand-in folder, or null. */
async function folderFile(cdp, folder, name) {
  return JSON.parse(await cdp.evaluate(`(async () => {
    try {
      const w = ${FRAME}.contentWindow
      const dir = await (await w.navigator.storage.getDirectory()).getDirectoryHandle(${JSON.stringify(folder)})
      const f = await (await dir.getFileHandle(${JSON.stringify(name)})).getFile()
      const head = new Uint8Array(await f.slice(30, 38).arrayBuffer())
      return JSON.stringify({ size: f.size, lastModified: f.lastModified, entry: String.fromCharCode(...head) })
    } catch { return 'null' }
  })()`))
}

/** Wait until the export writes `name` into the folder after `since` (ms). */
async function waitForFolderExport(cdp, folder, name, since) {
  const deadline = Date.now() + 60000
  while (Date.now() < deadline) {
    const f = await folderFile(cdp, folder, name)
    if (f && f.lastModified > since && f.size > 0) {
      await new Promise((r) => setTimeout(r, 800))
      const again = await folderFile(cdp, folder, name)
      if (again.size === f.size) return again
    }
    await new Promise((r) => setTimeout(r, 400))
  }
  throw new Error(`${name} was not written into the "${folder}" folder within 60s`)
}

/** Whether the plugin has a folder stored for this graph (its IndexedDB). */
async function storedFolder(cdp, graphUrl) {
  return cdp.evaluate(`(async () => {
    const w = ${FRAME}.contentWindow
    const db = await new Promise((res, rej) => { const r = w.indexedDB.open('keyval-store'); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error) })
    if (!db.objectStoreNames.contains('keyval')) return null
    const v = await new Promise((res) => { const r = db.transaction('keyval').objectStore('keyval').get(${JSON.stringify(`logseq-epub-export:dir:${graphUrl}`)}); r.onsuccess = () => res(r.result) })
    db.close()
    return v?.name ?? null
  })()`)
}

const panelVisible = (cdp) => cdp.evaluate(`${FRAME}.offsetParent !== null`)

/** Chapter lookups over the unzipped book. */
function bookIndex(files) {
  const chapters = Object.entries(files).filter(([n]) => n.endsWith('.xhtml') && !/\/(nav|cover)\.xhtml$/.test(n))
  const h1 = (x) => x.match(/<h1>([\s\S]*?)<\/h1>/)?.[1] ?? null
  const byTitle = (title) => chapters.find(([, x]) => h1(x) === title)?.[1] ?? null
  const chapterAt = (href) => files[`OEBPS/${href}`] ?? null
  /** The chapter a link with this visible text points at, or null. */
  const follow = (xhtml, text) => {
    const re = new RegExp(`<a (?:class="[^"]*" )?href="([^"]+)">${text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}</a>`)
    const m = xhtml.match(re)
    return m ? chapterAt(m[1]) : null
  }
  return { chapters, h1, byTitle, follow }
}

/** Width and height from a JPEG's start-of-frame marker. */
function jpegSize(bytes) {
  const b = Buffer.from(bytes)
  for (let i = 2; i < b.length - 9;) {
    if (b[i] !== 0xff) { i++; continue }
    const marker = b[i + 1]
    if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) {
      return { height: b.readUInt16BE(i + 5), width: b.readUInt16BE(i + 7) }
    }
    i += 2 + b.readUInt16BE(i + 2)
  }
  throw new Error('no JPEG frame header found')
}

function needBook(ctx) {
  assert.ok(ctx.book, 'no exported book to check (the export case failed)')
  return ctx.book
}

export const cases = [
  {
    name: 'the plugin loads and puts its export button in the toolbar',
    async run({ cdp }) {
      await waitFor(cdp, `Boolean(LSPluginCore.registeredPlugins.get(${JSON.stringify(PLUGIN_ID)})?.loaded)`, {
        label: 'the plugin to load',
        timeoutMs: 45000,
      })
      await waitFor(cdp, `Boolean(document.querySelector(${JSON.stringify(TOOLBAR_BUTTON)}))`, {
        label: 'the toolbar button',
        timeoutMs: 20000,
      })
    },
  },
  {
    name: 'the toolbar icon draws a glyph (the icon font is present on this build)',
    async run({ cdp }) {
      const got = JSON.parse(await cdp.evaluate(`(() => {
        const i = document.querySelector(${JSON.stringify(TOOLBAR_BUTTON)} + ' i')
        const before = getComputedStyle(i, '::before')
        return JSON.stringify({ content: before.content, font: before.fontFamily, width: i.getBoundingClientRect().width })
      })()`))
      assert.ok(got.content && got.content !== 'none' && got.content !== 'normal' && got.content !== '""', `the icon has no glyph (content: ${got.content})`)
      assert.match(got.font, /tabler/i, `the icon is not drawn with the Tabler icon font (${got.font})`)
      assert.ok(got.width > 0, 'the icon has no width')
    },
  },
  {
    name: 'setup: a graph with the fixture content is open',
    async run({ cdp, session, target, ctx }) {
      if (target.id !== 'db') {
        const dir = writeFileGraph(join(session.root, 'EPUB Live Test'))
        await openFileGraph(session, dir)
        ctx.expectedTitle = 'EPUB Live Test'
      } else {
        // 2.x opens a real, saved demo DB graph in a fresh profile.
        await waitFor(cdp, `(async () => Boolean((await logseq.api.get_current_graph())?.path))()`, {
          label: 'the demo DB graph to open',
          timeoutMs: 45000,
        })
        assert.equal(await seedDbGraph(cdp), true, 'seeding the DB graph through the API failed')
        assert.equal(await pasteDbImages(cdp), true, 'pasting the fixture images failed')
        ctx.expectedTitle = 'Demo'
      }
      const graph = await cdp.evaluate(`(async () => JSON.stringify(await logseq.api.get_current_graph()))()`)
      ctx.graph = JSON.parse(graph)
      // Wait until the host can see every fixture page, so the export is not
      // racing OG's file parser.
      await waitFor(
        cdp,
        `(async () => { for (const n of ${JSON.stringify([...EXPECT.pages, EXPECT.tag, EXPECT.specialPage, EXPECT.picturesPage])}) if (!(await logseq.api.get_page(n))) return false; return true })()`,
        { label: 'the fixture pages to be indexed', timeoutMs: 45000 },
      )
      // Built-in pages, as the host itself marks them, for the exclusion case.
      ctx.builtIns = JSON.parse(await cdp.evaluate(`(async () => {
        const out = []
        for (const p of (await logseq.api.get_all_pages()) ?? []) {
          const full = (await logseq.api.get_page(p.uuid)) ?? p
          if (full['built-in?'] || full[':logseq.property/built-in?']) out.push(p.originalName ?? p.title ?? p.name)
        }
        return JSON.stringify(out)
      })()`))
    },
  },
  {
    name: 'setup: one click on the toolbar button writes an EPUB into the graph',
    async run({ cdp, ctx }) {
      assert.ok(ctx.graph?.path, 'no open graph path')
      const dir = join(ctx.graph.path, 'assets/storages', PLUGIN_ID)
      const before = Date.now()
      await realClick(cdp, TOOLBAR_BUTTON)
      const deadline = Date.now() + 60000
      let file = null
      while (Date.now() < deadline && !file) {
        if (existsSync(dir)) {
          const fresh = readdirSync(dir).filter((n) => n.endsWith('.epub')).map((n) => join(dir, n))
            .filter((p) => statSync(p).mtimeMs >= before - 1000)
          if (fresh.length) {
            // Size stable across two reads = the write finished.
            const size = statSync(fresh[0]).size
            await new Promise((r) => setTimeout(r, 1000))
            if (size > 0 && statSync(fresh[0]).size === size) file = fresh[0]
          }
        }
        if (!file) await new Promise((r) => setTimeout(r, 500))
      }
      assert.ok(file, `no .epub appeared in ${dir} within 60s`)
      const bytes = readFileSync(file)
      const zip = await JSZip.loadAsync(bytes)
      const files = {}
      for (const [name, entry] of Object.entries(zip.files)) {
        if (!entry.dir) files[name] = /\.(jpe?g|png)$/.test(name) ? await entry.async('uint8array') : await entry.async('string')
      }
      ctx.book = { file, bytes, files, ...bookIndex(files) }
    },
  },
  {
    name: 'the file is a valid EPUB container (mimetype first and stored, every manifest item present)',
    async run({ ctx }) {
      const { bytes, files } = needBook(ctx)
      assert.equal(bytes.subarray(30, 38).toString('ascii'), 'mimetype', 'first zip entry must be "mimetype"')
      assert.equal(bytes.readUInt16LE(8), 0, 'mimetype must be STOREd')
      assert.ok(files['META-INF/container.xml'], 'META-INF/container.xml missing')
      const opf = files['OEBPS/content.opf']
      assert.ok(opf, 'OEBPS/content.opf missing')
      const ids = new Set()
      for (const m of opf.matchAll(/<item id="([^"]+)" href="([^"]+)"/g)) {
        ids.add(m[1])
        assert.ok(files[`OEBPS/${m[2]}`], `manifest item ${m[2]} is not in the zip`)
      }
      for (const m of opf.matchAll(/<itemref idref="([^"]+)"/g)) assert.ok(ids.has(m[1]), `spine item ${m[1]} is not in the manifest`)
      assert.ok(Object.keys(files).some((n) => /cover\.jpe?g$/.test(n)), 'no JPEG cover in the book')
    },
  },
  {
    name: 'every chapter parses as well-formed XHTML',
    async run({ cdp, ctx }) {
      const { files } = needBook(ctx)
      const docs = Object.entries(files).filter(([n]) => n.endsWith('.xhtml') || n.endsWith('.opf') || n.endsWith('.ncx'))
      // Chromium's own strict XML parser, inside the running app.
      const bad = JSON.parse(await cdp.evaluate(`(() => {
        const docs = ${JSON.stringify(docs)}
        const bad = []
        for (const [name, text] of docs) {
          const type = name.endsWith('.xhtml') ? 'application/xhtml+xml' : 'application/xml'
          const err = new DOMParser().parseFromString(text, type).querySelector('parsererror')
          if (err) bad.push(name + ': ' + err.textContent.slice(0, 160))
        }
        return JSON.stringify(bad)
      })()`))
      assert.deepEqual(bad, [], 'malformed documents')
    },
  },
  {
    name: "the book is titled with the graph's display name, not its internal id",
    async run({ ctx }) {
      const { files, file } = needBook(ctx)
      const title = files['OEBPS/content.opf'].match(/<dc:title>([\s\S]*?)<\/dc:title>/)?.[1]
      assert.equal(title, ctx.expectedTitle)
      assert.equal(basename(file), `${ctx.expectedTitle}.epub`)
    },
  },
  {
    name: 'page chapters keep the original page-name casing',
    async run({ ctx }) {
      const { byTitle } = needBook(ctx)
      for (const name of EXPECT.pages) assert.ok(byTitle(name), `no chapter titled "${name}"`)
    },
  },
  {
    name: '[[links]] resolve to the linked chapter, and no raw UUID leaks into the text',
    async run({ ctx }) {
      const { byTitle, follow, h1, chapters } = needBook(ctx)
      const adkar = byTitle('ADKAR')
      assert.ok(adkar, 'no ADKAR chapter')
      assert.equal(h1(follow(adkar, 'Jeffrey Hiatt') ?? ''), 'Jeffrey Hiatt', '[[Jeffrey Hiatt]] does not link to its chapter')
      assert.equal(h1(follow(adkar, 'Kotter 8-Step') ?? ''), 'Kotter 8-Step', '[[Kotter 8-Step]] does not link to its chapter')
      const leaks = chapters.filter(([, x]) => UUID.test(x.replace(/<[^>]*>/g, ''))).map(([n]) => n)
      assert.deepEqual(leaks, [], 'chapters with a UUID in their visible text')
    },
  },
  {
    name: 'names with XML-special characters and multi-word #[[tags]] link correctly',
    async run({ ctx }) {
      const { byTitle, follow, h1 } = needBook(ctx)
      const hiatt = byTitle('Jeffrey Hiatt')
      assert.ok(hiatt, 'no Jeffrey Hiatt chapter')
      const escaped = EXPECT.specialPage.replace(/&/g, '&amp;')
      assert.equal(h1(follow(hiatt, escaped) ?? ''), escaped, `[[${EXPECT.specialPage}]] does not link to its chapter`)
      const tag = follow(hiatt, `#${EXPECT.multiWordTag}`)
      assert.ok(tag, `#[[${EXPECT.multiWordTag}]] is not a single tag link`)
      assert.equal(h1(tag), `#${EXPECT.multiWordTag}`)
    },
  },
  {
    name: 'a link to an alias resolves to the aliased page',
    async run({ ctx }) {
      const { byTitle, follow, h1 } = needBook(ctx)
      const kotter = byTitle('Kotter 8-Step')
      assert.ok(kotter, 'no Kotter 8-Step chapter')
      assert.equal(h1(follow(kotter, EXPECT.alias) ?? ''), 'ADKAR', `[[${EXPECT.alias}]] does not link to ADKAR`)
    },
  },
  {
    name: '#tags link to a tag index that lists its pages',
    async run({ ctx }) {
      const { byTitle, follow, h1 } = needBook(ctx)
      const tagIndex = follow(byTitle('ADKAR') ?? '', `#${EXPECT.tag}`)
      assert.ok(tagIndex, `#${EXPECT.tag} is not a link`)
      assert.equal(h1(tagIndex), `#${EXPECT.tag}`)
      for (const member of ['ADKAR', 'Kotter 8-Step']) assert.ok(tagIndex.includes(`>${member}</a>`), `tag index does not list ${member}`)
    },
  },
  {
    name: 'backlinks: Linked References lists the pages and journals that link here',
    async run({ ctx }) {
      const { byTitle } = needBook(ctx)
      const adkar = byTitle('ADKAR') ?? ''
      const refs = adkar.split('<h2>Linked References</h2>')[1]
      assert.ok(refs, 'ADKAR has no Linked References section')
      assert.ok(refs.includes('>Kotter 8-Step</a>'), 'Kotter 8-Step (via the alias) missing from backlinks')
      assert.ok(refs.includes(EXPECT.journalMarker), 'the journal entry is missing from backlinks')
    },
  },
  {
    name: 'block structure: headings render as headings, children nest under their parent',
    async run({ ctx }) {
      const { byTitle } = needBook(ctx)
      const adkar = byTitle('ADKAR') ?? ''
      assert.match(adkar, new RegExp(`<h[2-6]>${EXPECT.heading}</h[2-6]>`), 'the heading block is not a heading')
      assert.match(adkar, new RegExp(`<li>Created by [\\s\\S]*?<ul><li>${EXPECT.childText} with <strong>bold</strong>`), 'the child block is not nested')
    },
  },
  {
    name: 'page properties show by name, and a property query expands to its pages',
    async run({ ctx }) {
      const { byTitle } = needBook(ctx)
      const adkar = byTitle('ADKAR') ?? ''
      const props = adkar.match(/<table class="props">[\s\S]*?<\/table>/)?.[0]
      assert.ok(props, 'ADKAR has no properties table')
      assert.match(props, /<th>type<\/th><td>framework<\/td>/, 'type:: framework is not shown by name')
      assert.doesNotMatch(props, /<th>:/, 'a namespaced property key leaked into the table')
      const query = (byTitle('Kotter 8-Step') ?? '').match(/<ul class="query-result">[\s\S]*?<\/ul>/)?.[0]
      assert.ok(query, 'the property query did not expand')
      assert.ok(query.includes('>ADKAR</a>'), 'the query result does not list ADKAR')
    },
  },
  {
    name: 'journals are exported under their own TOC section',
    async run({ ctx }) {
      const { files, chapters } = needBook(ctx)
      const nav = files['OEBPS/nav.xhtml']
      const section = nav.split('Journals')[1] ?? ''
      const hrefs = [...section.matchAll(/href="([^"]+)"/g)].map((m) => m[1])
      assert.ok(hrefs.length > 0, 'the Journals TOC section is empty')
      const journal = chapters.find(([n, x]) => hrefs.includes(n.replace('OEBPS/', '')) && x.includes(EXPECT.journalMarker))
      assert.ok(journal, 'the fixture journal is not in the Journals section')
    },
  },
  {
    name: 'graph images are embedded, sized for e-ink; web images stay links',
    async run({ ctx }) {
      const { byTitle, files } = needBook(ctx)
      const page = byTitle(EXPECT.picturesPage)
      assert.ok(page, `no ${EXPECT.picturesPage} chapter`)
      assert.doesNotMatch(page, /class="asset"/, 'a local image was left as a placeholder')
      const srcs = [...page.matchAll(/<img src="([^"]+)" alt="[^"]*" \/>/g)].map((m) => m[1])
      assert.equal(srcs.length, 2, `expected 2 <img> in the chapter, found ${srcs.length}`)
      const opf = files['OEBPS/content.opf']
      const kinds = {}
      for (const src of srcs) {
        const bytes = files[`OEBPS/${src}`]
        assert.ok(bytes instanceof Uint8Array, `${src} is not in the book`)
        const type = opf.match(new RegExp(`href="${src}" media-type="([^"]+)"`))?.[1]
        assert.ok(type, `${src} is not declared in the manifest`)
        kinds[type] = { src, bytes }
      }
      // The photo: re-encoded as JPEG, longest edge down to the e-ink maximum.
      const jpeg = kinds['image/jpeg']
      assert.ok(jpeg, 'the large opaque photo did not become a JPEG')
      const { width, height } = jpegSize(jpeg.bytes)
      assert.equal(Math.max(width, height), 1264, `photo is ${width}x${height}, not downscaled to 1264px`)
      assert.equal(Math.round(width / height), Math.round(IMAGES.photo.width / IMAGES.photo.height), 'photo aspect ratio changed')
      // The icon: small PNG with transparency, kept byte-for-byte.
      const kept = kinds['image/png']
      assert.ok(kept, 'the transparent icon is not a PNG')
      assert.ok(Buffer.from(kept.bytes).equals(IMAGES.icon.bytes), 'the icon was re-encoded instead of kept')
      assert.ok(page.includes(`<a class="ext" href="${IMAGES.remote}">[image: web image]</a>`), 'the web image is not a link')
    },
  },
  {
    name: "Logseq's built-in pages are not exported as chapters",
    async run({ ctx }) {
      const { chapters, h1 } = needBook(ctx)
      if (!ctx.builtIns?.length) return { skipped: 'the host marks no page as built-in on this build' }
      // Case-insensitive on purpose: a build that lowercases titles must not
      // make a leaked "deadline" chapter look unlike the built-in "Deadline".
      const titles = new Set(chapters.map(([, x]) => (h1(x) ?? '').toLowerCase()))
      const leaked = ctx.builtIns.filter((t) => titles.has(String(t).toLowerCase()))
      assert.deepEqual(leaked, [], 'built-in pages exported as chapters')
    },
  },
  {
    name: 'the custom-folder destination has the File System Access API it needs',
    async run({ cdp }) {
      // Picking a folder needs a native dialog and a user gesture, so the
      // pick itself stays manual; this checks the API is there to call.
      const has = await cdp.evaluate(`typeof document.querySelector('iframe#${PLUGIN_ID}_iframe')?.contentWindow?.showDirectoryPicker`)
      assert.equal(has, 'function', 'showDirectoryPicker is missing in the plugin iframe')
    },
  },
  {
    name: 'custom folder: the first export asks for a folder right away, later ones go straight there',
    async run({ cdp, ctx }) {
      const book = `${ctx.expectedTitle}.epub`
      await cdp.evaluate(`${PLUGIN}.settings.set('destinationMode', 'custom-folder'); true`)
      await stubFolderPicker(cdp, 'Kobo books')
      assert.equal(await storedFolder(cdp, ctx.graph.url), null, 'a folder is already stored before the first export')

      let since = Date.now() - 1000
      await realClick(cdp, TOOLBAR_BUTTON)
      const first = await waitForFolderExport(cdp, 'Kobo books', book, since)
      assert.equal(first.entry, 'mimetype', 'the file in the chosen folder is not an EPUB')
      assert.deepEqual(await pickerCalls(cdp), [true], 'the toolbar click did not open the picker with user activation')
      assert.equal(await panelVisible(cdp), false, 'the panel opened although the picker could ask directly')
      assert.equal(await storedFolder(cdp, ctx.graph.url), 'Kobo books', 'the chosen folder was not remembered')

      since = first.lastModified
      await realClick(cdp, TOOLBAR_BUTTON)
      await waitForFolderExport(cdp, 'Kobo books', book, since)
      assert.deepEqual(await pickerCalls(cdp), [true], 'the second export asked for a folder again')
    },
  },
  {
    name: 'settings: unticking "Remember export folder" forgets it, and every export then asks',
    async run({ cdp, ctx }) {
      const book = `${ctx.expectedTitle}.epub`
      // Both builds render a boolean setting as a checkbox under [data-key]:
      // 2.x a button[role=checkbox], 0.10.x an input[type=checkbox].
      const item = `document.querySelector('[data-key="rememberFolder"]')`
      await cdp.evaluate(`${FRAME}.contentWindow.logseq.showSettingsUI(); true`)
      await waitFor(cdp, `Boolean(${item})`, { label: 'the plugin settings to show "Remember export folder"', timeoutMs: 15000 })
      const text = await cdp.evaluate(`${item}.textContent`)
      assert.match(text, /Remember export folder/)
      assert.match(text, /Current folder for this graph: Kobo books/, 'the description does not name the remembered folder')

      const box = JSON.parse(await cdp.evaluate(`(() => {
        const b = ${item}.querySelector('button[role=checkbox], input[type=checkbox]')
        b.scrollIntoView({ block: 'center' })
        const r = b.getBoundingClientRect()
        return JSON.stringify([r.left + r.width / 2, r.top + r.height / 2])
      })()`))
      for (const type of ['mousePressed', 'mouseReleased']) await cdp.call('Input.dispatchMouseEvent', { type, x: box[0], y: box[1], button: 'left', clickCount: 1 })
      await waitFor(cdp, `${PLUGIN}.settings.get('rememberFolder') === false`, { label: 'the setting to untick', timeoutMs: 10000 })
      // Close the dialog the way a user does.
      const escape = async () => {
        for (const type of ['keyDown', 'keyUp']) await cdp.call('Input.dispatchKeyEvent', { type, key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 })
        await waitFor(cdp, `!${item}`, { label: 'Escape to close the settings dialog', timeoutMs: 10000 })
      }
      await escape()
      const deadline = Date.now() + 10000
      while ((await storedFolder(cdp, ctx.graph.url)) !== null && Date.now() < deadline) await new Promise((r) => setTimeout(r, 300))
      assert.equal(await storedFolder(cdp, ctx.graph.url), null, 'the stored folder was not forgotten')
      // Logseq redraws a setting's description when the dialog opens, not while
      // it is open, so check it the way a user would: reopen Settings.
      await cdp.evaluate(`${FRAME}.contentWindow.logseq.showSettingsUI(); true`)
      await waitFor(cdp, `(${item}?.textContent ?? '').includes('Current folder for this graph: not set')`, {
        label: 'the reopened settings to say no folder is stored', timeoutMs: 10000,
      })
      await escape()

      await stubFolderPicker(cdp, 'Other books')
      let since = Date.now() - 1000
      await realClick(cdp, TOOLBAR_BUTTON)
      const first = await waitForFolderExport(cdp, 'Other books', book, since)
      await realClick(cdp, TOOLBAR_BUTTON)
      await waitForFolderExport(cdp, 'Other books', book, first.lastModified)
      assert.deepEqual(await pickerCalls(cdp), [true, true], 'with Remember off, each export must ask for the folder')
      assert.equal(await storedFolder(cdp, ctx.graph.url), null, 'a folder was stored although Remember is off')

      await cdp.evaluate(`${PLUGIN}.settings.set('rememberFolder', true); true`)
      await waitFor(cdp, `${PLUGIN}.settings.get('rememberFolder') === true`, { label: 'Remember to be back on', timeoutMs: 5000 })
    },
  },
  {
    name: 'custom folder: an export without a click behind it offers "Choose folder and export…" in the panel',
    async run({ cdp, ctx }) {
      const book = `${ctx.expectedTitle}.epub`
      await stubFolderPicker(cdp, 'Panel books')
      // Earlier clicks leave transient activation behind for a few seconds;
      // wait it out, or the picker would still be allowed.
      await waitFor(cdp, `!${FRAME}.contentWindow.navigator.userActivation.isActive && !navigator.userActivation.isActive`, {
        label: 'user activation from earlier clicks to expire', timeoutMs: 20000,
      })
      await cdp.evaluate(`${PLUGIN}.settings.set('rememberFolder', true); true`)
      // Invoke the export the way the host does, but from script: no user
      // activation, so the picker refuses and the panel has to take over.
      await cdp.evaluate(`${PLUGIN}.caller.callUserModel('runExport'); true`)
      await waitFor(cdp, `Boolean(${FRAME}?.contentDocument?.querySelector('#ee-pick-export')) && ${FRAME}.offsetParent !== null`, {
        label: 'the panel to offer "Choose folder and export…"', timeoutMs: 15000,
      })
      assert.deepEqual(await pickerCalls(cdp), [false], 'the export did not try the picker first')
      const since = Date.now() - 1000
      await realClickInPlugin(cdp, '#ee-pick-export')
      const out = await waitForFolderExport(cdp, 'Panel books', book, since)
      assert.equal(out.entry, 'mimetype')
      assert.deepEqual(await pickerCalls(cdp), [false, true], 'the panel button did not open the picker with activation')
      assert.equal(await storedFolder(cdp, ctx.graph.url), 'Panel books', 'the folder chosen in the panel was not remembered')
      await cdp.evaluate(`${FRAME}.contentDocument.querySelector('#ee-close').click(); ${PLUGIN}.settings.set('destinationMode', 'graph-assets'); true`)
      await waitFor(cdp, `${FRAME}.offsetParent === null`, { label: 'the panel to close', timeoutMs: 10000 })
    },
  },
  {
    name: 'the panel opens from the command palette entry, themed like the app',
    async run({ cdp }) {
      // The palette entry calls the same model method; invoke it the way the
      // host does, then look inside the plugin's iframe.
      await cdp.evaluate(`LSPluginCore.registeredPlugins.get(${JSON.stringify(PLUGIN_ID)}).caller.callUserModel('openPanel'); true`)
      const frame = `document.querySelector('iframe#${PLUGIN_ID}_iframe')`
      await waitFor(cdp, `Boolean(${frame}?.contentDocument?.querySelector('#ee-export')) && ${frame}.offsetParent !== null`, {
        label: 'the panel to open',
        timeoutMs: 15000,
      })
      const got = JSON.parse(await cdp.evaluate(`(() => {
        const doc = ${frame}.contentDocument
        const card = doc.querySelector('.ee-card')
        const host = getComputedStyle(document.documentElement).getPropertyValue('--ls-primary-background-color').trim()
        const probe = document.createElement('div'); probe.style.background = host; document.body.appendChild(probe)
        const hostBg = getComputedStyle(probe).backgroundColor; probe.remove()
        return JSON.stringify({ card: getComputedStyle(card).backgroundColor, hostBg })
      })()`))
      assert.equal(got.card, got.hostBg, 'the panel card does not use the app background')
      await cdp.evaluate(`${frame}.contentDocument.querySelector('#ee-close').click(); true`)
      await waitFor(cdp, `${frame}.offsetParent === null`, { label: 'the panel to close', timeoutMs: 10000 })
    },
  },
]
