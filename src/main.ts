import '@logseq/libs'
import { SettingSchemaDesc } from '@logseq/libs/dist/LSPlugin'
import { del as idbDel, delMany as idbDelMany, get as idbGet, keys as idbKeys, set as idbSet } from 'idb-keyval'
import { exportGraphToEpub } from './export'
import { openPanel, Panel } from './panel'
import { watchTheme } from './theme'
import { graphDisplayName } from './entities'
import { epubFileName } from './filename'
import pkg from '../package.json'

/**
 * The settings schema. Rebuilt when the export folder changes, so the
 * "Remember export folder" description can name the folder in use.
 */
const settingsSchema = (folderName: string | null): SettingSchemaDesc[] => [
  {
    key: 'destinationMode',
    title: 'Save destination',
    description:
      'Where the EPUB is written. "graph-assets" writes into this graph\'s ' +
      'assets/storages folder (no prompt; if the graph syncs via Syncthing it ' +
      'reaches your e-reader automatically). "custom-folder" writes to a folder ' +
      'you choose: the first export asks for it.',
    type: 'enum',
    enumChoices: ['graph-assets', 'custom-folder'],
    enumPicker: 'radio',
    default: 'graph-assets',
  },
  {
    key: 'rememberFolder',
    title: 'Remember export folder',
    description:
      'For "custom-folder": keep the folder you choose for each graph, so later ' +
      'exports go straight there. Untick to forget the stored folders; every ' +
      'export then asks for a folder, until you tick this again. ' +
      `Current folder for this graph: ${folderName ?? 'not set'}.`,
    type: 'boolean',
    default: true,
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
    description:
      'Base name without extension. Leave blank for Calibre\'s naming, ' +
      '"<graph name> - Logseq EPUB Export", which matches a copy imported into Calibre.',
    type: 'string',
    default: '',
  },
]

let panel: Panel | null = null
let busy = false

const DIR_KEY_PREFIX = 'logseq-epub-export:dir:'
const dirKey = (graphUrl: string) => `${DIR_KEY_PREFIX}${graphUrl}`
const rememberFolder = () => logseq.settings?.rememberFolder !== false

async function currentGraph(): Promise<{ name: string; url: string } | null> {
  try {
    const g = await logseq.App.getCurrentGraph()
    if (!g?.url) return null
    return { name: graphDisplayName(g) || 'graph', url: g.url }
  } catch (e) {
    console.warn('logseq-epub-export: getCurrentGraph failed', e)
    return null
  }
}

function log(msg: string) {
  panel?.log(msg)
  console.log('logseq-epub-export:', msg)
}

/**
 * Tell the user something: in the panel's log while the panel is open, as a
 * Logseq notification otherwise. Notifications appear top-right, right over
 * the panel's close button, so they must not pile up on an open panel.
 * Returns the notification key, or null when it went to the panel.
 */
