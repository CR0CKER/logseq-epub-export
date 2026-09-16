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
import { EXPECT, writeFileGraph, seedDbGraph } from './fixture.mjs'

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
      if (target.id === 'og') {
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
        ctx.expectedTitle = 'Demo'
      }
      const graph = await cdp.evaluate(`(async () => JSON.stringify(await logseq.api.get_current_graph()))()`)
      ctx.graph = JSON.parse(graph)
      // Wait until the host can see every fixture page, so the export is not
      // racing OG's file parser.
      await waitFor(
        cdp,
        `(async () => { for (const n of ${JSON.stringify([...EXPECT.pages, EXPECT.tag, EXPECT.specialPage])}) if (!(await logseq.api.get_page(n))) return false; return true })()`,
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
