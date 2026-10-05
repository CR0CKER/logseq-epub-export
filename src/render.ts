import type { BlockNode, GraphModel, GraphPage } from './graph'
import { MD_IMAGE, assetKey } from './assets'
import { BLOCK_REF, EMBED, LABELLED_REF } from './refs'

const lc = (s: string) => s.trim().toLowerCase()

export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

/** Inverse of escapeHtml, for looking up names taken from already-escaped text. */
function unescapeHtml(s: string): string {
  return s.replace(/&quot;/g, '"').replace(/&gt;/g, '>').replace(/&lt;/g, '<').replace(/&amp;/g, '&')
}

const WIKILINK = /\[\[([^\]]+)\]\]/g
const TAG_BRACKET = /#\[\[([^\]]+)\]\]/g
const TAG_PLAIN = /(^|[^\w#&])#([A-Za-z0-9_][\w/-]*)/g
const MD_LINK = /\[([^\]]+)\]\(([^)]+)\)/g
const BARE_URL = /(^|[\s(])((?:https?:\/\/)[^\s)<]+)/g

/** Render one block's inline Logseq markdown to safe XHTML. */
export function renderInline(text: string, model: GraphModel): string {
  // 1. Escape HTML up front; brackets/parens survive for our own parsing.
  //    Private-use characters are reserved for the placeholders below.
  let s = escapeHtml(text.replace(/[]/g, ''))

  // Every finished fragment is swapped for a placeholder, so no later rule
  // can reach into it: `[[…]]` consuming the inside of `#[[multi word]]`, or
  // emphasis rules rewriting a code span.
  const done: string[] = []
  const hold = (html: string) => `${done.push(html) - 1}`

  // 2. Inline code spans.
  s = s.replace(/`([^`]+)`/g, (_m, c) => hold(`<code>${c}</code>`))

  // 3. Images: graph assets that loaded are embedded; web images stay links
  //    (the export makes no network requests); anything else keeps a
  //    labelled placeholder.
  s = s.replace(MD_IMAGE, (_m, alt, src) => {
    const raw = unescapeHtml(String(src))
    const base = String(src).split('/').pop() || String(src)
    const label = (alt && String(alt).trim()) || base
    const key = assetKey(raw)
    const href = key ? model.images.get(key) : undefined
    if (href) return hold(`<img src="${escapeHtml(href)}" alt="${label}" />`)
    if (/^https?:\/\//i.test(raw.trim())) return hold(`<a class="ext" href="${String(src).trim()}">[image: ${label}]</a>`)
    return hold(`<span class="asset">[image: ${label}]</span>`)
  })

  // 4. Embeds and block references, before Markdown links: `[label](((uuid)))`
  //    looks like one. An embed still here sits inside other text, so it
  //    becomes a link; renderNodeList shows a block's embeds in full.
  s = s.replace(EMBED, (_m, uuid, name) =>
    hold(uuid ? blockRefAnchor(model, uuid) : pageLink(model, unescapeHtml(name), name)))
  s = s.replace(LABELLED_REF, (_m, label, uuid) => hold(blockRefAnchor(model, uuid, label)))
  s = s.replace(BLOCK_REF, (_m, uuid) => hold(blockRefAnchor(model, uuid)))

  // 5. Standard Markdown links [text](url).
  s = s.replace(MD_LINK, (_m, label, url) => hold(`<a class="ext" href="${url}">${label}</a>`))

  // 6. Bracketed tags before [[wikilinks]]: `#[[multi word]]` contains one.
  //    Names here are escaped text, so look them up by the real name, or
  //    `[[R&D]]` never finds "R&D".
  s = s.replace(TAG_BRACKET, (_m, name) => hold(tagAnchor(model, unescapeHtml(name))))

  // 7. Wikilinks [[Page]].
  s = s.replace(WIKILINK, (_m, name) => hold(pageLink(model, unescapeHtml(name), name)))

  // 8. Plain #tags.
  s = s.replace(TAG_PLAIN, (_m, pre, name) => `${pre}${hold(tagAnchor(model, unescapeHtml(name)))}`)

  // 9. Bare URLs, before emphasis can reach into one.
  s = s.replace(BARE_URL, (_m, pre, url) => `${pre}${hold(`<a class="ext" href="${url}">${url}</a>`)}`)

  // 10. Emphasis.
  s = s.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
  s = s.replace(/(^|[^*])\*([^*]+)\*/g, '$1<em>$2</em>')
  s = s.replace(/(^|[^_\w])_([^_]+)_/g, '$1<em>$2</em>')

  // 11. Restore held fragments. A held Markdown-link label can itself hold
  //     one, so repeat until none are left.
  const PLACEHOLDER = /(\d+)/g
  while (/\d+/.test(s)) s = s.replace(PLACEHOLDER, (_m, i) => done[Number(i)])
  return s
}

