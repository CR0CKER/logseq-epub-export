/**
 * Standalone smoke test for the pure rendering + EPUB packaging logic.
 * Builds a synthetic GraphModel (no Logseq runtime needed), renders chapters,
 * packages an EPUB, and asserts structure. Run via:
 *   npx esbuild tests/smoke.ts --bundle --platform=node --format=esm --outfile=/tmp/smoke.mjs && node /tmp/smoke.mjs
 */
import { writeFileSync } from 'node:fs'
import type { GraphModel, GraphPage } from '../src/graph'
import {
  renderHomeChapter,
  renderPageChapter,
  renderTagChapter,
} from '../src/render'
import { buildEpub } from '../src/epub'

let failures = 0
function assert(cond: boolean, msg: string) {
  if (cond) { console.log('  ok:', msg) }
  else { failures++; console.error('  FAIL:', msg) }
}

const page = (name: string, slug: string, props: any, tree: any[]): GraphPage => ({
  name, slug, isJournal: false, journalDay: 0, properties: props, tree,
})

const adkar = page('ADKAR', 'adkar', { type: 'framework', tags: ['framework'] }, [
  { content: 'Created by [[Jeffrey Hiatt]] and compared with [[Kotter 8-Step]].', properties: {}, children: [] },
  { content: '## The five blocks', properties: {}, heading: 2, children: [
    { content: '**Awareness** then *Desire*.', properties: {}, children: [] },
    { content: 'Uses `inline code` and a #framework tag and a missing [[Nonexistent]].', properties: {}, children: [] },
  ]},
  { content: '| A | B |\n| --- | --- |\n| 1 | 2 |', properties: {}, children: [] },
  { content: '{{query (property type "framework")}}', properties: {}, children: [] },
])
const kotter = page('Kotter 8-Step', 'kotter-8-step', { type: 'framework', tags: ['framework'] }, [
  { content: 'Links back to [[ADKAR]]. See https://example.com for more.', properties: {}, children: [] },
])

const model: GraphModel = {
  graphName: 'Test Graph',
  pages: [adkar, kotter],
  journals: [],
  nameToSlug: new Map([
    ['adkar', 'adkar'],
    ['kotter 8-step', 'kotter-8-step'],
    ['framework', 'tag-framework'],
  ]),
  resolvable: new Set(['adkar', 'kotter 8-step', 'framework']),
  backlinks: new Map([
    ['adkar', [{ fromName: 'Kotter 8-Step', fromSlug: 'kotter-8-step', snippet: 'Links back to [[ADKAR]].' }]],
    ['kotter 8-step', [{ fromName: 'ADKAR', fromSlug: 'adkar', snippet: 'compared with [[Kotter 8-Step]]' }]],
  ]),
  tagMembers: new Map([['framework', new Set(['ADKAR', 'Kotter 8-Step'])]]),
  tagSlug: new Map([['framework', 'tag-framework']]),
  tagLabel: new Map([['framework', 'framework']]),
}

console.log('Rendering chapters…')
const adkarCh = renderPageChapter(adkar, model)
const tagCh = renderTagChapter('framework', model)
const home = renderHomeChapter(model)

assert(adkarCh.xhtml.includes('href="kotter-8-step.xhtml"'), 'wikilink resolves to chapter href')
assert(adkarCh.xhtml.includes('<span class="missing">Nonexistent</span>'), 'missing link is a muted span')
assert(adkarCh.xhtml.includes('class="tag" href="tag-framework.xhtml"'), 'inline #tag links to tag index')
assert(adkarCh.xhtml.includes('<strong>Awareness</strong>'), 'bold renders')
assert(adkarCh.xhtml.includes('<em>Desire</em>'), 'italic renders')
assert(adkarCh.xhtml.includes('<code>inline code</code>'), 'inline code renders')
assert(adkarCh.xhtml.includes('<table>') && adkarCh.xhtml.includes('<th>A</th>'), 'markdown table renders')
assert(adkarCh.xhtml.includes('class="query-result"') && adkarCh.xhtml.includes('href="kotter-8-step.xhtml"'), 'query expands to member list')
assert(adkarCh.xhtml.includes('Linked References') && adkarCh.xhtml.includes('href="kotter-8-step.xhtml"'), 'backlinks section present')
assert(/<h3>The five blocks<\/h3>/.test(adkarCh.xhtml), 'heading level offset (## -> h3 under page h1)')
assert(kotter.tree[0].content.includes('https://example.com'), 'fixture sanity')
assert(renderPageChapter(kotter, model).xhtml.includes('class="ext" href="https://example.com"'), 'bare URL linkified')
assert(tagCh.xhtml.includes('href="adkar.xhtml"') && tagCh.xhtml.includes('href="kotter-8-step.xhtml"'), 'tag index lists members')
assert(home.xhtml.includes('href="adkar.xhtml"') && home.xhtml.includes('href="tag-framework.xhtml"'), 'home lists pages and tags')

