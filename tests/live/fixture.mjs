/**
 * One small graph, built two ways: as Markdown files for a Logseq OG file
 * graph, and through the plugin API for a Logseq 2.x DB graph (which has no
 * Markdown import a scratch profile can drive). Both carry the same things the
 * exporter has to get right, so the cases can assert the same book on both:
 * original page-name casing, [[links]] and #tags, an alias, page properties, a
 * property query, a heading, a nested block and a journal.
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { deflateSync, crc32 } from 'node:zlib'

/** Encode an RGBA pixel function as a PNG, so the fixture ships no binaries. */
function png(width, height, pixel) {
  const raw = Buffer.alloc((width * 4 + 1) * height)
  for (let y = 0; y < height; y++) {
    const row = y * (width * 4 + 1)
    for (let x = 0; x < width; x++) raw.set(pixel(x, y), row + 1 + x * 4)
  }
  const chunk = (type, data) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length)
    const body = Buffer.concat([Buffer.from(type, 'ascii'), data])
    const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(body))
    return Buffer.concat([len, body, crc])
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(width, 0); ihdr.writeUInt32BE(height, 4); ihdr[8] = 8; ihdr[9] = 6
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))])
}

/**
 * Two images that must take different paths into the book: a photo far larger
 * than an e-reader screen (opaque, so it should come out a downscaled JPEG),
 * and a small icon with transparent corners (kept byte-for-byte as PNG).
 */
export const IMAGES = {
  photo: { file: 'big-photo.png', width: 2000, height: 1000, bytes: png(2000, 1000, (x, y) => [x % 256, y % 256, (x ^ y) % 256, 255]) },
  icon: { file: 'icon.png', width: 32, height: 32, bytes: png(32, 32, (x, y) => ((x < 4 && y < 4) ? [0, 0, 0, 0] : [20, 120, 110, 255])) },
  remote: 'https://example.com/remote.png',
}

/** What every case expects to find in the exported book. */
export const EXPECT = {
  pages: ['ADKAR', 'Kotter 8-Step', 'Jeffrey Hiatt'],
  tag: 'framework',
  alias: 'adkar-model',
  journalMarker: 'journal entry about',
  heading: 'The five blocks',
  childText: 'child block',
  /** A name that must be escaped in XHTML but looked up unescaped. */
  specialPage: 'R&D',
  multiWordTag: 'change management',
  picturesPage: 'Pictures',
}

/** Logseq OG: a file graph on disk. */
export function writeFileGraph(dir) {
  for (const sub of ['logseq', 'pages', 'journals']) mkdirSync(join(dir, sub), { recursive: true })
  writeFileSync(join(dir, 'logseq/config.edn'), '{:journal/page-title-format "MMM do, yyyy"}\n')
  writeFileSync(
    join(dir, 'pages/ADKAR.md'),
    [
      'type:: framework',
      'alias:: adkar-model',
      '',
      '- Created by [[Jeffrey Hiatt]], compared with [[Kotter 8-Step]] #framework',
      '\t- child block with **bold** text',
      '- ## The five blocks',
      '\t- Awareness, Desire, Knowledge, Ability, Reinforcement',
      '',
    ].join('\n'),
  )
  writeFileSync(
    join(dir, 'pages/Kotter 8-Step.md'),
    ['type:: framework', '', '- Links back to [[adkar-model]] #framework', '- {{query (property type "framework")}}', ''].join('\n'),
  )
  writeFileSync(join(dir, 'pages/Jeffrey Hiatt.md'), '- Founder of Prosci, works in [[R&D]] #[[change management]]\n')
  writeFileSync(join(dir, 'pages/R&D.md'), '- research <and> development\n')
  writeFileSync(join(dir, 'journals/2024_01_15.md'), '- journal entry about [[ADKAR]]\n')
  mkdirSync(join(dir, 'assets'), { recursive: true })
  for (const img of [IMAGES.photo, IMAGES.icon]) writeFileSync(join(dir, 'assets', img.file), img.bytes)
  writeFileSync(
    join(dir, 'pages/Pictures.md'),
    [
      `- A photo: ![A big photo](../assets/${IMAGES.photo.file})`,
      `- ![An icon](../assets/${IMAGES.icon.file}){:height 32, :width 32}`,
      `- ![web image](${IMAGES.remote})`,
      '',
    ].join('\n'),
  )
  return dir
}

