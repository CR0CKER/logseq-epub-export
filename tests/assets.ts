/**
 * Unit tests for embedding graph images: src/assets.ts (which files, how to
 * encode them) and the render/EPUB side of it.
 */
import JSZip from 'jszip'
import type { GraphModel, GraphPage } from '../src/graph'
import { MAX_IMAGE_EDGE, assetFileUrl, assetKey, collectImageKeys, dbAssetKey, encodingPlan, imageFileName, sniffImageType } from '../src/assets'
import { renderPageChapter } from '../src/render'
import { buildEpub } from '../src/epub'

let failures = 0
function eq(actual: unknown, expected: unknown, msg: string) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected)
  if (ok) console.log('  ok:', msg)
  else { failures++; console.error(`  FAIL: ${msg}\n    expected ${JSON.stringify(expected)}\n    actual   ${JSON.stringify(actual)}`) }
}

console.log('assetKey: which image sources are graph assets')
eq(assetKey('../assets/photo.png'), 'assets/photo.png', 'the ../assets/ form Logseq writes')
eq(assetKey('assets/photo.png'), 'assets/photo.png', 'graph-relative')
eq(assetKey('./assets/photo.png'), 'assets/photo.png', './ prefix')
eq(assetKey('/assets/photo.png'), 'assets/photo.png', 'leading slash')
eq(assetKey('../assets/my%20photo.png'), 'assets/my photo.png', 'percent-encoded names are decoded')
eq(assetKey('../assets/sub/photo.png "A title"'), 'assets/sub/photo.png', 'a markdown title after the path is ignored')
eq(assetKey('https://example.com/a.png'), null, 'remote images are not assets')
eq(assetKey('file:///home/u/a.png'), null, 'file: URLs are not assets')
eq(assetKey('../pages/a.png'), null, 'only the assets folder')
eq(assetKey('../assets/../../.ssh/id_ed25519'), null, 'no path traversal out of assets/')
eq(assetKey('../assets/%2e%2e/secret.png'), null, 'no encoded path traversal either')
eq(assetKey('../assets/'), null, 'a folder is not an image')

console.log('assetFileUrl: the file:// fallback on every OS')
// Expected values come from Node's url.pathToFileURL(path, { windows }), the
// reference for how a path becomes a file URL. Before this, a Windows graph got
// file://C%3A%5CUsers%5C… — every image failed to load (issue #4).
eq(assetFileUrl('/home/u/My Graph', 'assets/ü #1.png'), 'file:///home/u/My%20Graph/assets/%C3%BC%20%231.png', 'Linux/macOS path, spaces and non-ASCII encoded')
eq(assetFileUrl('/home/u/graph/', 'assets/a.png'), 'file:///home/u/graph/assets/a.png', 'a trailing slash on the graph folder')
eq(assetFileUrl('C:\\Users\\Ana\\My Graph', 'assets/image_1.png'), 'file:///C:/Users/Ana/My%20Graph/assets/image_1.png', 'Windows drive path: forward slashes, drive letter unencoded')
eq(assetFileUrl('C:\\Users\\张\\graph\\', 'assets/x%y.png'), 'file:///C:/Users/%E5%BC%A0/graph/assets/x%25y.png', 'Windows path with non-ASCII and a percent sign')
eq(assetFileUrl('C:/Users/Ana/graph', 'assets/a.png'), 'file:///C:/Users/Ana/graph/assets/a.png', 'Windows drive path already using forward slashes')
eq(assetFileUrl('\\\\nas\\share\\graph', 'assets/a b.png'), 'file://nas/share/graph/assets/a%20b.png', 'Windows UNC share: the server is the host')

console.log('dbAssetKey: 2.x image blocks')
eq(dbAssetKey({ uuid: '6aaa80cf-3610-4975-8585-263a7e042522', ':logseq.property.asset/type': 'png' }), 'assets/6aaa80cf-3610-4975-8585-263a7e042522.png', 'uuid + asset type')
eq(dbAssetKey({ uuid: '6aaa80cf-3610-4975-8585-263a7e042522' }), null, 'not an asset block')
eq(dbAssetKey({ uuid: '../../x', ':logseq.property.asset/type': 'png' }), null, 'a malformed uuid is rejected')
eq(dbAssetKey({ uuid: '6aaa80cf-3610-4975-8585-263a7e042522', ':logseq.property.asset/type': 'png/../x' }), null, 'a malformed type is rejected')

console.log('sniffImageType: by magic bytes, not extension')
const bytes = (...b: number[]) => new Uint8Array([...b, ...new Array(16).fill(0)])
eq(sniffImageType(bytes(0xff, 0xd8, 0xff, 0xe0)), 'image/jpeg', 'JPEG')
eq(sniffImageType(bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)), 'image/png', 'PNG')
eq(sniffImageType(bytes(0x47, 0x49, 0x46, 0x38)), 'image/gif', 'GIF')
eq(sniffImageType(new Uint8Array([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50])), 'image/webp', 'WebP')
eq(sniffImageType(new TextEncoder().encode('<?xml version="1.0"?><svg xmlns="http://www.w3.org/2000/svg"/>')), 'image/svg+xml', 'SVG')
eq(sniffImageType(new TextEncoder().encode('%PDF-1.4')), null, 'a PDF is not an image')