/** A page link, or grey text when the page has no chapter. `label` is escaped. */
function pageLink(model: GraphModel, name: string, label: string): string {
  const slug = model.nameToSlug.get(lc(name))
  return slug ? `<a href="${slug}.xhtml">${label}</a>` : `<span class="missing">${label}</span>`
}

/** The anchor id a referenced block carries in its chapter. */
const blockAnchor = (uuid: string) => `b-${uuid.toLowerCase()}`

/**
 * A block reference: a link to the block in its chapter, labelled with the
 * block's text (or the reference's own `label`, already escaped).
 */
function blockRefAnchor(model: GraphModel, uuid: string, label?: string): string {
  const target = model.blocks?.get(uuid.toLowerCase())
  if (!target) return `<span class="missing">${label ?? '[block reference]'}</span>`
  const text = label ?? (escapeHtml(plainText(target.node.content, model)) || '[block]')
  return `<a href="${target.slug}.xhtml#${blockAnchor(uuid)}">${text}</a>`
}

/**
 * A referenced block's first line as plain words, for a link label: links,
 * images and emphasis reduced to their text, nested references to theirs,
 * embeds dropped.
 * Nesting stops after a few levels, so blocks that reference each other
 * cannot loop.
 */
function plainText(content: string, model: GraphModel, depth = 0): string {
  const refText = (uuid: string) => {
    const t = depth < 3 ? model.blocks?.get(uuid.toLowerCase()) : undefined
    return t ? plainText(t.node.content, model, depth + 1) : '…'
  }
  return content
    .split('\n')[0]
    .replace(/^#{1,6}\s+/, '')
    .replace(EMBED, '') // an embed shows another block; it is not this one's text
    .replace(LABELLED_REF, '$1')
    .replace(BLOCK_REF, (_m, uuid) => refText(uuid))
    .replace(MD_IMAGE, '$1')
    .replace(MD_LINK, '$1')
    .replace(TAG_BRACKET, '#$1')
    .replace(WIKILINK, '$1')
    .replace(/\*\*|==|~~|`/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

/** A tag link. `name` is the raw (unescaped) tag name. */
function tagAnchor(model: GraphModel, name: string): string {
  const key = lc(name)
  const slug = model.tagSlug.get(key) ?? model.nameToSlug.get(key)
  const label = escapeHtml(model.tagLabel.get(key) ?? name)
  if (slug) return `<a class="tag" href="${slug}.xhtml">#${label}</a>`
  return `<span class="tag">#${label}</span>`
}

// ── Block tree → XHTML ──────────────────────────────────────────────────────

function isTable(content: string): boolean {
  const lines = content.split('\n').map((l) => l.trim())
  return lines.filter((l) => l.startsWith('|')).length >= 2 &&
    lines.some((l) => /^\|[\s:|-]+\|?$/.test(l))
}

function renderTable(content: string, model: GraphModel): string {
  const rows = content
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.startsWith('|'))
  const cells = (line: string) =>
    line.replace(/^\||\|$/g, '').split('|').map((c) => c.trim())
  const isSep = (line: string) => /^\|[\s:|-]+\|?$/.test(line)
  let html = '<table>'
  let body = false
  for (const r of rows) {
    if (isSep(r)) { body = true; continue }
    const tag = body ? 'td' : 'th'
    html += '<tr>' + cells(r).map((c) => `<${tag}>${renderInline(c, model)}</${tag}>`).join('') + '</tr>'
  }
  return html + '</table>'
}

const QUERY = /\{\{query\s+(.+?)\}\}/s
const PROP_QUERY = /\(property\s+([A-Za-z0-9_-]+)\s+"?([^")]+?)"?\s*\)/