/**
 * Logseq 2.x: seed the open DB graph through `logseq.api`, from the page.
 *
 * Properties set this way are scoped to a test plugin
 * (`:plugin.property._test_plugin/type`), because the host refuses to let a
 * plugin write `:user.property/*`. They carry the same title ("type"), which
 * is what the exporter keys on, so the query case still means something.
 */
export async function seedDbGraph(cdp) {
  return cdp.evaluate(`(async () => {
    const a = logseq.api
    const page = async (name) => {
      await a.create_page(name, {}, { redirect: false, createFirstBlock: false })
      return a.get_page(name)
    }
    await page('R&D')
    await a.append_block_in_page('R&D', 'research <and> development')
    const hiatt = await page('Jeffrey Hiatt')
    await a.append_block_in_page('Jeffrey Hiatt', 'Founder of Prosci, works in [[R&D]] #[[change management]]')

    const kotter = await page('Kotter 8-Step')
    const adkar = await page('ADKAR')

    const first = await a.append_block_in_page('ADKAR', 'Created by [[Jeffrey Hiatt]], compared with [[Kotter 8-Step]] #framework')
    await a.insert_block(first.uuid, 'child block with **bold** text', { sibling: false })
    const head = await a.append_block_in_page('ADKAR', '## The five blocks')
    await a.insert_block(head.uuid, 'Awareness, Desire, Knowledge, Ability, Reinforcement', { sibling: false })
    await a.upsert_block_property(adkar.uuid, 'type', 'framework')
    await a.upsert_block_property(adkar.uuid, ':block/alias', ['adkar-model'])

    await a.append_block_in_page('Kotter 8-Step', 'Links back to [[adkar-model]] #framework')
    await a.append_block_in_page('Kotter 8-Step', '{{query (property type "framework")}}')
    await a.upsert_block_property(kotter.uuid, 'type', 'framework')

    const journal = await a.create_journal_page('2024-01-15')
    await a.append_block_in_page(journal.uuid, 'journal entry about [[ADKAR]]')
    return Boolean(hiatt && kotter && adkar && journal)
  })()`)
}

/**
 * Logseq 2.x: add the images the way a user does, by pasting files into a
 * block. There is no plugin API that creates an image block; the paste makes
 * the real thing (an asset block, the file at assets/<uuid>.png).
 */
export async function pasteDbImages(cdp) {
  const files = [IMAGES.photo, IMAGES.icon].map((i) => ({ name: i.file, b64: i.bytes.toString('base64') }))
  return cdp.evaluate(`(async () => {
    const a = logseq.api
    const page = ${JSON.stringify(EXPECT.picturesPage)}
    await a.create_page(page, {}, { redirect: true, createFirstBlock: false })
    await a.append_block_in_page(page, ${JSON.stringify(`![web image](${IMAGES.remote})`)})
    const assetBlocks = async () => (await a.get_page_blocks_tree(page)).filter((b) => b[':logseq.property.asset/type']).length
    for (const [i, f] of ${JSON.stringify(files)}.entries()) {
      const target = await a.append_block_in_page(page, 'paste target ' + i)
      await new Promise((r) => setTimeout(r, 800))
      await a.edit_block(target.uuid)
      await new Promise((r) => setTimeout(r, 800))
      const ta = document.querySelector('#main-content-container textarea')
      if (!ta) return 'no editor to paste into'
      const bytes = Uint8Array.from(atob(f.b64), (c) => c.charCodeAt(0))
      const dt = new DataTransfer()
      dt.items.add(new File([bytes], f.name, { type: 'image/png' }))
      ta.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }))
      const deadline = Date.now() + 15000
      while ((await assetBlocks()) < i + 1 && Date.now() < deadline) await new Promise((r) => setTimeout(r, 300))
      if ((await assetBlocks()) < i + 1) return 'the pasted ' + f.name + ' never became an asset block'
    }
    await a.exit_editing_mode?.()
    return true
  })()`, { timeoutMs: 60000 })
}