// Names with XML-special characters: looked up by their real name, emitted escaped.
{
  const rd = page('R&D', 'r-d', { tags: ['R&D'] }, [
    { content: 'Research <and> development', properties: {}, children: [] },
  ])
  const m: GraphModel = {
    ...model,
    pages: [rd],
    nameToSlug: new Map([['r&d', 'r-d']]),
    resolvable: new Set(['r&d']),
    backlinks: new Map(),
    tagMembers: new Map([['r&d', new Set(['R&D'])]]),
    tagSlug: new Map([['r&d', 'tag-r-d']]),
    tagLabel: new Map([['r&d', 'R&D']]),
  }
  const linker = page('Linker', 'linker', {}, [
    { content: 'See [[R&D]] and #[[R&D]]', properties: {}, children: [] },
  ])
  const x = renderPageChapter(linker, m).xhtml
  assert(x.includes('<a href="r-d.xhtml">R&amp;D</a>'), '[[R&D]] resolves and its label is escaped')
  assert(x.includes('<a class="tag" href="tag-r-d.xhtml">#R&amp;D</a>'), '#[[R&D]] resolves and its label is escaped')
  const own = renderPageChapter(rd, m).xhtml
  assert(own.includes('#R&amp;D</a>') && !/&(?!amp;|lt;|gt;|quot;|#)/.test(own), 'properties table escapes tag labels (no bare &)')
  const tagIdx = renderTagChapter('r&d', m).xhtml
  assert(!/&(?!amp;|lt;|gt;|quot;|#)/.test(tagIdx), 'tag index escapes its label (no bare &)')
}

// Inline rules must not re-process each other's output.
{
  const m: GraphModel = {
    ...model,
    nameToSlug: new Map([...model.nameToSlug, ['change management', 'change-management']]),
    tagSlug: new Map([...model.tagSlug, ['change management', 'tag-change-management']]),
    tagLabel: new Map([...model.tagLabel, ['change management', 'change management']]),
  }
  const p = page('Inline', 'inline', {}, [
    { content: 'A #[[change management]] tag', properties: {}, children: [] },
    { content: 'See https://example.com/a_b_c and [docs](https://example.com/x_y_z)', properties: {}, children: [] },
  ])
  const x = renderPageChapter(p, m).xhtml
  assert(x.includes('A <a class="tag" href="tag-change-management.xhtml">#change management</a> tag'), '#[[multi word]] is one tag link, not a page link or double-wrapped')
  assert(x.includes('href="https://example.com/a_b_c">https://example.com/a_b_c</a>'), 'bare URL with underscores is not italicised')
  assert(x.includes('<a class="ext" href="https://example.com/x_y_z">docs</a>'), 'markdown link URL with underscores is not italicised')
  const plain = renderPageChapter(page('Plain', 'plain', {}, [
    { content: 'Room C1 and C0 are free', properties: {}, children: [] },
  ]), m).xhtml
  assert(plain.includes('Room C1 and C0 are free'), 'literal text like " C1 " is not mistaken for a code placeholder')
}

console.log('Packaging EPUB…')
const chapters = [home, adkarCh, kotter && renderPageChapter(kotter, model), tagCh]
// 1x1 PNG so we can exercise the cover plumbing without a canvas.
const pngBytes = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  'base64',
)
const bytes = await buildEpub({
  title: 'Test Graph',
  chapters,
  cover: { bytes: pngBytes.buffer.slice(pngBytes.byteOffset, pngBytes.byteOffset + pngBytes.byteLength), mediaType: 'image/png', fileName: 'cover.png' },
  nav: [
    { label: 'Home', items: [{ label: 'Home', href: 'index.xhtml' }] },
    { label: 'Pages', items: [{ label: 'ADKAR', href: 'adkar.xhtml' }, { label: 'Kotter 8-Step', href: 'kotter-8-step.xhtml' }] },
    { label: 'Tags', items: [{ label: '#framework', href: 'tag-framework.xhtml' }] },
    { label: 'Journals', items: [] },
  ],
})

const buf = Buffer.from(bytes)
writeFileSync('/tmp/logseq-epub-export-smoke.epub', buf)
// EPUB OCF rule: first zip entry must be "mimetype", stored (method 0).
const method = buf.readUInt16LE(8)
const name = buf.subarray(30, 38).toString('ascii')
assert(name === 'mimetype', 'first zip entry is "mimetype"')
assert(method === 0, 'mimetype is stored (uncompressed)')
const content = buf.toString('latin1')
assert(content.includes('application/epub+zip'), 'mimetype content correct')

// Decompress and inspect the real package document.
const back = await (await import('jszip')).default.loadAsync(buf)
const opf = await back.file('OEBPS/content.opf')!.async('string')
assert(!!back.file('OEBPS/toc.ncx') && !!back.file('OEBPS/nav.xhtml'), 'opf/ncx/nav present')
assert(!!back.file('OEBPS/cover.png') && !!back.file('OEBPS/cover.xhtml'), 'cover files present in zip')
assert(opf.includes('properties="cover-image"') && opf.includes('cover.png'), 'cover image in manifest')
assert(opf.includes('<meta name="cover" content="cover-image"'), 'EPUB2 cover meta present')
assert(opf.includes('<itemref idref="cover"'), 'cover is first spine item')
assert(opf.includes('<dc:title>Test Graph</dc:title>'), 'title is the graph name')

console.log(`\nWrote /tmp/logseq-epub-export-smoke.epub (${buf.length} bytes)`)
if (failures > 0) { console.error(`\n${failures} assertion(s) FAILED`); process.exit(1) }
console.log('\nAll assertions passed.')
