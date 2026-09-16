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
