/**
 * Normalize the entities Logseq's plugin API returns, so the rest of the
 * exporter sees one shape on both builds.
 *
 * Logseq 0.10.x (file graphs; also the logseq/og continuation) and Logseq 2.x
 * (DB graphs) answer the same API calls with different data. Measured on
 * 0.10.15, an OG 1.0.0 build and 2.0.1; the "OG" column is the file-graph shape:
 *
 * | | OG | 2.x |
 * |---|---|---|
 * | page display name | `originalName` (`name` is lowercased) | `title` (`name` is lowercased, no `originalName`) |
 * | block text | `content`, with `key:: value` lines | `content`/`title` hold links as `[[uuid]]`; `fullTitle` has them resolved |
 * | heading | `## ` prefix (or a `heading::` property) | a `:logseq.property/heading` number, text unprefixed |
 * | journal | `journal?` | only `journalDay` |
 * | built-in page | `built-in?` | `:logseq.property/built-in?`, and only on the full entity |
 * | page properties | `properties` on the page | `getPageProperties` → namespaced idents (`:user.property/type-Ab12cD34`) |
 * | graph name | the folder name | `logseq_db_<name>` |
 *
 * Pure on purpose: no `@logseq/libs` import, so it bundles into the Node tests.
 */

export const DB_GRAPH_PREFIX = 'logseq_db_'
const FILE_GRAPH_PREFIX = 'logseq_local_'

/** The page name a reader should see, in its original casing. */
export function pageTitle(page: any): string {
  return String(page?.originalName ?? page?.title ?? page?.name ?? '')
}

/** A graph's human name: no internal `logseq_db_`/`logseq_local_` prefix, no path. */
export function graphDisplayName(graph: { name?: string | null; url?: string | null } | null | undefined): string {
  let name = String(graph?.name || graph?.url || '')
  for (const prefix of [DB_GRAPH_PREFIX, FILE_GRAPH_PREFIX]) {
    if (name.startsWith(prefix)) name = name.slice(prefix.length)
  }
  // A file-graph url is a path; keep only the folder name.
  name = name.replace(/[\\/]+$/, '').split(/[\\/]/).pop() ?? ''
  return name.trim()
}

export function isJournalPage(page: any): boolean {
  return Boolean(page?.['journal?']) || (typeof page?.journalDay === 'number' && page.journalDay > 0)
}

export function isBuiltInEntity(entity: any): boolean {
  return Boolean(entity?.['built-in?'] || entity?.[':logseq.property/built-in?'])
}

/**
 * A block's readable text. On a DB graph `fullTitle` carries references by
 * name; `content` would give `[[6aaa742f-…]]`, which no reader can follow.
 */
export function blockText(block: any): string {
  if (typeof block?.fullTitle === 'string') return block.fullTitle
  return String(block?.content ?? '')
}

/** Heading level 1–6 from block data rather than text: DB's heading property, or OG's `heading::`. */
export function headingProperty(block: any): number | undefined {
  const raw = block?.[':logseq.property/heading'] ?? block?.properties?.heading
  if (typeof raw === 'number' && raw >= 1 && raw <= 6) return raw
  // OG's "auto" heading (`heading:: true`) follows the block's depth; a
  // top-level section heading reads best as an h2.
  if (raw === true || raw === 'true') return 2
  return undefined
}

/** Built-in class tags every DB page carries; used when the live list is unavailable. */
const STRUCTURAL_TAGS = new Set(['page', 'journal'])

/**
 * Turn DB page properties (`getPageProperties`) into the plain
 * `{ alias, tags, type, … }` map the OG code path already reads.
 *
 * `titles` maps a property ident to its display title (from
 * `getAllProperties`). `builtInTags` holds the lowercased titles of Logseq's
 * own classes (Page, Journal, Task, …), which every page carries as app
 * structure rather than as a tag the user chose. Built-in `:logseq.*`
 * properties are dropped: they are app state (icons, timestamps, heading).
 */
export function normalizeDbProperties(
  raw: Record<string, any> | null | undefined,
  titles: Map<string, string>,
  builtInTags: Set<string> = STRUCTURAL_TAGS,
): Record<string, any> {
  const out: Record<string, any> = {}
  for (const [key, value] of Object.entries(raw ?? {})) {
    if (value == null) continue
    if (key === ':block/alias') { out.alias = toStringList(value); continue }
    if (key === ':block/tags') {
      const tags = toStringList(value).filter((t) => !builtInTags.has(t.toLowerCase()))
      if (tags.length) out.tags = tags
      continue
    }
    if (key.startsWith(':logseq.') || key.startsWith(':block/')) continue
    out[propertyTitle(key, titles)] = value
  }
  return out
}

function toStringList(value: any): string[] {
  return (Array.isArray(value) ? value : [value]).map(String).filter(Boolean)
}

/** `:user.property/type-Ab12cD34` → "type", preferring the title Logseq has on record. */
export function propertyTitle(ident: string, titles: Map<string, string>): string {
  const known = titles.get(ident) ?? titles.get(ident.replace(/^:/, ''))
  if (known) return known
  // No record: strip the namespace, and the random suffix 2.x appends to
  // user property idents to keep them unique.
  return ident.replace(/^:?[^/]*\//, '').replace(/-[A-Za-z0-9_]{8}$/, '')
}
