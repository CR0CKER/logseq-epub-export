import '@logseq/libs'
import { SlugRegistry } from './slug'

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

function normalizeTree(blocks: any[]): BlockNode[] {
  const out: BlockNode[] = []
  for (const b of blocks ?? []) {
    const rawContent: string = b?.content ?? ''
    const content = stripProperties(rawContent)
    const children = normalizeTree(b?.children ?? [])
    // Drop the page-properties pre-block and any block that became empty
    // after stripping properties and has no children.
    if (!content && children.length === 0) continue
    const hm = content.match(HEADING)
    out.push({
      content,
      properties: b?.properties ?? {},
      heading: hm ? hm[1].length : undefined,
      children,
    })
  }
  return out
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
  const graphName = graph?.name || 'Logseq graph'

  const all = (await logseq.Editor.getAllPages()) ?? []
  // Real content pages only: exclude built-in/empty placeholder pages.
  const candidates = all.filter((p: any) => p && p.name && !p['built-in?'])

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
  for (const p of candidates) {
    i++
    if (onProgress && i % 25 === 0) onProgress(`Reading pages… ${i}/${candidates.length}`)
    const name: string = p.originalName ?? p.name
    let tree: BlockNode[] = []
    try {
      const raw = await logseq.Editor.getPageBlocksTree(p.name)
      tree = normalizeTree(raw ?? [])
    } catch (e) {
      console.warn('logseq-epub-export: getPageBlocksTree failed for', name, e)
    }
    if (tree.length === 0) continue // skip empty/stub pages — no chapter

    const isJournal = !!p['journal?']
    const page: GraphPage = {
      name,
      slug: slugs.slug(name, isJournal ? 'j' : 'p'),
      isJournal,
      journalDay: p.journalDay ?? 0,
      properties: p.properties ?? {},
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
