import { collectGraph } from './graph'
import { buildEpub, NavGroup } from './epub'
import {
  Chapter,
  HOME_SLUG,
  renderHomeChapter,
  renderPageChapter,
  renderTagChapter,
} from './render'

export interface ExportResult {
  graphName: string
  bytes: ArrayBuffer
  stats: { pages: number; tags: number; journals: number }
}

export interface ExportOptions {
  includeJournals?: boolean
}

/** Full pipeline: read the active graph and produce an EPUB ArrayBuffer. */
export async function exportGraphToEpub(
  onProgress?: (msg: string) => void,
  options: ExportOptions = {},
): Promise<ExportResult> {
  const { includeJournals = true } = options
  onProgress?.('Reading graph…')
  const model = await collectGraph(onProgress)

  onProgress?.('Rendering chapters…')
  const home = renderHomeChapter(model)
  const pageChapters = model.pages.map((p) => renderPageChapter(p, model))
  const tagKeys = [...model.tagSlug.keys()].sort()
  const tagChapters = tagKeys.map((t) => renderTagChapter(t, model))
  const journalChapters = includeJournals
    ? model.journals.map((p) => renderPageChapter(p, model))
    : []

  const chapters: Chapter[] = [home, ...pageChapters, ...tagChapters, ...journalChapters]

  const toNav = (cs: Chapter[]) => cs.map((c) => ({ label: c.title, href: `${c.slug}.xhtml` }))
  const nav: NavGroup[] = [
    { label: 'Home', items: [{ label: 'Home', href: `${HOME_SLUG}.xhtml` }] },
    { label: 'Pages', items: toNav(pageChapters) },
    { label: 'Tags', items: toNav(tagChapters) },
    { label: 'Journals', items: toNav(journalChapters) },
  ]

  onProgress?.('Packaging EPUB…')
  const bytes = await buildEpub({ title: model.graphName, chapters, nav })

  return {
    graphName: model.graphName,
    bytes,
    stats: {
      pages: pageChapters.length,
      tags: tagChapters.length,
      journals: journalChapters.length,
    },
  }
}
