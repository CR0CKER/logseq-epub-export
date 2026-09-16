import '@logseq/libs'
import { applyTheme } from './theme'

export interface Panel {
  log: (msg: string) => void
  setBusy: (busy: boolean) => void
  setFolder: (name: string | null) => void
}

export interface PanelHandlers {
  graphName: string
  /**
   * 'export': the usual panel. 'pick': an export needs a folder but could not
   * open the picker itself, so the main button chooses one and exports.
   */
  mode: 'export' | 'pick'
  /** The custom export folder, or null when saving to graph assets. */
  folder: { name: string | null; askEachTime?: boolean } | null
  onPickAndExport: () => void | Promise<void>
  onChangeFolder: () => void | Promise<void>
  onExport: () => void | Promise<void>
}

const STYLE = `
#app { font-family: var(--ls-font-family, system-ui, sans-serif); }
/* Buttons don't inherit fonts by default: they rendered in Arial under a themed card. */
button { font: inherit; }
.ee-overlay { position: fixed; inset: 0; background: rgba(0,0,0,.35);
  display: flex; align-items: center; justify-content: center; }
.ee-card { position: relative; width: 440px; max-width: 92vw; background: var(--ls-primary-background-color, #fff);
  color: var(--ls-primary-text-color, #111); border-radius: 10px; padding: 20px;
  box-shadow: 0 10px 40px rgba(0,0,0,.35); }
.ee-card h1 { font-size: 16px; margin: 0 0 4px; padding-right: 28px; }
.ee-sub { color: var(--ls-secondary-text-color, #777); font-size: 12px; margin: 0 0 14px; }
.ee-row { display: flex; gap: 8px; margin: 8px 0; align-items: center; }
.ee-btn { cursor: pointer; border: 1px solid var(--ls-border-color, #ccc);
  background: var(--ls-tertiary-background-color, #f4f4f4); color: inherit;
  border-radius: 6px; padding: 7px 12px; font-size: 13px; }
.ee-btn.primary { background: var(--ls-active-primary-color, #2563eb); color: #fff; border-color: transparent; }
.ee-btn:disabled { opacity: .5; cursor: default; }
.ee-log { margin-top: 12px; font-family: monospace; font-size: 11px; white-space: pre-wrap;
  max-height: 160px; overflow: auto; background: var(--ls-secondary-background-color, #f0f0f0);
  border-radius: 6px; padding: 8px; min-height: 40px; }
/* The close button copies the close button of Logseq's own settings dialog on
   the running build (measured): 0.10.x/OG's ui__modal-close, 2.x's
   ui__dialog-close. Its colour is the panel's text colour, i.e. the theme's. */
.ee-close { position: absolute; display: flex; align-items: center; justify-content: center;
  padding: 0; border: none; background: none; color: inherit; cursor: pointer;
  transition: opacity .15s cubic-bezier(.4, 0, .2, 1); }
.ee-close svg { width: 100%; height: 100%; }
.ee-close:hover { opacity: 1; }
.ee-close:focus-visible { outline: 2px solid var(--ls-active-primary-color, #2563eb); outline-offset: 2px; }
.ee-close.as-modal { top: 15px; right: 9px; width: 24px; height: 24px; opacity: .6; }
.ee-close.as-dialog { top: 16px; right: 16px; width: 16px; height: 16px; opacity: .7; border-radius: 4px; }
`

let closeStyleCache: string | null = null

/** 'as-dialog' on Logseq 2.x (shadcn dialogs), 'as-modal' on 0.10.x and OG. */
async function closeButtonStyle(): Promise<string> {
  if (closeStyleCache) return closeStyleCache
  let major = 0
  try {
    major = parseInt(String((await logseq.App.getInfo())?.version ?? ''), 10) || 0
  } catch { /* older hosts: treat as 0.10.x */ }
  closeStyleCache = major >= 2 ? 'as-dialog' : 'as-modal'
  return closeStyleCache
}

