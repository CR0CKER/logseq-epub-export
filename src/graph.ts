import '@logseq/libs'
import { SlugRegistry } from './slug'
import {
  DB_GRAPH_PREFIX,
  blockText,
  graphDisplayName,
  headingProperty,
  isBuiltInEntity,
  isJournalPage,
  normalizeDbProperties,
  pageTitle,
} from './entities'

/** A single block, normalized from Logseq's BlockEntity tree. */
export interface BlockNode {
  /** Raw block text with leading `key:: value` property lines removed. */
  content: string
  properties: Record<string, any>
  /** 1–6 when this block is a Markdown heading (`## …`), else undefined. */
  heading?: number
  children: BlockNode[]
}

export interface GraphPage {
  name: string
  slug: string
  isJournal: boolean
  journalDay: number
  properties: Record<string, any>
  tree: BlockNode[]
}

export interface Backlink {
  fromName: string
  fromSlug: string
  snippet: string
}

export interface GraphModel {
  graphName: string
  pages: GraphPage[]
  journals: GraphPage[]
  /** lowercased page-name OR alias OR tag → target slug (no extension). */
  nameToSlug: Map<string, string>
  /** lowercased names that resolve to a real chapter (pages + aliases + tags). */
  resolvable: Set<string>
  /** lowercased target name → pages that reference it. */
  backlinks: Map<string, Backlink[]>
  /** lowercased tag → set of member page display names. */
  tagMembers: Map<string, Set<string>>
  /** lowercased tag → tag-index slug. */
  tagSlug: Map<string, string>
  /** display label to show for a tag, lowercased tag → original casing. */
  tagLabel: Map<string, string>
}

