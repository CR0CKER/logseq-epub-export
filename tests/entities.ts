/**
 * Unit tests for src/entities.ts: the OG / 2.x entity normalization.
 * Fixtures are trimmed copies of what each build's API returned, captured live
 * (Logseq OG 1.0.0, Logseq 2.0.1) — see the table in src/entities.ts.
 */
import {
  blockText,
  graphDisplayName,
  headingProperty,
  isBuiltInEntity,
  isJournalPage,
  normalizeDbProperties,
  pageTitle,
  propertyTitle,
} from '../src/entities'

let failures = 0
function eq(actual: unknown, expected: unknown, msg: string) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected)
  if (ok) console.log('  ok:', msg)
  else { failures++; console.error(`  FAIL: ${msg}\n    expected ${JSON.stringify(expected)}\n    actual   ${JSON.stringify(actual)}`) }
}

// ── 2.x (DB) shapes ────────────────────────────────────────────────────────
const dbPage = { name: 'adkar', title: 'ADKAR', uuid: '6aaa742f-fd67-472c-aa75-b5773250b8b1', fullTitle: 'ADKAR' }
const dbBlock = {
  content: 'Created by [[6aaa7430-c2d5-404f-ae6e-a92d43ee421e]] #[[6aaa742f-ae52-4a49-b8da-2d6b90a3aab0]]',
  title: 'Created by [[6aaa7430-c2d5-404f-ae6e-a92d43ee421e]] #[[6aaa742f-ae52-4a49-b8da-2d6b90a3aab0]]',
  fullTitle: 'Created by [[Jeffrey Hiatt]] #framework',
}
const dbHeading = { content: 'Heading block', fullTitle: 'Heading block', ':logseq.property/heading': 2 }
const dbJournal = { name: 'sep 16th, 2026', title: 'Sep 16th, 2026', journalDay: 20260916 }
const dbBuiltIn = { name: 'deadline', title: 'Deadline', ':logseq.property/built-in?': true }

console.log('2.x entities')
eq(pageTitle(dbPage), 'ADKAR', 'page title keeps its casing from `title`')
eq(blockText(dbBlock), 'Created by [[Jeffrey Hiatt]] #framework', 'block text resolves references via fullTitle, not [[uuid]] content')
eq(headingProperty(dbHeading), 2, 'heading level comes from :logseq.property/heading')
eq(isJournalPage(dbJournal), true, 'a page with journalDay is a journal')
eq(isJournalPage(dbPage), false, 'a page without journalDay is not a journal')
eq(isBuiltInEntity(dbBuiltIn), true, 'built-in flag read from :logseq.property/built-in?')
eq(graphDisplayName({ name: 'logseq_db_Demo', url: 'logseq_db_Demo' }), 'Demo', 'graph name drops the logseq_db_ prefix')

const titles = new Map([[':user.property/type-BizT1cZF', 'type']])
eq(
  normalizeDbProperties(
    {
      ':user.property/type-BizT1cZF': 'framework',
      ':plugin.property._test_plugin/status': 'draft',
      ':block/alias': ['adkar-model'],
      ':block/tags': ['Page', 'framework'],
      ':logseq.property/icon': { type: 'emoji' },
    },
    titles,
    new Set(['page', 'journal', 'task']),
  ),
  { type: 'framework', status: 'draft', alias: ['adkar-model'], tags: ['framework'] },
  'DB properties: titled keys, alias/tags lifted, built-in classes and :logseq.* dropped',
)
eq(normalizeDbProperties({ ':block/tags': ['Journal'] }, new Map(), new Set(['journal'])), {}, 'a page tagged only with built-in classes has no tags')
eq(propertyTitle(':user.property/reading-list-Xy9_ab12', new Map()), 'reading-list', 'unknown ident falls back to namespace- and suffix-stripped name')

// ── OG (file graph) shapes: must pass through unchanged ────────────────────
const ogPage = { name: 'kotter 8-step', originalName: 'Kotter 8-Step', 'journal?': false, properties: { type: 'framework' } }
const ogBlock = { content: 'Links back to [[ADKAR]]', properties: {} }
const ogJournal = { name: 'jan 15th, 2024', originalName: 'Jan 15th, 2024', 'journal?': true, journalDay: 20240115 }

console.log('OG entities')
eq(pageTitle(ogPage), 'Kotter 8-Step', 'page title from originalName')
eq(blockText(ogBlock), 'Links back to [[ADKAR]]', 'block text is content when there is no fullTitle')
eq(headingProperty(ogBlock), undefined, 'no heading property → undefined (markdown ## is handled by the caller)')
eq(headingProperty({ properties: { heading: 3 } }), 3, 'heading:: 3 property')
eq(headingProperty({ properties: { heading: true } }), 2, 'heading:: true (auto) → h2')
eq(isJournalPage(ogJournal), true, 'journal? flag')
eq(isBuiltInEntity({ 'built-in?': true }), true, 'built-in? flag')
eq(graphDisplayName({ name: 'EPUB Live Test', url: 'logseq_local_/tmp/x/EPUB Live Test' }), 'EPUB Live Test', 'file graph name unchanged')
eq(graphDisplayName({ name: null, url: 'logseq_local_/home/u/notes/' }), 'notes', 'file graph without a name falls back to the folder')

if (failures > 0) { console.error(`\n${failures} assertion(s) FAILED`); process.exit(1) }
console.log('\nAll entity assertions passed.')