/** Removes the Escape listeners of the panel currently shown, if any. */
let detachEscape = () => {}

export async function openPanel(h: PanelHandlers): Promise<Panel> {
  // Pull Logseq's live theme variables into this iframe before painting, so
  // the panel matches the user's graph (light/dark/themed) on first render.
  await applyTheme()

  const closeStyle = await closeButtonStyle()
  const app = document.getElementById('app')!
  const pick = h.mode === 'pick'
  const folderLine = (name: string | null) =>
    h.folder?.askEachTime ? 'Folder: asked on each export' : `Folder: ${name ? escape(name) : '— not set —'}`
  app.innerHTML = `
    <style>${STYLE}</style>
    <div class="ee-overlay" id="ee-overlay">
      <div class="ee-card">
        <button class="ee-close ${closeStyle}" id="ee-close" type="button" aria-label="Close" title="Close">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 18L18 6M6 6l12 12"/></svg>
        </button>
        <h1>Export “${escape(h.graphName)}” to EPUB</h1>
        ${h.folder && !pick ? `<p class="ee-sub" id="ee-folder">${folderLine(h.folder.name)}</p>` : ''}
        <div class="ee-row">
          ${pick
            ? `<button class="ee-btn primary" id="ee-pick-export">Choose folder and export…</button>`
            : `<button class="ee-btn primary" id="ee-export">Export now</button>`}
          ${!pick && h.folder && !h.folder.askEachTime ? `<button class="ee-btn" id="ee-folder-btn">Change folder…</button>` : ''}
        </div>
        <div class="ee-log" id="ee-log"></div>
      </div>
    </div>`

  const logEl = document.getElementById('ee-log')!
  const exportBtn = (document.getElementById('ee-export') ?? document.getElementById('ee-pick-export')) as HTMLButtonElement
  const folderBtn = document.getElementById('ee-folder-btn') as HTMLButtonElement | null
  const folderEl = document.getElementById('ee-folder')

  // Escape closes the panel. The panel takes keyboard focus when it opens (see
  // below), so listening in its own document is enough; nothing is added to
  // Logseq's window, where it would take Escape from Logseq's own dialogs
  // (a settings dialog opened over the panel must close first).
  const onKey = (e: KeyboardEvent) => {
    if (e.key !== 'Escape' || !logseq.isMainUIVisible) return
    e.preventDefault()
    close()
  }
  detachEscape()
  document.addEventListener('keydown', onKey)
  detachEscape = () => {
    document.removeEventListener('keydown', onKey)
    detachEscape = () => {}
  }
  const close = () => {
    detachEscape()
    logseq.hideMainUI()
  }
  document.getElementById('ee-close')!.addEventListener('click', close)
  document.getElementById('ee-overlay')!.addEventListener('click', (e) => {
    if ((e.target as HTMLElement).id === 'ee-overlay') close()
  })
  // The picker must be the first thing the click does, so these handlers
  // call straight through without awaiting anything first.
  exportBtn.addEventListener('click', () => void (pick ? h.onPickAndExport() : h.onExport()))
  folderBtn?.addEventListener('click', () => void h.onChangeFolder())

  logseq.showMainUI()
  // Keyboard focus to the panel, so Escape and Enter work without a click.
  window.focus()
  exportBtn.focus()

  return {
    log: (msg: string) => { logEl.textContent += (logEl.textContent ? '\n' : '') + msg; logEl.scrollTop = logEl.scrollHeight },
    setBusy: (busy: boolean) => { exportBtn.disabled = busy; if (folderBtn) folderBtn.disabled = busy },
    // textContent does its own escaping: pass the raw name.
    setFolder: (name: string | null) => { if (folderEl) folderEl.textContent = h.folder?.askEachTime ? 'Folder: asked on each export' : `Folder: ${name ?? '— not set —'}` },
  }
}

function escape(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}
