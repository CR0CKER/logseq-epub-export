import '@logseq/libs'
import { EmbeddedImage, assetFileUrl, encodingPlan, imageFileName, sniffImageType } from './assets'
import { encodeCanvas } from './cover'

export interface LoadedImages {
  /** asset key → path in the book, for every image that made it in. */
  hrefs: Map<string, string>
  files: EmbeddedImage[]
  /** keys that could not be read or decoded; they render as placeholders. */
  failed: string[]
  /**
   * Why the first failed image failed: each URL tried and what it returned.
   * One line is enough to tell a wrong path from a refused scheme, and it is
   * what a bug report needs.
   */
  firstFailure?: string
}

type ReadResult = { bytes: Uint8Array } | { tried: string[] }

/**
 * Read an asset's bytes from the plugin iframe.
 *
 * Which route works depends on the build (measured): Logseq 2.x and the OG
 * build serve `logseq.Assets.makeUrl`'s `assets://` URLs to plugins but
 * refuse `file://`; Logseq 0.10.15 loads plugins from `file://`, so there
 * `file://` works and `assets://` does not. Try one, then the other.
 */
async function readAsset(key: string, graphPath: string | undefined): Promise<ReadResult> {
  const urls: string[] = []
  const tried: string[] = []
  try {
    urls.push(await logseq.Assets.makeUrl(key))
  } catch (e) {
    tried.push(`makeUrl: ${String(e)}`)
  }
  if (graphPath) urls.push(assetFileUrl(graphPath, key))
  for (const url of urls) {
    try {
      const res = await fetch(url)
      if (res.ok) return { bytes: new Uint8Array(await res.arrayBuffer()) }
      tried.push(`${url} → HTTP ${res.status}`)
    } catch (e) {
      tried.push(`${url} → ${String(e)}`)
    }
  }
  if (!graphPath) tried.push('no graph path from getCurrentGraph')
  return { tried }
}

async function decode(bytes: Uint8Array, mediaType: string): Promise<HTMLImageElement> {
  const url = URL.createObjectURL(new Blob([bytes.slice().buffer], { type: mediaType }))
  try {
    const img = new Image()
    img.src = url
    await img.decode()
    return img
  } finally {
    URL.revokeObjectURL(url)
  }
}

function hasTransparency(ctx: CanvasRenderingContext2D, width: number, height: number): boolean {
  const data = ctx.getImageData(0, 0, width, height).data
  for (let i = 3; i < data.length; i += 4) if (data[i] < 255) return true
  return false
}

/** Put one image into book form, or null if it is not a usable image. */
async function prepare(bytes: Uint8Array, index: number): Promise<EmbeddedImage | null> {
  const mediaType = sniffImageType(bytes)
  if (!mediaType) return null
  const img = await decode(bytes, mediaType)
  const width = img.naturalWidth
  const height = img.naturalHeight
  if (!width || !height) return null

  // Measure transparency at display size: enough to decide JPEG vs PNG
  // without holding a full-resolution copy of a large photo.
  const probeScale = Math.min(1, 512 / Math.max(width, height))
  const probe = document.createElement('canvas')
  probe.width = Math.max(1, Math.round(width * probeScale))
  probe.height = Math.max(1, Math.round(height * probeScale))
  const pctx = probe.getContext('2d', { willReadFrequently: true })!
  pctx.drawImage(img, 0, 0, probe.width, probe.height)
  const hasAlpha = mediaType !== 'image/jpeg' && hasTransparency(pctx, probe.width, probe.height)

  const plan = encodingPlan({ mediaType, width, height, hasAlpha })
  if (plan.output === 'keep') {
    return { fileName: imageFileName(index, mediaType), mediaType, bytes: bytes.slice().buffer }
  }
  const canvas = document.createElement('canvas')
  canvas.width = plan.width
  canvas.height = plan.height
  const ctx = canvas.getContext('2d')!
  ctx.imageSmoothingQuality = 'high'
  if (plan.output === 'image/jpeg') {
    // JPEG has no alpha: paint on white, as the page behind it would be.
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(0, 0, plan.width, plan.height)
  }
  ctx.drawImage(img, 0, 0, plan.width, plan.height)
  const out = await encodeCanvas(canvas, plan.output, 0.85)
  return out ? { fileName: imageFileName(index, plan.output), mediaType: plan.output, bytes: out } : null
}

/** Read, decode and size every referenced graph image for the book. */
export async function loadImages(keys: string[], onProgress?: (msg: string) => void): Promise<LoadedImages> {
  const result: LoadedImages = { hrefs: new Map(), files: [], failed: [] }
  if (keys.length === 0) return result
  let graphPath: string | undefined
  try {
    graphPath = ((await logseq.App.getCurrentGraph()) as any)?.path
  } catch { /* the assets:// route may still work */ }

  for (const [i, key] of keys.entries()) {
    if (onProgress && i % 10 === 0) onProgress(`Adding images… ${i}/${keys.length}`)
    try {
      const read = await readAsset(key, graphPath)
      if (!('bytes' in read)) {
        result.firstFailure ??= `${key}: ${read.tried.join('; ')}`
        result.failed.push(key)
        continue
      }
      const file = await prepare(read.bytes, result.files.length)
      if (!file) {
        result.firstFailure ??= `${key}: read, but not a decodable image`
        result.failed.push(key)
        continue
      }
      result.files.push(file)
      result.hrefs.set(key, file.fileName)
    } catch (e) {
      console.warn('logseq-epub-export: could not embed image', key, e)
      result.firstFailure ??= `${key}: ${String(e)}`
      result.failed.push(key)
    }
  }
  return result
}
