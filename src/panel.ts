import '@logseq/libs'
import { applyTheme } from './theme'

export interface Panel {
  log: (msg: string) => void
  setBusy: (busy: boolean) => void
  setFolder: (name: string | null) => void
}

export interface PanelHandlers {
  graphName: string
  version: string
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
.ee-overlay { position: fixed; inset: 0; background: rgba(0,0,0,.35);
  display: flex; align-items: center; justify-content: center; }
.ee-card { width: 440px; max-width: 92vw; background: var(--ls-primary-background-color, #fff);
  color: var(--ls-primary-text-color, #111); border-radius: 10px; padding: 20px;
  box-shadow: 0 10px 40px rgba(0,0,0,.35); }
.ee-card h1 { font-size: 16px; margin: 0 0 4px; }
.ee-sub { color: var(--ls-secondary-text-color, #777); font-size: 12px; margin: 0 0 14px; }
.ee-row { display: flex; gap: 8px; margin: 8px 0; align-items: center; }
.ee-btn { cursor: pointer; border: 1px solid var(--ls-border-color, #ccc);
  background: var(--ls-tertiary-background-color, #f4f4f4); color: inherit;
  border-radius: 6px; padding: 7px 12px; font-size: 13px; }
.ee-btn.primary { background: var(--ls-active-primary-color, #2563eb); color: #fff; border-color: transparent; }
.ee-btn:disabled { opacity: .5; cursor: default; }
.ee-folder { font-size: 12px; color: var(--ls-secondary-text-color, #777); }
.ee-log { margin-top: 12px; font-family: monospace; font-size: 11px; white-space: pre-wrap;
  max-height: 160px; overflow: auto; background: var(--ls-secondary-background-color, #f0f0f0);
  border-radius: 6px; padding: 8px; min-height: 40px; }
.ee-foot { display: flex; justify-content: space-between; align-items: center; margin-top: 12px;
  font-size: 11px; color: var(--ls-secondary-text-color, #777); }
.ee-x { cursor: pointer; background: none; border: none; color: inherit; font-size: 13px; }
`

export async function openPanel(h: PanelHandlers): Promise<Panel> {
  // Pull Logseq's live theme variables into this iframe before painting, so
  // the panel matches the user's graph (light/dark/themed) on first render.
  await applyTheme()

  const app = document.getElementById('app')!
  const pick = h.mode === 'pick'
  const folderLine = (name: string | null) =>
    h.folder?.askEachTime ? 'Folder: asked on each export' : `Folder: ${name ? escape(name) : '— not set —'}`
  app.innerHTML = `
    <style>${STYLE}</style>
    <div class="ee-overlay" id="ee-overlay">
      <div class="ee-card">
        <h1>Export “${escape(h.graphName)}” to EPUB</h1>
        <p class="ee-sub">Builds a navigable EPUB of the current graph for e-readers.</p>
        <div class="ee-row">
          ${pick
            ? `<button class="ee-btn primary" id="ee-pick-export">Choose folder and export…</button>`
            : `<button class="ee-btn primary" id="ee-export">Export now</button>`}
          ${!pick && h.folder && !h.folder.askEachTime ? `<button class="ee-btn" id="ee-folder-btn">Change folder…</button>` : ''}
        </div>
        ${h.folder && !pick ? `<div class="ee-folder" id="ee-folder">${folderLine(h.folder.name)}</div>` : ''}
        <div class="ee-log" id="ee-log"></div>
        <div class="ee-foot">
          <span>v${escape(h.version)}</span>
          <button class="ee-x" id="ee-close">Close</button>
        </div>
      </div>
    </div>`

  const logEl = document.getElementById('ee-log')!
  const exportBtn = (document.getElementById('ee-export') ?? document.getElementById('ee-pick-export')) as HTMLButtonElement
  const folderBtn = document.getElementById('ee-folder-btn') as HTMLButtonElement | null
  const folderEl = document.getElementById('ee-folder')

  const close = () => logseq.hideMainUI()
  document.getElementById('ee-close')!.addEventListener('click', close)
  document.getElementById('ee-overlay')!.addEventListener('click', (e) => {
    if ((e.target as HTMLElement).id === 'ee-overlay') close()
  })
  // The picker must be the first thing the click does, so these handlers
  // call straight through without awaiting anything first.
  exportBtn.addEventListener('click', () => void (pick ? h.onPickAndExport() : h.onExport()))
  folderBtn?.addEventListener('click', () => void h.onChangeFolder())

  logseq.showMainUI()

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
