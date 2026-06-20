import JSZip from 'jszip'
import { Chapter, escapeHtml, STYLE_CSS } from './render'

export interface NavGroup {
  label: string
  items: { label: string; href: string }[]
}

export interface CoverImage {
  bytes: ArrayBuffer
  mediaType: string
  fileName: string
}

export interface EpubInput {
  title: string
  /** Spine order; the first chapter is the landing page. */
  chapters: Chapter[]
  /** Grouped navigation for the TOC (Pages / Tags / Journals …). */
  nav: NavGroup[]
  /** Optional cover image (PNG/JPEG); shown as the first spine page. */
  cover?: CoverImage | null
}

const OPF_DIR = 'OEBPS'

function uuid(): string {
  try {
    return (crypto as any).randomUUID()
  } catch {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
      const r = (Math.random() * 16) | 0
      const v = c === 'x' ? r : (r & 0x3) | 0x8
      return v.toString(16)
    })
  }
}

function manifest(input: EpubInput): string {
  const items = input.chapters
    .map((c) => `<item id="${c.slug}" href="${c.slug}.xhtml" media-type="application/xhtml+xml" />`)
    .join('\n    ')
  const cover = input.cover
    ? `<item id="cover-image" href="${input.cover.fileName}" media-type="${input.cover.mediaType}" properties="cover-image" />
    <item id="cover" href="cover.xhtml" media-type="application/xhtml+xml" />\n    `
    : ''
  return `<item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav" />
    <item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml" />
    <item id="css" href="style.css" media-type="text/css" />
    ${cover}${items}`
}

function spine(input: EpubInput): string {
  const cover = input.cover ? `<itemref idref="cover" linear="yes" />\n    ` : ''
  return cover + input.chapters.map((c) => `<itemref idref="${c.slug}" />`).join('\n    ')
}

function coverXhtml(input: EpubInput): string {
  return `<?xml version="1.0" encoding="utf-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xml:lang="en" lang="en">
<head>
<meta charset="utf-8" />
<title>${escapeHtml(input.title)}</title>
<style>html,body{margin:0;padding:0;height:100%;text-align:center;background:#0b1220}
img{max-width:100%;max-height:100vh;object-fit:contain}</style>
</head>
<body><img src="${input.cover!.fileName}" alt="${escapeHtml(input.title)}" /></body>
</html>`
}

function contentOpf(input: EpubInput, id: string): string {
  const date = new Date().toISOString().replace(/\.\d+Z$/, 'Z')
  const coverMeta = input.cover ? `\n    <meta name="cover" content="cover-image" />` : ''
  return `<?xml version="1.0" encoding="utf-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="bookid">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:identifier id="bookid">urn:uuid:${id}</dc:identifier>
    <dc:title>${escapeHtml(input.title)}</dc:title>
    <dc:language>en</dc:language>
    <dc:creator>Logseq EPUB Export</dc:creator>
    <meta property="dcterms:modified">${date}</meta>${coverMeta}
  </metadata>
  <manifest>
    ${manifest(input)}
  </manifest>
  <spine toc="ncx">
    ${spine(input)}
  </spine>${input.cover ? `
  <guide>
    <reference type="cover" title="Cover" href="cover.xhtml" />
  </guide>` : ''}
</package>`
}

function navXhtml(input: EpubInput): string {
  const groups = input.nav
    .filter((g) => g.items.length)
    .map((g) => {
      const lis = g.items
        .map((it) => `<li><a href="${it.href}">${escapeHtml(it.label)}</a></li>`)
        .join('\n        ')
      return `<li>${escapeHtml(g.label)}<ol>\n        ${lis}\n      </ol></li>`
    })
    .join('\n      ')
  return `<?xml version="1.0" encoding="utf-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" lang="en">
<head><meta charset="utf-8" /><title>${escapeHtml(input.title)}</title></head>
<body>
  <nav epub:type="toc" id="toc">
    <h1>Contents</h1>
    <ol>
      ${groups}
    </ol>
  </nav>
</body>
</html>`
}

function tocNcx(input: EpubInput, id: string): string {
  let playOrder = 0
  const np = (label: string, href: string, children = '') => {
    playOrder++
    return `<navPoint id="np${playOrder}" playOrder="${playOrder}">
      <navLabel><text>${escapeHtml(label)}</text></navLabel>
      <content src="${href}" />
      ${children}</navPoint>`
  }
  const groups = input.nav
    .filter((g) => g.items.length)
    .map((g) => {
      const first = g.items[0]?.href ?? 'index.xhtml'
      const kids = g.items.map((it) => np(it.label, it.href)).join('\n      ')
      return np(g.label, first, kids)
    })
    .join('\n    ')
  return `<?xml version="1.0" encoding="utf-8"?>
<ncx xmlns="http://www.daisy.org/z3986/2005/ncx/" version="2005-1">
  <head>
    <meta name="dtb:uid" content="urn:uuid:${id}" />
    <meta name="dtb:depth" content="2" />
    <meta name="dtb:totalPageCount" content="0" />
    <meta name="dtb:maxPageNumber" content="0" />
  </head>
  <docTitle><text>${escapeHtml(input.title)}</text></docTitle>
  <navMap>
    ${groups}
  </navMap>
</ncx>`
}

/** Assemble a valid EPUB 3 (with NCX fallback) as an ArrayBuffer. */
export async function buildEpub(input: EpubInput): Promise<ArrayBuffer> {
  const id = uuid()
  const zip = new JSZip()

  // `mimetype` MUST be the first entry and stored uncompressed.
  zip.file('mimetype', 'application/epub+zip', { compression: 'STORE' })
  zip.file(
    'META-INF/container.xml',
    `<?xml version="1.0" encoding="utf-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles>
    <rootfile full-path="${OPF_DIR}/content.opf" media-type="application/oebps-package+xml" />
  </rootfiles>
</container>`,
  )

  const oebps = zip.folder(OPF_DIR)!
  oebps.file('content.opf', contentOpf(input, id))
  oebps.file('nav.xhtml', navXhtml(input))
  oebps.file('toc.ncx', tocNcx(input, id))
  oebps.file('style.css', STYLE_CSS)
  if (input.cover) {
    oebps.file(input.cover.fileName, input.cover.bytes)
    oebps.file('cover.xhtml', coverXhtml(input))
  }
  for (const c of input.chapters) oebps.file(`${c.slug}.xhtml`, c.xhtml)

  return zip.generateAsync({
    type: 'arraybuffer',
    mimeType: 'application/epub+zip',
    compression: 'DEFLATE',
  })
}