async function notify(msg: string, status: 'info' | 'success' | 'warning' | 'error', timeout?: number): Promise<string | null> {
  if (panel && logseq.isMainUIVisible) {
    panel.log(msg)
    return null
  }
  try {
    return await logseq.UI.showMsg(msg, status, timeout ? { timeout } : undefined)
  } catch {
    return null
  }
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

async function writeToFolder(handle: any, name: string, bytes: ArrayBuffer): Promise<string> {
  if (!(await ensureRW(handle))) throw new Error('Write permission to the export folder was denied.')
  const fh = await handle.getFileHandle(name, { create: true })
  const writable = await fh.createWritable()
  await writable.write(bytes)
  await writable.close()
  return `${handle.name}/${name}`
}

/** Thrown when the folder picker needs a click this call did not come from. */
class NeedsClick extends Error {}

/**
 * Why a picker can hang: after a folder is chosen, Electron checks it against
 * Chromium's blocklist of sensitive folders (the home folder, and the root of
 * Downloads, Desktop, Documents, …). For a blocked folder it does not reject;
 * it emits the session event `file-system-access-restricted` and waits for the
 * app's answer (Electron 43.4.1, file_system_access_permission_context.cc).
 * Logseq registers no listener (checked: the OG build and 0.10.15), so the
 * request never settles and the next one fails "File picker already active".
 * A plugin cannot answer that main-process event, so explain it instead.
 */
const STUCK_PICKER_MESSAGE =
  'The folder picker is stuck: Logseq cannot open the folder chosen last time ' +
  '(folders such as Downloads, Documents, Desktop or your home folder are ' +
  'protected). Restart Logseq, then choose a folder inside one of them, e.g. ' +
  'Downloads/EPUB.'
let pickerPending = false

/**
 * Show the folder picker. Null if the user cancels.
 *
 * Chromium opens it only with user activation in this frame. A click on the
 * panel's "Export now" provides that, and so does a command-palette pick, via
 * the host (same-origin frames share the activation; measured on 0.10.15,
 * 2.0.1 and the OG build, with both unpacked and installed plugins), so an
 * export can ask directly. Anything else throws NeedsClick, and the caller
 * falls back to the panel's "Choose folder and export…".
 */
async function pickFolder(): Promise<any | null> {
  const picker = (window as any).showDirectoryPicker
  if (typeof picker !== 'function') throw new Error('This Logseq build cannot pick a folder. Use the "graph-assets" destination instead.')
  if (pickerPending) throw new Error(STUCK_PICKER_MESSAGE)
  let request: Promise<any>
  try {
    // Called before anything is awaited: the click's activation is still live.
    request = picker({ id: 'logseq-epub-export', mode: 'readwrite' })
  } catch (e: any) {
    request = Promise.reject(e)
  }
  pickerPending = true
  try {
    // Only when the dialog really opened: a picker refused for lack of a click
    // settles at once, and the panel takes over without this hint.
    const settledAtOnce = await Promise.race([
      request.then(() => true, () => true),
      new Promise<boolean>((r) => setTimeout(() => r(false), 150)),
    ])
    if (!settledAtOnce) {
      void notify(
        'Choose the folder for the EPUB. Pick a folder inside Downloads, Documents or ' +
          'Desktop rather than the folder itself: Logseq cannot open those.',
        'info',
        8000,
      )
    }
    return await request
  } catch (e: any) {
    if (/already active/i.test(String(e?.message))) throw new Error(STUCK_PICKER_MESSAGE)
    if (e?.name === 'AbortError') {
      // Also what Chromium reports when it refuses the chosen folder (the home
      // folder itself, system folders), so say both, never just go quiet.
      console.warn('logseq-epub-export: folder picker returned no folder', e?.name, e?.message)
      await notify(
        'EPUB export stopped: no folder was chosen. If you did choose one, Logseq ' +
          'may not allow that folder (for example your home folder or a system ' +
          'folder); choose a folder inside it instead.',
        'warning',
        12000,
      )
      return null
    }
    if (e?.name === 'SecurityError') throw new NeedsClick(e.message)
    throw e
  } finally {
    pickerPending = false
  }
}

/** Keep a newly chosen folder for this graph, if the user wants it remembered. */
async function adoptFolder(graphUrl: string, handle: any): Promise<void> {
  panel?.setFolder(handle.name)
  if (!rememberFolder()) return
  await idbSet(dirKey(graphUrl), handle)
  log(`Export folder set: ${handle.name}`)
  await refreshSettingsSchema()
}

/**
 * The folder to export into: the stored one when it is remembered and still
 * writable, otherwise one the user picks now. Null when the user cancels or
 * has to click in the panel first (it is opened for them).
 */
async function exportFolder(graph: { name: string; url: string }): Promise<any | null> {
  const stored = rememberFolder() ? await idbGet(dirKey(graph.url)) : null
  try {
    // A stored folder whose permission lapsed (e.g. after a restart) only needs
    // the small permission prompt, which the same activation allows.
    if (stored && (await ensureRW(stored))) return stored
    const picked = await pickFolder()
    if (!picked) return null
    await adoptFolder(graph.url, picked)
    return picked
  } catch (e) {
    if (!(e instanceof NeedsClick)) throw e
    await openPanelFor(graph, { pick: true })
    return null
  }
}

async function runExport(chosen?: any): Promise<void> {
  if (busy) { log('An export is already running.'); return }
  const graph = await currentGraph()
  if (!graph) { await notify('Could not read the current graph.', 'error'); return }

  const destinationMode = (logseq.settings?.destinationMode as string) || 'graph-assets'
  let folder: any = null
  if (destinationMode === 'custom-folder') {
    try {
      // Ask before building the book: the click's activation does not last.
      folder = chosen ?? (await exportFolder(graph))
    } catch (e: any) {
      await notify(`EPUB export: ${e?.message ?? e}`, 'error')
      return
    }
    if (!folder) return
  }

  busy = true
  panel?.setBusy(true)
  const name = epubFileName({
    graphName: graph.name,
    filenameBase: logseq.settings?.filenameBase as string | undefined,
    versioned: logseq.settings?.outputMode === 'versioned',
  })
  log(`Exporting “${graph.name}” → ${name}`)
  // Without the panel (a command-palette export) nothing else shows progress,
  // and a large graph looks like nothing is happening for a minute. With the
  // panel open, its log already does.
  const progress = panel && logseq.isMainUIVisible
    ? null
    : await notify(`Exporting “${graph.name}” to EPUB…`, 'info', 30 * 60 * 1000)
  try {
    const result = await exportGraphToEpub((m) => log(m), {
      includeJournals: logseq.settings?.includeJournals !== false,
    })
    const { stats } = result
    log(`Built ${stats.pages} pages, ${stats.tags} tags, ${stats.journals} journals, ${stats.images} images.`)
    if (stats.imagesFailed) log(`${stats.imagesFailed} image(s) could not be read and are shown as placeholders.`)
    if (result.imageFailure) log(`First failure: ${result.imageFailure}`)
    const where = folder
      ? await writeToFolder(folder, name, result.bytes)
      : await writeToGraphAssets(name, result.bytes)
    log(`Saved: ${where}`)
    await notify(`EPUB exported: ${name}`, 'success')
  } catch (e: any) {
    console.error('logseq-epub-export: export failed', e)
    if (panel && logseq.isMainUIVisible) log(`Export failed: ${e?.message ?? e}`)
    else await notify(`EPUB export failed: ${e?.message ?? e}`, 'error')
  } finally {
    busy = false
    panel?.setBusy(false)
    if (progress) logseq.UI.closeMsg(progress)
  }
}

/** Re-register the settings schema so its description names the current folder. */
async function refreshSettingsSchema(): Promise<void> {
  let folderName: string | null = null
  try {
    const graph = await currentGraph()
    if (graph && rememberFolder()) folderName = (await idbGet(dirKey(graph.url)))?.name ?? null
  } catch { /* no stored folder */ }
  logseq.useSettingsSchema(settingsSchema(folderName))
}

/** Forget every graph's stored folder. */
async function forgetAllFolders(): Promise<void> {
  const keys = (await idbKeys()).filter((k) => String(k).startsWith(DIR_KEY_PREFIX))
  await idbDelMany(keys)
  panel?.setFolder(null)
  await refreshSettingsSchema()
}

async function openPanelFor(graph: { name: string; url: string }, { pick = false } = {}): Promise<void> {
  const destinationMode = (logseq.settings?.destinationMode as string) || 'graph-assets'
  const custom = destinationMode === 'custom-folder'
  const stored = custom && rememberFolder() ? await idbGet(dirKey(graph.url)) : null
  panel = await openPanel({
    graphName: graph.name,
    mode: pick ? 'pick' : 'export',
    folder: !custom ? null : rememberFolder() ? { name: stored?.name ?? null } : { name: null, askEachTime: true },
    onPickAndExport: async () => {
      try {
        const picked = await pickFolder()
        if (!picked) return
        await adoptFolder(graph.url, picked)
        await runExport(picked)
      } catch (e: any) {
        log(`Could not choose a folder: ${e?.message ?? e}`)
      }
    },
    onChangeFolder: async () => {
      try {
        const picked = await pickFolder()
        if (picked) await adoptFolder(graph.url, picked)
      } catch (e: any) {
        log(`Could not choose a folder: ${e?.message ?? e}`)
      }
    },
    onExport: () => runExport(),
  })
  if (pick) log('Choose the folder to save the EPUB in.')
}

async function openPanel_(): Promise<void> {
  const graph = await currentGraph()
  if (!graph) { await logseq.UI.showMsg('Could not read the current graph.', 'error'); return }
  await openPanelFor(graph)
}

function bootstrap() {
  console.log('logseq-epub-export: loaded (v' + pkg.version + ')')
  logseq.useSettingsSchema(settingsSchema(null))
  void refreshSettingsSchema()
  logseq.onSettingsChanged((next: any, prev: any) => {
    if (prev?.rememberFolder !== false && next?.rememberFolder === false) void forgetAllFolders()
    else if (next?.rememberFolder !== prev?.rememberFolder) void refreshSettingsSchema()
  })
  logseq.App.onCurrentGraphChanged(() => { void refreshSettingsSchema() })
  watchTheme()

  logseq.provideModel({
    runExport() { void runExport() },
    openPanel() { void openPanel_() },
  })

  // The toolbar icon opens the panel; its "Export now" runs the export. The
  // command palette keeps a direct export ("export current graph now").
  logseq.App.registerUIItem('toolbar', {
    key: 'logseq-epub-export',
    template: `
      <a data-on-click="openPanel" class="button" title="Export to epub">
        <i class="ti ti-book-download"></i>
      </a>
    `,
  })

  logseq.App.registerCommandPalette(
    { key: 'logseq-epub-export-run', label: 'EPUB Export: export current graph now' },
    () => { void runExport() },
  )
  logseq.App.registerCommandPalette(
    { key: 'logseq-epub-export-panel', label: 'EPUB Export: open panel' },
    () => { void openPanel_() },
  )
  logseq.App.registerCommandPalette(
    { key: 'logseq-epub-export-forget-folder', label: 'EPUB Export: forget export folder (this graph)' },
    async () => {
      const g = await currentGraph()
      if (g) { await idbDel(dirKey(g.url)); panel?.setFolder(null); await refreshSettingsSchema() }
      await logseq.UI.showMsg('EPUB Export: export folder forgotten for this graph.', 'success')
    },
  )
}

logseq.ready(bootstrap).catch(console.error)
