/**
 * Which graph images go into the book, and how each one is encoded.
 *
 * Pure on purpose (no `@logseq/libs`, no DOM), so it bundles into the Node
 * tests; `image-loader.ts` does the reading and canvas work.
 *
 * Images reach the plugin two ways, measured on each build:
 * - file graphs write `![alt](../assets/name.png)` into block text;
 * - Logseq 2.x DB graphs make the image its own block, with
 *   `:logseq.property.asset/type` set and the file at `assets/<uuid>.<type>`.
 */
import type { GraphPage, BlockNode } from './graph'

/**
 * Longest edge an embedded image keeps, in pixels. The Boox Poke's screen is
 * 1072x1448 and most 6–7" e-readers are smaller; a bit above the short edge
 * keeps a landscape photo sharp without shipping a phone camera's 4000px.
 */
export const MAX_IMAGE_EDGE = 1264

/** `![alt](src)`, with Logseq's optional `{:width … :height …}` trailer. */
export const MD_IMAGE = /!\[([^\]]*)\]\(([^)]+)\)(?:\{[^}]*\})?/g

export interface EmbeddedImage {
  /** Path inside the EPUB's content folder, e.g. `images/img-001.jpg`. */
  fileName: string
  mediaType: string
  bytes: ArrayBuffer
}

/**
 * The graph-relative key (`assets/…`) for a Markdown image source, or null
 * when it is not a local graph asset (a web URL, another folder) or tries to
 * leave the assets folder.
 */
export function assetKey(src: string): string | null {
  // A Markdown title may follow the path: `(path "Title")`.
  let path = src.trim().replace(/\s+"[^"]*"$/, '')
  if (/^[a-z][a-z0-9+.-]*:/i.test(path)) return null // https:, file:, data:, …
  try {
    path = decodeURIComponent(path)
  } catch {
    return null
  }
  path = path.replace(/\\/g, '/').replace(/^(\.\.?\/)+/, '').replace(/^\/+/, '')
  const parts = path.split('/')
  if (parts[0] !== 'assets' || parts.length < 2 || !parts[parts.length - 1]) return null
  if (parts.some((p) => p === '..' || p === '.')) return null
  return parts.join('/')
}

/**
 * The `file://` URL of a graph asset, from the graph folder as the host
 * reports it. Windows hands back `C:\Users\…`: the separators become `/`,
 * a drive letter needs the extra `/` (`file:///C:/…`) and must stay unencoded,
 * and a UNC share (`\\server\share`) becomes the URL's host.
 */
export function assetFileUrl(graphPath: string, key: string): string {
  let path = graphPath.replace(/\\/g, '/')
  let host = ''
  const unc = path.match(/^\/\/([^/]+)(\/.*)?$/)
  if (unc) {
    host = unc[1]
    path = unc[2] ?? ''
  }
  path = `${path.replace(/\/+$/, '')}/${key}`
  const drive = path.match(/^\/?([A-Za-z]:)(\/.*)$/)
  const prefix = drive ? `/${drive[1]}` : ''
  const rest = drive ? drive[2] : path
  const encoded = rest.split('/').map(encodeURIComponent).join('/')
  return `file://${encodeURIComponent(host)}${prefix}${encoded.startsWith('/') ? '' : '/'}${encoded}`
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** The asset key of a 2.x DB image block, or null for any other block. */
export function dbAssetKey(block: any): string | null {
  const type = block?.[':logseq.property.asset/type']
  const uuid = block?.uuid
  if (typeof type !== 'string' || !/^[a-z0-9]{1,8}$/i.test(type)) return null
  if (typeof uuid !== 'string' || !UUID.test(uuid)) return null
  return `assets/${uuid}.${type.toLowerCase()}`
}

/** Every local image the pages reference, once each, in a stable order. */
export function collectImageKeys(pages: GraphPage[]): string[] {
  const keys = new Set<string>()
  const walk = (nodes: BlockNode[]) => {
    for (const n of nodes) {
      if (n.image) keys.add(n.image.key)
      for (const m of n.content.matchAll(MD_IMAGE)) {
        const key = assetKey(m[2])
        if (key) keys.add(key)
      }
      walk(n.children)
    }
  }
  for (const p of pages) walk(p.tree)
  return [...keys].sort()
}

/** Image type by magic bytes, never by extension. */
export function sniffImageType(b: Uint8Array): string | null {
  const at = (i: number, ...sig: number[]) => sig.every((v, j) => b[i + j] === v)
  if (at(0, 0xff, 0xd8, 0xff)) return 'image/jpeg'
  if (at(0, 0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)) return 'image/png'
  if (at(0, 0x47, 0x49, 0x46, 0x38)) return 'image/gif'
  if (at(0, 0x52, 0x49, 0x46, 0x46) && at(8, 0x57, 0x45, 0x42, 0x50)) return 'image/webp'
  if (at(0, 0x42, 0x4d)) return 'image/bmp'
  if (at(4, 0x66, 0x74, 0x79, 0x70, 0x61, 0x76, 0x69, 0x66)) return 'image/avif'
  const head = new TextDecoder().decode(b.subarray(0, 512)).trimStart()
  if (/^(<\?xml[^>]*>\s*)?(<!--[\s\S]*?-->\s*)*(<!DOCTYPE svg[^>]*>\s*)?<svg[\s>]/i.test(head)) return 'image/svg+xml'
  return null
}

export type EncodingPlan =
  | { output: 'keep' }
  | { output: 'image/jpeg' | 'image/png'; width: number; height: number }

/**
 * How to put one decoded image into the book. JPEG and PNG that already fit
 * are kept byte-for-byte; anything larger is downscaled, and any other format
 * (WebP, GIF, SVG, …) is re-encoded, since KOReader's crengine renders JPEG
 * and PNG reliably. Transparency needs PNG; everything else becomes JPEG.
 */
export function encodingPlan(img: { mediaType: string; width: number; height: number; hasAlpha: boolean }): EncodingPlan {
  const scale = Math.min(1, MAX_IMAGE_EDGE / Math.max(img.width, img.height))
  const kept = img.mediaType === 'image/jpeg' || img.mediaType === 'image/png'
  if (scale === 1 && kept) return { output: 'keep' }
  return {
    output: img.hasAlpha ? 'image/png' : 'image/jpeg',
    width: Math.max(1, Math.round(img.width * scale)),
    height: Math.max(1, Math.round(img.height * scale)),
  }
}

export function imageFileName(index: number, mediaType: string): string {
  const ext = mediaType === 'image/jpeg' ? 'jpg' : mediaType.replace(/^image\//, '').replace('svg+xml', 'svg')
  return `images/img-${String(index + 1).padStart(3, '0')}.${ext}`
}