function renderQuery(content: string, model: GraphModel): string | null {
  const qm = content.match(QUERY)
  if (!qm) return null
  const pm = qm[1].match(PROP_QUERY)
  if (!pm) return '<p class="query-note">(dynamic query omitted)</p>'
  const key = lc(pm[1])
  const want = lc(pm[2])
  const hits = model.pages.filter((p) => {
    const v = p.properties[key] ?? p.properties[pm[1]]
    if (v == null) return false
    const vals = Array.isArray(v) ? v.map(String) : [String(v)]
    return vals.some((x) => lc(x) === want)
  })
  if (hits.length === 0) return '<p class="query-note">(no matches)</p>'
  const items = hits
    .map((p) => `<li><a href="${p.slug}.xhtml">${escapeHtml(p.name)}</a></li>`)
    .join('')
  return `<ul class="query-result">${items}</ul>`
}

/** Where a block list is being rendered: inside which embeds, if any. */
interface ListContext {
  /** `b:<uuid>` / `p:<page>` of the embeds being rendered, outermost first. */
  embeds: string[]
}

const TOP: ListContext = { embeds: [] }

/** Embeds inside embeds stop here and become links. */
const MAX_EMBED_DEPTH = 3

/** Render a list of sibling blocks, grouping plain bullets into <ul> runs and
 *  breaking out headings, tables and queries as their own elements. */
