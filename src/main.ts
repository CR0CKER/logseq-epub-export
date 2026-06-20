import '@logseq/libs'
import { SettingSchemaDesc } from '@logseq/libs/dist/LSPlugin'
import { del as idbDel, get as idbGet, set as idbSet } from 'idb-keyval'
import { exportGraphToEpub } from './export'
import { openPanel, Panel } from './panel'
import { watchTheme } from './theme'
import pkg from '../package.json'

const SETTINGS: SettingSchemaDesc[] = [
  {
    key: 'destinationMode',
    title: 'Save destination',
    description:
      'Where the EPUB is written. "Graph assets" writes into this graph\'s ' +
      'assets/storages folder (no prompt; if the graph syncs via Syncthing it ' +
      'reaches your e-reader automatically). "Custom folder" writes to a folder ' +
      'you pick once per graph (requires the dev/unpacked install).',
    type: 'enum',
    enumChoices: ['graph-assets', 'custom-folder'],
    enumPicker: 'radio',
    default: 'graph-assets',
  },
  {
    key: 'outputMode',
    title: 'On re-export',
    description:
      'Overwrite the existing EPUB in place, or keep versions by writing a new ' +
      'timestamped file each time.',
    type: 'enum',
    enumChoices: ['overwrite', 'versioned'],
    enumPicker: 'radio',
    default: 'overwrite',
  },
  {
    key: 'includeJournals',
    title: 'Include journal pages',
    description: 'Add daily journal pages as their own TOC section.',
    type: 'boolean',
    default: true,
  },
  {
    key: 'filenameBase',
    title: 'Output filename (optional)',
    description: 'Base name without extension. Leave blank to use the graph name.',
    type: 'string',
    default: '',
  },
]

let panel: Panel | null = null
let busy = false

const dirKey = (graphUrl: string) => `logseq-epub-export:dir:${graphUrl}`

async function currentGraph(): Promise<{ name: string; url: string } | null> {
  try {
    const g = await logseq.App.getCurrentGraph()
    if (!g?.url) return null
    return { name: g.name ?? g.url, url: g.url }
  } catch (e) {
    console.warn('logseq-epub-export: getCurrentGraph failed', e)
    return null
  }
}

