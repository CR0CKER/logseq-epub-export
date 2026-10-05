import { collectGraph } from './graph'
import { collectImageKeys } from './assets'
import { loadImages } from './image-loader'
import { buildCover } from './cover'
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
  stats: { pages: number; tags: number; journals: number; images: number; imagesFailed: number }
  /** Why the first image failed to load, for the status log. */
  imageFailure?: string
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

  // Images before rendering: a chapter links an image only if it made it in.
  const exported = includeJournals ? [...model.pages, ...model.journals] : model.pages
  const images = await loadImages(collectImageKeys(exported), onProgress)
  model.images = images.hrefs

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

  onProgress?.('Generating cover…')
  let cover = null
  try {
    cover = await buildCover(model.graphName)
  } catch (e) {
    console.warn('logseq-epub-export: cover generation failed; shipping without one', e)
  }

  onProgress?.('Packaging EPUB…')
  const bytes = await buildEpub({ title: model.graphName, chapters, nav, cover, images: images.files })

  return {
    graphName: model.graphName,
    bytes,
    stats: {
      pages: pageChapters.length,
      tags: tagChapters.length,
      journals: journalChapters.length,
      images: images.files.length,
      imagesFailed: images.failed.length,
    },
    imageFailure: images.firstFailure,
  }
}
