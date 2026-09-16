/**
 * Unit tests for src/filename.ts: the exported EPUB's file name follows
 * Calibre's library naming, "<title> - <author>.epub", so a book exported
 * directly and one that went through Calibre carry the same name (and
 * KOReader, which keys reading history on the file name, treats them alike).
 *
 * The expected names are Calibre's own output, not a re-derivation: produced
 * by `calibre.db.backend.DB.construct_file_name(…, title, 'Logseq EPUB Export',
 * 5)` under `calibre-debug` (Calibre 9.14.0, Linux, PATH_LIMIT 100).
 */
import { EPUB_CREATOR, epubFileName } from '../src/filename'

let failures = 0
function eq(actual: unknown, expected: unknown, msg: string) {
  if (actual === expected) console.log('  ok:', msg)
  else { failures++; console.error(`  FAIL: ${msg}\n    expected ${JSON.stringify(expected)}\n    actual   ${JSON.stringify(actual)}`) }
}

console.log('epubFileName: Calibre\'s own names')
eq(EPUB_CREATOR, 'Logseq EPUB Export', 'the author the EPUB declares')
const CALIBRE: [string, string][] = [
  ['Change Management', 'Change Management - Logseq EPUB Export'],
  ['R&D: 2026/Q3?', 'R&D_ 2026_Q3_ - Logseq EPUB Export'],
  ['a+b <c> "d" |e| *f*', 'a_b _c_ _d_ _e_ _f_ - Logseq EPUB Export'],
  ['tab\tsep', 'tab_sep - Logseq EPUB Export'],
  ['  lead space', 'lead space - Logseq EPUB Export'],
  ['trail space  ', 'trail space - Logseq EPUB Export'],
  ['Ünïcödé Grāph', 'Unicode Graph - Logseq EPUB Export'],
  ['Straße', 'Strasse - Logseq EPUB Export'],
  ['Œuvre æ', 'OEuvre ae - Logseq EPUB Export'],
  ['Emoji 📚 notes', 'Emoji _ notes - Logseq EPUB Export'],
  ["it's; #1 at 100% & [x]{y}(z), ok. end", "it's; #1 at 100% & [x]{y}(z), ok. end - Logseq EPUB Export"],
  ['Notes.', 'Notes_ - Logseq EPUB Export'],
  ['Notes..', 'Notes._ - Logseq EPUB Export'],
  ['Notes...', 'Notes__ - Logseq EPUB Export'],
  ['Notes....', 'Notes_._ - Logseq EPUB Export'],
  ['Notes.....', 'Notes___ - Logseq EPUB Export'],
  ['Notes …', 'Notes __ - Logseq EPUB Export'],
  ['a..b', 'a..b - Logseq EPUB Export'],
  ['a...b', 'a_.b - Logseq EPUB Export'],
  ['a.b.', 'a.b_ - Logseq EPUB Export'],
  ['v1.2', 'v1.2 - Logseq EPUB Export'],
  ['x. .', 'x. _ - Logseq EPUB Export'],
  ['.hidden', '_hidden - Logseq EPUB Export'],
  ['..x', '_x - Logseq EPUB Export'],
  ['.', '_ - Logseq EPUB Export'],
  ['...', '_ - Logseq EPUB Export'],
  ['x'.repeat(60), 'x'.repeat(42) + ' - Logseq EPUB Export'],
  ['y'.repeat(41) + ' z', 'y'.repeat(41) + ' - Logseq EPUB Export'],
  ['A very long graph name that goes on and on and on beyond forty chars', 'A very long graph name that goes on and on - Logseq EPUB Export'],
  ['', 'Unknown - Logseq EPUB Export'],
  ['   ', 'Unknown - Logseq EPUB Export'],
]
for (const [title, name] of CALIBRE) eq(epubFileName({ graphName: title }), `${name}.epub`, JSON.stringify(title))

console.log('epubFileName: settings')
const now = new Date(2026, 8, 16, 17, 5)
eq(epubFileName({ graphName: 'Change Management', filenameBase: '   ', now }), 'Change Management - Logseq EPUB Export.epub', 'a blank Output filename means the Calibre name')
eq(epubFileName({ graphName: 'Change Management', versioned: true, now }), 'Change Management - Logseq EPUB Export 2026-09-16-1705.epub', 'versioned: timestamp after the Calibre name')
eq(epubFileName({ graphName: 'Change Management', filenameBase: 'My book', now }), 'My book.epub', 'a custom Output filename is used as given')
eq(epubFileName({ graphName: 'Change Management', filenameBase: 'My: book?', versioned: true, now }), 'My_ book_ 2026-09-16-1705.epub', 'custom + versioned, illegal characters replaced')

if (failures > 0) { console.error(`\n${failures} assertion(s) FAILED`); process.exit(1) }
console.log('\nAll filename assertions passed.')