const PROPERTY_LINE = /^[A-Za-z0-9_][A-Za-z0-9_-]*:: /
const HEADING = /^(#{1,6})\s+/
const WIKILINK = /\[\[([^\]]+)\]\]/g
const TAG_BRACKET = /#\[\[([^\]]+)\]\]/g
const TAG_PLAIN = /(^|[^\w#])#([A-Za-z0-9_][\w/-]*)/g

const lc = (s: string) => s.trim().toLowerCase()

/** Strip Logseq property lines (`key:: value`) from raw block content. */
function stripProperties(content: string): string {
  return content
    .split('\n')
    .filter((line) => !PROPERTY_LINE.test(line))
    .join('\n')
    .trim()
}

function toAliasList(value: any): string[] {
  if (!value) return []
  if (Array.isArray(value)) return value.map(String)
  return String(value)
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
}

function toTagList(value: any): string[] {
  if (!value) return []
  if (Array.isArray(value)) return value.map(String)
  return String(value)
    .split(/[,\s]+/)
    .map((s) => s.replace(/^#/, '').trim())
    .filter(Boolean)
}

function normalizeTree(blocks: any[], isDb: boolean): BlockNode[] {
  const out: BlockNode[] = []
  for (const b of blocks ?? []) {
    const rawContent = blockText(b)
    // File graphs keep block properties as `key:: value` lines in the text;
    // DB graphs keep them out of it, so there is nothing to strip there.
    const text = isDb ? rawContent.trim() : stripProperties(rawContent)
    const children = normalizeTree(b?.children ?? [], isDb)
    // Drop the page-properties pre-block and any block that became empty
    // after stripping properties and has no children.
    if (!text && children.length === 0) continue
    const hm = text.match(HEADING)
    const level = hm ? hm[1].length : headingProperty(b)
    out.push({
      // Headings from a property carry no `#` prefix; add one so the renderer
      // has a single form to strip.
      content: hm || !level ? text : `${'#'.repeat(level)} ${text}`,
      properties: b?.properties ?? {},
      heading: level,
      children,
    })
  }
  return out
}

/** Whether the open graph is a Logseq 2.x DB graph. */
async function detectDbGraph(graphUrl: string | undefined): Promise<boolean> {
  if (graphUrl?.startsWith(DB_GRAPH_PREFIX)) return true
  try {
    // Only 2.x hosts implement this; OG rejects the unknown method.
    return Boolean(await (logseq.App as any).checkCurrentIsDbGraph())
  } catch {
    return false
  }
}

/** DB-only lookups, fetched once per export. */
interface DbContext {
  propertyTitles: Map<string, string>
  builtInTags: Set<string>
}

async function loadDbContext(): Promise<DbContext> {
  const ctx: DbContext = { propertyTitles: new Map(), builtInTags: new Set() }
  const [properties, tags] = await Promise.all([
    (logseq.Editor as any).getAllProperties?.().catch(() => []) ?? [],
    (logseq.Editor as any).getAllTags?.().catch(() => []) ?? [],
  ])
  for (const p of properties ?? []) {
    const title = pageTitle(p)
    if (p?.ident && title) {
      const ident = String(p.ident)
      ctx.propertyTitles.set(ident, title)
      ctx.propertyTitles.set(ident.startsWith(':') ? ident : `:${ident}`, title)
    }
  }
  for (const t of tags ?? []) {
    if (!isBuiltInEntity(t) && !String(t?.ident ?? '').startsWith(':logseq.class/')) continue
    const title = pageTitle(t)
    if (title) ctx.builtInTags.add(title.toLowerCase())
  }
  return ctx
}

/** Scan a block's content for outgoing references, recording backlinks and
 *  inline-hashtag tag membership. */
function scanReferences(
  node: BlockNode,
  page: GraphPage,
  model: GraphModel,
): void {
  const text = node.content
  const snippet = text.replace(/\s+/g, ' ').slice(0, 160)

  const addBacklink = (target: string) => {
    const key = lc(target)
    if (!key || key === lc(page.name)) return
    const arr = model.backlinks.get(key) ?? []
    if (!arr.some((b) => b.fromName === page.name)) {
      arr.push({ fromName: page.name, fromSlug: page.slug, snippet })
      model.backlinks.set(key, arr)
    }
  }
  const addTag = (tag: string) => {
    const key = lc(tag)
    if (!key) return
    if (!model.tagLabel.has(key)) model.tagLabel.set(key, tag.trim())
    const set = model.tagMembers.get(key) ?? new Set<string>()
    set.add(page.name)
    model.tagMembers.set(key, set)
    addBacklink(tag)
  }

  let m: RegExpExecArray | null
  WIKILINK.lastIndex = 0
  while ((m = WIKILINK.exec(text))) addBacklink(m[1])
  TAG_BRACKET.lastIndex = 0
  while ((m = TAG_BRACKET.exec(text))) addTag(m[1])
  TAG_PLAIN.lastIndex = 0
  while ((m = TAG_PLAIN.exec(text))) addTag(m[2])

  for (const c of node.children) scanReferences(c, page, model)
}

/** Read the active graph and build the full export model in one pass. */
export async function collectGraph(
  onProgress?: (msg: string) => void,
): Promise<GraphModel> {
  const graph = await logseq.App.getCurrentGraph()
  const graphName = graphDisplayName(graph) || 'Logseq graph'
  const isDb = await detectDbGraph(graph?.url)
  const db = isDb ? await loadDbContext() : null

  const all = (await logseq.Editor.getAllPages()) ?? []
  // Real content pages only: exclude built-in/empty placeholder pages.
  const listed = all.filter((p: any) => p && p.name && !isBuiltInEntity(p))

  const slugs = new SlugRegistry()
  const model: GraphModel = {
    graphName,
    pages: [],
    journals: [],
    nameToSlug: new Map(),
    resolvable: new Set(),
    backlinks: new Map(),
    tagMembers: new Map(),
    tagSlug: new Map(),
    tagLabel: new Map(),
  }

  let i = 0
  for (const summary of listed) {
    i++
    if (onProgress && i % 25 === 0) onProgress(`Reading pages… ${i}/${listed.length}`)
    // 2.x's getAllPages returns a summary without `journalDay` or the
    // built-in flag; only the full entity carries them.
    const p = db ? { ...summary, ...((await logseq.Editor.getPage(summary.uuid).catch(() => null)) ?? {}) } : summary
    if (isBuiltInEntity(p)) continue
    const name = pageTitle(p)
    let tree: BlockNode[] = []
    try {
      const raw = await logseq.Editor.getPageBlocksTree(p.name)
      tree = normalizeTree(raw ?? [], isDb)
    } catch (e) {
      console.warn('logseq-epub-export: getPageBlocksTree failed for', name, e)
    }
    if (tree.length === 0) continue // skip empty/stub pages — no chapter

    let properties: Record<string, any> = p.properties ?? {}
    if (db) {
      try {
        const raw = await (logseq.Editor as any).getPageProperties(p.uuid)
        properties = normalizeDbProperties(raw, db.propertyTitles, db.builtInTags)
      } catch (e) {
        console.warn('logseq-epub-export: getPageProperties failed for', name, e)
      }
    }

    const isJournal = isJournalPage(p)
    const page: GraphPage = {
      name,
      slug: slugs.slug(name, isJournal ? 'j' : 'p'),
      isJournal,
      journalDay: p.journalDay ?? 0,
      properties,
      tree,
    }
    if (isJournal) model.journals.push(page)
    else model.pages.push(page)

    // Register canonical name + aliases as resolvable link targets.
    model.nameToSlug.set(lc(name), page.slug)
    model.resolvable.add(lc(name))
    for (const alias of toAliasList(page.properties.alias)) {
      model.nameToSlug.set(lc(alias), page.slug)
      model.resolvable.add(lc(alias))
    }
    // Property-level tags.
    for (const tag of toTagList(page.properties.tags)) {
      const key = lc(tag)
      if (!model.tagLabel.has(key)) model.tagLabel.set(key, tag)
      const set = model.tagMembers.get(key) ?? new Set<string>()
      set.add(name)
      model.tagMembers.set(key, set)
    }
  }

  // Inline reference scan (backlinks + inline hashtags), now that every page
  // and its slug is known.
  for (const page of [...model.pages, ...model.journals]) {
    for (const node of page.tree) scanReferences(node, page, model)
  }

  // Assign a chapter slug to every tag and register it as a link target.
  for (const tag of [...model.tagMembers.keys()].sort()) {
    const slug = slugs.slug(`tag-${tag}`, 'tag')
    model.tagSlug.set(tag, slug)
    if (!model.nameToSlug.has(tag)) model.nameToSlug.set(tag, slug)
    model.resolvable.add(tag)
  }

  // Sort for stable TOC output.
  model.pages.sort((a, b) => a.name.localeCompare(b.name))
  model.journals.sort((a, b) => b.journalDay - a.journalDay)

  return model
}

/** Resolve a link/tag name to a chapter href, or null if it has no chapter. */
export function resolveHref(model: GraphModel, name: string): string | null {
  const slug = model.nameToSlug.get(lc(name))
  return slug ? `${slug}.xhtml` : null
}
