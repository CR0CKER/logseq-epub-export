/**
 * The exported EPUB's file name.
 *
 * Follows Calibre's library naming, `<title> - <author>.epub`, with the
 * author the book declares (`dc:creator`). A book imported into Calibre is
 * stored under exactly that name, so a direct export and a Calibre copy match,
 * and KOReader, which keeps reading history per file name (`<name>.sdr`),
 * treats them as the same book.
 *
 * The rules reproduce Calibre's `DB.construct_file_name` on Linux (measured
 * against Calibre 9.14.0 output; see tests/filename.ts). One gap: Calibre
 * transliterates every script to ASCII (中文 → "Zhong Wen"); here only Latin
 * letters are, and other characters become `_`.
 *
 * Pure on purpose: no `@logseq/libs`, so it bundles into the Node tests.
 */

/** The author every exported book declares. */
export const EPUB_CREATOR = 'Logseq EPUB Export'

/**
 * Longest title Calibre keeps in a file name: (PATH_LIMIT 100 − extension
 * allowance 14 − 2) / 2, outside Windows.
 */
const TITLE_LIMIT = 42

/** Letters NFKD does not decompose, spelled the way Calibre spells them. */
const LATIN = new Map<string, string>([
  ['ß', 'ss'], ['ẞ', 'SS'], ['Æ', 'AE'], ['æ', 'ae'], ['Œ', 'OE'], ['œ', 'oe'],
  ['Ø', 'O'], ['ø', 'o'], ['Đ', 'D'], ['đ', 'd'], ['Ł', 'L'], ['ł', 'l'],
  ['Þ', 'TH'], ['þ', 'th'], ['Ð', 'D'], ['ð', 'd'], ['ı', 'i'],
  ['…', '...'], ['‘', "'"], ['’', "'"], ['“', '"'], ['”', '"'], ['–', '-'], ['—', '-'],
])

/** Calibre's ascii_text, for Latin scripts: anything else becomes `?`. */
function asciiText(s: string): string {
  let out = ''
  for (const ch of s) {
    const mapped = LATIN.get(ch) ?? ch.normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
    for (const c of mapped) out += c.charCodeAt(0) < 128 ? c : '?'
  }
  return out
}

/** Calibre's sanitize_file_name. */
function sanitize(name: string): string {
  let one = ''
  for (const c of name) one += '\\|?*<":>+/'.includes(c) || c.charCodeAt(0) < 32 ? '_' : c
  one = one.replace(/\s/g, ' ').trim()
  one = one.replace(/^\.+/, '_')
  while (one.includes('...')) one = one.replace(/\.\.\./g, '_.')
  if (one && (one.endsWith('.') || one.endsWith(' '))) one = `${one.slice(0, -1)}_`
  return one
}

/** Calibre's construct_file_name title part. */
function calibreTitle(title: string): string {
  const t = sanitize(asciiText(title.trimStart())).slice(0, TITLE_LIMIT).trimEnd()
  return t || 'Unknown'
}

function timestamp(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}`
}

export function epubFileName(opts: {
  graphName: string
  /** The "Output filename" setting: used as given (made file-name safe) when not blank. */
  filenameBase?: string
  versioned?: boolean
  now?: Date
}): string {
  const custom = (opts.filenameBase ?? '').trim().replace(/[\\/:*?"<>|\x00-\x1f]/g, '_')
  const base = custom || `${calibreTitle(opts.graphName)} - ${EPUB_CREATOR}`
  return opts.versioned ? `${base} ${timestamp(opts.now ?? new Date())}.epub` : `${base}.epub`
}
