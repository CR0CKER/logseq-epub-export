/**
 * Generate a clean, modern EPUB cover as a PNG, rendered on a canvas in the
 * plugin iframe. The artwork is Logseq-inspired: a dark squircle badge holding
 * a connected-nodes "knowledge graph" glyph (the motif behind Logseq's brand),
 * the graph name as the title, and a teal accent. Returns null when canvas
 * isn't available (e.g. the Node test harness), so the EPUB simply ships
 * without a cover in that case.
 */

const W = 1600
const H = 2400

// Logseq-inspired palette: deep slate background, teal accent, off-white text.
const BG_TOP = '#0b1220'
const BG_BOTTOM = '#10202b'
const TEAL = '#2dd4bf'
const TEAL_DIM = '#0d9488'
const INK = '#f8fafc'
const MUTED = '#7c8b99'
const BADGE = '#0e1a22'

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  if (typeof (ctx as any).roundRect === 'function') {
    ctx.beginPath()
    ;(ctx as any).roundRect(x, y, w, h, r)
    return
  }
  ctx.beginPath()
  ctx.moveTo(x + r, y)
  ctx.arcTo(x + w, y, x + w, y + h, r)
  ctx.arcTo(x + w, y + h, x, y + h, r)
  ctx.arcTo(x, y + h, x, y, r)
  ctx.arcTo(x, y, x + w, y, r)
  ctx.closePath()
}

/** Draw the Logseq-inspired node-graph glyph centered at (cx, cy). */
function drawGraphGlyph(ctx: CanvasRenderingContext2D, cx: number, cy: number, radius: number): void {
  const spokes = 6
  const outer: [number, number][] = []
  for (let i = 0; i < spokes; i++) {
    const a = (Math.PI * 2 * i) / spokes - Math.PI / 2
    outer.push([cx + Math.cos(a) * radius, cy + Math.sin(a) * radius])
  }

  // Connecting lines (hub → nodes, plus the outer ring).
  ctx.strokeStyle = TEAL_DIM
  ctx.lineWidth = 8
  ctx.globalAlpha = 0.85
  for (const [x, y] of outer) {
    ctx.beginPath()
    ctx.moveTo(cx, cy)
    ctx.lineTo(x, y)
    ctx.stroke()
  }
  ctx.beginPath()
  outer.forEach(([x, y], i) => (i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y)))
  ctx.closePath()
  ctx.stroke()
  ctx.globalAlpha = 1

  // Outer nodes.
  for (const [x, y] of outer) {
    ctx.beginPath()
    ctx.fillStyle = TEAL
    ctx.arc(x, y, 26, 0, Math.PI * 2)
    ctx.fill()
  }
  // Hub node.
  ctx.beginPath()
  ctx.fillStyle = INK
  ctx.arc(cx, cy, 40, 0, Math.PI * 2)
  ctx.fill()
  ctx.beginPath()
  ctx.fillStyle = TEAL
  ctx.arc(cx, cy, 22, 0, Math.PI * 2)
  ctx.fill()
}

function wrapLines(ctx: CanvasRenderingContext2D, text: string, maxWidth: number, maxLines: number): string[] {
  const words = text.split(/\s+/).filter(Boolean)
  const lines: string[] = []
  let line = ''
  for (const word of words) {
    const test = line ? `${line} ${word}` : word
    if (ctx.measureText(test).width > maxWidth && line) {
      lines.push(line)
      line = word
    } else {
      line = test
    }
  }
  if (line) lines.push(line)
  if (lines.length > maxLines) {
    const kept = lines.slice(0, maxLines)
    kept[maxLines - 1] = kept[maxLines - 1].replace(/\s+\S*$/, '') + '…'
    return kept
  }
  return lines
}

export interface CoverImage {
  bytes: ArrayBuffer
  mediaType: string
  fileName: string
}

/** Encode a canvas as opaque JPEG bytes, with a toDataURL fallback for
 *  environments where toBlob is unavailable or returns null. JPEG (no alpha)
 *  is the most reliably-rendered cover format for crengine/KOReader. */