function timestamp(): string {
  const d = new Date()
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}`
}

function fileName(graphName: string): string {
  const base = ((logseq.settings?.filenameBase as string) || '').trim() || graphName
  const safe = base.replace(/[\\/:*?"<>|]/g, '_').trim() || 'graph'
  const mode = (logseq.settings?.outputMode as string) || 'overwrite'
  return mode === 'versioned' ? `${safe} ${timestamp()}.epub` : `${safe}.epub`
}

function log(msg: string) {
  panel?.log(msg)
  console.log('logseq-epub-export:', msg)
}

/** Ensure read+write permission on a File System Access directory handle. */
async function ensureRW(handle: any): Promise<boolean> {
  try {
    const opts = { mode: 'readwrite' as const }
    if ((await handle.queryPermission?.(opts)) === 'granted') return true
    return (await handle.requestPermission?.(opts)) === 'granted'
  } catch (e) {
    console.warn('logseq-epub-export: permission check failed', e)
    return false
  }
}

async function writeToGraphAssets(name: string, bytes: ArrayBuffer): Promise<string> {
  const storage = logseq.Assets.makeSandboxStorage()
  // Pass the raw ArrayBuffer; stringifying corrupts the zip.
  await storage.setItem(name, bytes as any)
  return `assets/storages/${logseq.baseInfo.id}/${name}`
}

async function writeToCustomFolder(graphUrl: string, name: string, bytes: ArrayBuffer): Promise<string> {
  const handle = await idbGet(dirKey(graphUrl))
  if (!handle) throw new Error('No export folder set. Open the panel and choose a folder.')
  if (!(await ensureRW(handle))) throw new Error('Write permission to the export folder was denied.')
  const fh = await handle.getFileHandle(name, { create: true })
  const writable = await fh.createWritable()
  await writable.write(bytes)
  await writable.close()
  return `${handle.name}/${name}`
}

async function runExport(): Promise<void> {
  if (busy) { log('An export is already running.'); return }
  const graph = await currentGraph()
  if (!graph) { await logseq.UI.showMsg('Could not read the current graph.', 'error'); return }

  const destinationMode = (logseq.settings?.destinationMode as string) || 'graph-assets'

  // Custom folder with nothing set yet → guide the user to the panel.
  if (destinationMode === 'custom-folder' && !(await idbGet(dirKey(graph.url)))) {
    await openPanelFor(graph)
    panel?.log('Choose an export folder first, then click “Export now”.')
    return
  }

  busy = true
  panel?.setBusy(true)
  const name = fileName(graph.name)
  log(`Exporting “${graph.name}” → ${name}`)
  try {
    const result = await exportGraphToEpub((m) => log(m), {
      includeJournals: logseq.settings?.includeJournals !== false,
    })
    log(`Built ${result.stats.pages} pages, ${result.stats.tags} tags, ${result.stats.journals} journals.`)
    const where = destinationMode === 'custom-folder'
      ? await writeToCustomFolder(graph.url, name, result.bytes)
      : await writeToGraphAssets(name, result.bytes)
    log(`Saved: ${where}`)
    await logseq.UI.showMsg(`EPUB exported: ${name}`, 'success')
  } catch (e: any) {
    console.error('logseq-epub-export: export failed', e)
    log(`Export failed: ${e?.message ?? e}`)
    await logseq.UI.showMsg(`EPUB export failed: ${e?.message ?? e}`, 'error')
  } finally {
    busy = false
    panel?.setBusy(false)
  }
}

/** Pick (and persist, per graph) a writable export folder. Must run in the
 *  plugin iframe from a real click — that's why it lives behind the panel. */
async function chooseFolder(graphUrl: string): Promise<void> {
  if (typeof (window as any).showDirectoryPicker !== 'function') {
    await logseq.UI.showMsg(
      'This Logseq build cannot pick a folder. Use the “Graph assets” destination instead.',
      'warning',
    )
    return
  }
  try {
    const handle = await (window as any).showDirectoryPicker({ mode: 'readwrite' })
    if (!handle) return
    await idbSet(dirKey(graphUrl), handle)
    panel?.setFolder(handle.name)
    log(`Export folder set: ${handle.name}`)
  } catch (e: any) {
    if (e?.name !== 'AbortError') {
      console.warn('logseq-epub-export: showDirectoryPicker failed', e)
      await logseq.UI.showMsg('Could not select a folder.', 'warning')
    }
  }
}

async function openPanelFor(graph: { name: string; url: string }): Promise<void> {
  const destinationMode = (logseq.settings?.destinationMode as string) || 'graph-assets'
  let folderName: string | null = null
  if (destinationMode === 'custom-folder') {
    const handle = await idbGet(dirKey(graph.url))
    folderName = handle?.name ?? null
  }
  panel = await openPanel({
    graphName: graph.name,
    version: pkg.version,
    destinationMode,
    folderName,
    onChooseFolder: () => chooseFolder(graph.url),
    onExport: () => runExport(),
  })
}

async function openPanel_(): Promise<void> {
  const graph = await currentGraph()
  if (!graph) { await logseq.UI.showMsg('Could not read the current graph.', 'error'); return }
  await openPanelFor(graph)
}

function bootstrap() {
  console.log('logseq-epub-export: loaded (v' + pkg.version + ')')
  logseq.useSettingsSchema(SETTINGS)
  watchTheme()

  logseq.provideModel({
    runExport() { void runExport() },
    openPanel() { void openPanel_() },
  })

  // One-click toolbar action: export the active graph with remembered settings.
  logseq.App.registerUIItem('toolbar', {
    key: 'logseq-epub-export',
    template: `
      <a data-on-click="runExport" class="button" title="Export graph to EPUB (right-click area: use command palette for options)">
        <i class="ti ti-book-download"></i>
      </a>
    `,
  })

  logseq.App.registerCommandPalette(
    { key: 'logseq-epub-export-run', label: 'EPUB Export: export current graph now' },
    () => { void runExport() },
  )
  logseq.App.registerCommandPalette(
    { key: 'logseq-epub-export-panel', label: 'EPUB Export: open panel / choose folder' },
    () => { void openPanel_() },
  )
  logseq.App.registerCommandPalette(
    { key: 'logseq-epub-export-forget-folder', label: 'EPUB Export: forget export folder (this graph)' },
    async () => {
      const g = await currentGraph()
      if (g) { await idbDel(dirKey(g.url)); panel?.setFolder(null) }
      await logseq.UI.showMsg('EPUB Export: export folder forgotten for this graph.', 'success')
    },
  )
}

logseq.ready(bootstrap).catch(console.error)