function renderNodeList(nodes: BlockNode[], model: GraphModel, ctx: ListContext = TOP): string {
  let html = ''
  let li: string[] = []
  const flush = () => {
    if (li.length) { html += `<ul>${li.join('')}</ul>`; li = [] }
  }
  for (const node of nodes) {
    // A referenced block carries an anchor to land on. Not inside an embed:
    // the copy would repeat the id, and the reference belongs to the original.
    const id = !ctx.embeds.length && node.uuid && model.refTargets?.has(node.uuid.toLowerCase())
      ? ` id="${blockAnchor(node.uuid)}"`
      : ''
    const kids = () => (node.children.length ? renderNodeList(node.children, model, ctx) : '')
    if (node.heading) {
      flush()
      const level = Math.min(node.heading + 1, 6) // page title is h1
      const headText = node.content.replace(/^#{1,6}\s+/, '')
      html += `<h${level}${id}>${renderInline(headText, model)}</h${level}>` + kids()
      continue
    }
    if (isTable(node.content)) {
      flush()
      html += (id ? `<a${id}></a>` : '') + renderTable(node.content, model) + kids()
      continue
    }
    const q = renderQuery(node.content, model)
    if (q) {
      flush()
      html += (id ? `<a${id}></a>` : '') + q + kids()
      continue
    }
    let inner: string
    if (node.image) {
      inner = renderImageBlock(node.image, model)
    } else {
      const embeds = [...node.content.matchAll(EMBED)]
      const text = embeds.length ? node.content.replace(EMBED, '').trim() : node.content
      inner = (text ? renderInline(text, model) : '') +
        embeds.map((m) => renderEmbed(m[1], m[2], model, ctx)).join('')
    }
    li.push(`<li${id}>${inner}${kids()}</li>`)
  }
  flush()
  return html
}

/**
 * An embedded block (with its children) or page, shown in full inside the
 * embedding block. An embed of something already being embedded, or nested
 * too deep, is a link instead, so self-embeds cannot recurse.
 */
function renderEmbed(uuid: string | undefined, name: string | undefined, model: GraphModel, ctx: ListContext): string {
  const key = uuid ? `b:${uuid.toLowerCase()}` : `p:${lc(name ?? '')}`
  const asLink = () => `<p>${uuid ? blockRefAnchor(model, uuid) : pageLink(model, name ?? '', escapeHtml(name ?? ''))}</p>`
  if (ctx.embeds.includes(key) || ctx.embeds.length >= MAX_EMBED_DEPTH) return asLink()
  const inner: ListContext = { embeds: [...ctx.embeds, key] }
  if (uuid) {
    const target = model.blocks?.get(uuid.toLowerCase())
    if (!target) return asLink()
    return `<div class="embed">${renderNodeList([target.node], model, inner)}</div>`
  }
  const slug = model.nameToSlug.get(lc(name ?? ''))
  const page = slug ? [...model.pages, ...model.journals].find((p) => p.slug === slug) : undefined
  if (!page) return asLink()
  return `<div class="embed"><p class="embed-title"><a href="${page.slug}.xhtml">${escapeHtml(page.name)}</a></p>` +
    `${renderNodeList(page.tree, model, inner)}</div>`
}

/** A 2.x DB image block: the image, or its placeholder if it did not load. */
function renderImageBlock(image: { key: string; alt: string }, model: GraphModel): string {
  const href = model.images.get(image.key)
  const alt = escapeHtml(image.alt)
  return href ? `<img src="${escapeHtml(href)}" alt="${alt}" />` : `<span class="asset">[image: ${alt}]</span>`
}

function propertiesTable(page: GraphPage, model: GraphModel): string {
  const skip = new Set(['id', 'title', 'collapsed'])
  const entries = Object.entries(page.properties).filter(([k]) => !skip.has(lc(k)))
  if (entries.length === 0) return ''
  const rows = entries
    .map(([k, v]) => {
      const vals = Array.isArray(v) ? v : [v]
      const rendered = vals
        .map((x) => lc(k) === 'tags' ? tagAnchor(model, String(x)) : renderInline(String(x), model))
        .join(', ')
      return `<tr><th>${escapeHtml(k)}</th><td>${rendered}</td></tr>`
    })
    .join('')
  return `<table class="props">${rows}</table>`
}

function backlinksSection(page: GraphPage, model: GraphModel): string {
  const keys = new Set<string>([lc(page.name)])
  for (const alias of (Array.isArray(page.properties.alias)
    ? page.properties.alias
    : page.properties.alias ? [page.properties.alias] : [])) {
    keys.add(lc(String(alias)))
  }
  const seen = new Set<string>()
  const items: string[] = []
  for (const k of keys) {
    for (const bl of model.backlinks.get(k) ?? []) {
      if (seen.has(bl.fromName)) continue
      seen.add(bl.fromName)
      items.push(
        `<li><a href="${bl.fromSlug}.xhtml">${escapeHtml(bl.fromName)}</a>` +
        (bl.snippet ? ` — <span class="snip">${renderInline(bl.snippet, model)}</span>` : '') +
        `</li>`,
      )
    }
  }
  if (items.length === 0) return ''
  return `<div class="backlinks"><h2>Linked References</h2><ul>${items.join('')}</ul></div>`
}

// ── Chapter documents ───────────────────────────────────────────────────────

export interface Chapter { slug: string; title: string; xhtml: string }

const CSS_HREF = 'style.css'

function xhtmlDoc(title: string, body: string): string {
  return `<?xml version="1.0" encoding="utf-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xml:lang="en" lang="en">
<head>
<meta charset="utf-8" />
<title>${escapeHtml(title)}</title>
<link rel="stylesheet" type="text/css" href="${CSS_HREF}" />
</head>
<body>
${body}
</body>
</html>`
}

export function renderPageChapter(page: GraphPage, model: GraphModel): Chapter {
  const body =
    `<h1>${escapeHtml(page.name)}</h1>` +
    propertiesTable(page, model) +
    renderNodeList(page.tree, model) +
    backlinksSection(page, model)
  return { slug: page.slug, title: page.name, xhtml: xhtmlDoc(page.name, body) }
}

export function renderTagChapter(tag: string, model: GraphModel): Chapter {
  const slug = model.tagSlug.get(tag)!
  const label = model.tagLabel.get(tag) ?? tag
  const members = [...(model.tagMembers.get(tag) ?? new Set<string>())].sort((a, b) => a.localeCompare(b))
  const items = members
    .map((name) => {
      const s = model.nameToSlug.get(lc(name))
      return s ? `<li><a href="${s}.xhtml">${escapeHtml(name)}</a></li>` : `<li>${escapeHtml(name)}</li>`
    })
    .join('')
  const body = `<h1>#${escapeHtml(label)}</h1><p class="muted">${members.length} page(s)</p><ul>${items}</ul>`
  return { slug, title: `#${label}`, xhtml: xhtmlDoc(`#${label}`, body) }
}

export const HOME_SLUG = 'index'

export function renderHomeChapter(model: GraphModel): Chapter {
  const pageItems = model.pages
    .map((p) => `<li><a href="${p.slug}.xhtml">${escapeHtml(p.name)}</a></li>`)
    .join('')
  const tagItems = [...model.tagSlug.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([tag, slug]) => `<li><a href="${slug}.xhtml">#${escapeHtml(model.tagLabel.get(tag) ?? tag)}</a></li>`)
    .join('')
  const journalItems = model.journals
    .map((p) => `<li><a href="${p.slug}.xhtml">${escapeHtml(p.name)}</a></li>`)
    .join('')

  let body = `<h1>${escapeHtml(model.graphName)}</h1>`
  body += `<p class="muted">${model.pages.length} pages · ${model.tagSlug.size} tags · ${model.journals.length} journals</p>`
  body += `<h2>Pages</h2><ul class="cols">${pageItems}</ul>`
  if (tagItems) body += `<h2>Tags</h2><ul class="cols">${tagItems}</ul>`
  if (journalItems) body += `<h2>Journals</h2><ul>${journalItems}</ul>`
  return { slug: HOME_SLUG, title: model.graphName, xhtml: xhtmlDoc(model.graphName, body) }
}

export const STYLE_CSS = `
body { font-family: Georgia, serif; line-height: 1.5; margin: 1em; color: #000; }
h1 { font-size: 1.5em; margin: 0 0 .3em; }
h2 { font-size: 1.2em; margin: 1.2em 0 .3em; border-bottom: 1px solid #999; }
h3, h4, h5, h6 { font-size: 1.05em; margin: 1em 0 .2em; }
a { color: #000; text-decoration: underline; }
a.ext { text-decoration: underline dotted; }
a.tag { font-size: .9em; }
.missing { color: #777; }
.muted, .query-note { color: #777; font-size: .9em; }
ul { margin: .2em 0 .2em 1.1em; padding: 0; }
li { margin: .15em 0; }
table { border-collapse: collapse; margin: .5em 0; width: 100%; }
th, td { border: 1px solid #999; padding: .25em .5em; text-align: left; vertical-align: top; }
table.props { width: auto; font-size: .9em; }
table.props th { background: #eee; }
.backlinks { margin-top: 1.5em; border-top: 2px solid #999; padding-top: .5em; }
.snip { color: #555; font-size: .9em; }
.asset { color: #777; font-style: italic; }
.embed { border-left: 2px solid #999; padding-left: .6em; margin: .3em 0; }
.embed-title { font-weight: bold; margin: 0 0 .2em; }
code { font-family: monospace; background: #eee; padding: 0 .2em; }
img { max-width: 100%; height: auto; }
`