async function encodeJpeg(canvas: HTMLCanvasElement): Promise<ArrayBuffer | null> {
  const blob = await new Promise<Blob | null>((resolve) => {
    try { canvas.toBlob((b) => resolve(b), 'image/jpeg', 0.9) } catch { resolve(null) }
  })
  if (blob) return blob.arrayBuffer()
  try {
    const dataUrl = canvas.toDataURL('image/jpeg', 0.9)
    const b64 = dataUrl.split(',')[1]
    const bin = atob(b64)
    const bytes = new Uint8Array(bin.length)
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
    return bytes.buffer
  } catch {
    return null
  }
}

export async function buildCover(title: string): Promise<CoverImage | null> {
  let canvas: HTMLCanvasElement
  try {
    canvas = document.createElement('canvas')
  } catch {
    return null
  }
  canvas.width = W
  canvas.height = H
  const ctx = canvas.getContext('2d')
  if (!ctx) return null
  // Let any web fonts finish loading so title text isn't drawn in a fallback.
  try { await (document as any).fonts?.ready } catch { /* ignore */ }

  // Background gradient.
  const grad = ctx.createLinearGradient(0, 0, 0, H)
  grad.addColorStop(0, BG_TOP)
  grad.addColorStop(1, BG_BOTTOM)
  ctx.fillStyle = grad
  ctx.fillRect(0, 0, W, H)

  // Faint scattered nodes in the background for texture.
  ctx.fillStyle = TEAL
  ctx.globalAlpha = 0.06
  for (let i = 0; i < 40; i++) {
    const x = (Math.sin(i * 12.9898) * 43758.5453) % 1
    const y = (Math.sin(i * 78.233) * 12543.123) % 1
    ctx.beginPath()
    ctx.arc(Math.abs(x) * W, Math.abs(y) * H, 6 + (i % 4) * 4, 0, Math.PI * 2)
    ctx.fill()
  }
  ctx.globalAlpha = 1

  // Top accent rule.
  ctx.fillStyle = TEAL
  ctx.fillRect(160, 200, 180, 12)

  // Badge (squircle) with the graph glyph.
  const badge = 560
  const bx = (W - badge) / 2
  const by = 360
  ctx.save()
  ctx.shadowColor = 'rgba(0,0,0,0.45)'
  ctx.shadowBlur = 60
  ctx.shadowOffsetY = 24
  roundRect(ctx, bx, by, badge, badge, 130)
  ctx.fillStyle = BADGE
  ctx.fill()
  ctx.restore()
  roundRect(ctx, bx, by, badge, badge, 130)
  ctx.strokeStyle = TEAL_DIM
  ctx.lineWidth = 6
  ctx.stroke()
  drawGraphGlyph(ctx, W / 2, by + badge / 2, 150)

  // Subtitle above the title.
  ctx.textAlign = 'center'
  ctx.fillStyle = TEAL
  ctx.font = '600 46px system-ui, -apple-system, "Segoe UI", Roboto, sans-serif'
  ctx.fillText('L O G S E Q   G R A P H', W / 2, by + badge + 180)

  // Title (graph name), wrapped.
  ctx.fillStyle = INK
  const titleSize = title.length > 28 ? 110 : 132
  ctx.font = `700 ${titleSize}px Georgia, "Times New Roman", serif`
  const lines = wrapLines(ctx, title, W - 280, 4)
  let ty = by + badge + 340
  for (const line of lines) {
    ctx.fillText(line, W / 2, ty)
    ty += titleSize * 1.18
  }

  // Footer.
  ctx.fillStyle = MUTED
  ctx.font = '500 40px system-ui, -apple-system, "Segoe UI", Roboto, sans-serif'
  ctx.fillText('Exported to EPUB for reading offline', W / 2, H - 220)

  const bytes = await encodeJpeg(canvas)
  if (!bytes) return null
  return { bytes, mediaType: 'image/jpeg', fileName: 'cover.jpg' }
}