console.log('encodingPlan: sized for e-ink, in formats KOReader shows')
eq(encodingPlan({ mediaType: 'image/jpeg', width: 800, height: 600, hasAlpha: false }), { output: 'keep' }, 'small JPEG kept byte-for-byte')
eq(encodingPlan({ mediaType: 'image/png', width: 32, height: 32, hasAlpha: true }), { output: 'keep' }, 'small PNG kept byte-for-byte')
eq(encodingPlan({ mediaType: 'image/png', width: 4000, height: 2000, hasAlpha: false }), { output: 'image/jpeg', width: MAX_IMAGE_EDGE, height: 632 }, 'large opaque PNG -> downscaled JPEG')
eq(encodingPlan({ mediaType: 'image/png', width: 1000, height: 3000, hasAlpha: true }), { output: 'image/png', width: 421, height: MAX_IMAGE_EDGE }, 'large transparent PNG -> downscaled PNG')
eq(encodingPlan({ mediaType: 'image/webp', width: 100, height: 100, hasAlpha: false }), { output: 'image/jpeg', width: 100, height: 100 }, 'WebP converted even when small')
eq(encodingPlan({ mediaType: 'image/svg+xml', width: 64, height: 64, hasAlpha: true }), { output: 'image/png', width: 64, height: 64 }, 'SVG rasterized to PNG')
eq(imageFileName(0, 'image/jpeg'), 'images/img-001.jpg', 'deterministic file names')
eq(imageFileName(41, 'image/png'), 'images/img-042.png', 'numbered from 1')

// ── render + collect ───────────────────────────────────────────────────────
const page = (name: string, tree: any[]): GraphPage => ({ name, slug: name.toLowerCase(), isJournal: false, journalDay: 0, properties: {}, tree })
const pics = page('Pics', [
  { content: 'Look: ![A photo](../assets/photo.png){:height 300, :width 400}', properties: {}, children: [] },
  { content: '![web](https://example.com/remote.png)', properties: {}, children: [] },
  { content: '![gone](../assets/missing.png)', properties: {}, children: [] },
  { content: 'db photo', properties: {}, image: { key: 'assets/6aaa80cf-3610-4975-8585-263a7e042522.png', alt: 'db photo' }, children: [
    { content: 'child ![again](assets/photo.png)', properties: {}, children: [] },
  ] },
])
const model = {
  graphName: 'G', pages: [pics], journals: [], nameToSlug: new Map(), resolvable: new Set(), backlinks: new Map(),
  tagMembers: new Map(), tagSlug: new Map(), tagLabel: new Map(),
  images: new Map([
    ['assets/photo.png', 'images/img-002.jpg'],
    ['assets/6aaa80cf-3610-4975-8585-263a7e042522.png', 'images/img-001.png'],
  ]),
} as GraphModel

console.log('collectImageKeys + render')
eq(collectImageKeys([pics]), ['assets/6aaa80cf-3610-4975-8585-263a7e042522.png', 'assets/missing.png', 'assets/photo.png'], 'every local image once, sorted; remote skipped')
const x = renderPageChapter(pics, model).xhtml
eq(x.includes('Look: <img src="images/img-002.jpg" alt="A photo" />'), true, 'a loaded asset renders as <img>, with the {:width} trailer dropped')
eq(x.includes('<a class="ext" href="https://example.com/remote.png">[image: web]</a>'), true, 'a web image stays a link')
eq(x.includes('<span class="asset">[image: gone]</span>'), true, 'an asset that could not be loaded keeps the placeholder')
eq(x.includes('<li><img src="images/img-001.png" alt="db photo" /><ul><li>child <img src="images/img-002.jpg" alt="again" /></li></ul></li>'), true, 'a DB image block renders its image, children nested')

console.log('EPUB packaging')
const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
const buf = await buildEpub({
  title: 'G',
  chapters: [renderPageChapter(pics, model)],
  nav: [{ label: 'Pages', items: [{ label: 'Pics', href: 'pics.xhtml' }] }],
  images: [{ fileName: 'images/img-001.png', mediaType: 'image/png', bytes: png.buffer }],
})
const zip = await JSZip.loadAsync(buf)
const opf = await zip.file('OEBPS/content.opf')!.async('string')
eq(opf.includes('<item id="img-001" href="images/img-001.png" media-type="image/png" />'), true, 'image declared in the manifest')
eq(Array.from(await zip.file('OEBPS/images/img-001.png')!.async('uint8array')), Array.from(png), 'image bytes stored unchanged')

if (failures > 0) { console.error(`\n${failures} assertion(s) FAILED`); process.exit(1) }
console.log('\nAll asset assertions passed.')
