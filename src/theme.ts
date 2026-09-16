import '@logseq/libs'

/**
 * The panel renders inside the plugin's own iframe, which does NOT inherit
 * Logseq's `--ls-*` theme variables — so without help it looks nothing like
 * the user's graph.
 *
 * Strategy (mirrors logseq-reading-list and sync-koreader-highlights): read
 * the real Logseq theme variables from the parent/top document (accessible on
 * Logseq Desktop, where the plugin iframe is same-origin to the host). If that's
 * blocked, fall back to a polished light/dark palette chosen from the user's
 * preferred theme mode. Either way the panel matches the app, and `watchTheme`
 * restyles an open panel live when the theme changes.
 *
 * Read from the theme wrapper (`.dark-theme` / `.light-theme`), not <html>:
 * Logseq's accent picker and themes such as Adwaita redefine the accent there,
 * and it is what the visible UI inherits. Measured on 0.10.15 and 2.0.1 with
 * the Adwaita theme: <html> still said Logseq teal while the app showed GNOME
 * blue.
 */

const LS_VARS = [
  '--ls-primary-background-color',
  '--ls-secondary-background-color',
  '--ls-tertiary-background-color',
  '--ls-quaternary-background-color',
  '--ls-primary-text-color',
  '--ls-secondary-text-color',
  '--ls-border-color',
  '--ls-link-text-color',
  '--ls-active-primary-color',
  '--ls-selection-background-color',
] as const

type Palette = Record<string, string>

const LIGHT_FALLBACK: Palette = {
  '--ls-primary-background-color': '#ffffff',
  '--ls-secondary-background-color': '#f7f7f7',
  '--ls-tertiary-background-color': '#efefef',
  '--ls-quaternary-background-color': '#e4e4e4',
  '--ls-primary-text-color': '#1c1c1e',
  '--ls-secondary-text-color': '#6b6b6b',
  '--ls-border-color': '#d8d8d8',
  '--ls-link-text-color': '#2563eb',
  '--ls-active-primary-color': '#1f6feb',
  '--ls-selection-background-color': '#dbeafe',
}

const DARK_FALLBACK: Palette = {
  '--ls-primary-background-color': '#1e2022',
  '--ls-secondary-background-color': '#23272a',
  '--ls-tertiary-background-color': '#2b2f33',
  '--ls-quaternary-background-color': '#34393d',
  '--ls-primary-text-color': '#e6e6e6',
  '--ls-secondary-text-color': '#a0a0a0',
  '--ls-border-color': '#3a3f44',
  '--ls-link-text-color': '#6cb6ff',
  '--ls-active-primary-color': '#4493f8',
  '--ls-selection-background-color': '#2d4a73',
}

/** The element whose styles the host's visible UI inherits. */
function themeRoot(doc: Document): Element {
  return doc.querySelector('.dark-theme, .light-theme') ?? doc.body ?? doc.documentElement
}

function readFromRealm(realm: Window | null): { palette: Palette; hits: number } | null {
  if (!realm) return null
  try {
    const doc = realm.document
    if (!doc) return null
    const cs = realm.getComputedStyle(themeRoot(doc))
    const palette: Palette = {}
    let hits = 0
    for (const name of LS_VARS) {
      const v = cs.getPropertyValue(name).trim()
      if (v) { palette[name] = v; hits++ }
    }
    return { palette, hits }
  } catch {
    return null
  }
}

/**
 * Read the palette from the parent realm, then the top realm. Some Logseq
 * builds wrap plugin iframes one level deeper, so `.parent` may be an
 * intermediate container without theme vars while `.top` is the real host.
 * Prefer whichever realm yields more hits (themers like Awesome Styler inject
 * `--ls-*` overrides on the host's <html>).
 */
function readFromParent(): Palette | null {
  const fromParent = readFromRealm(window.parent ?? null)
  let fromTop: { palette: Palette; hits: number } | null = null
  try {
    if (window.top && window.top !== window.parent) fromTop = readFromRealm(window.top)
  } catch { /* cross-origin */ }
  const best = !fromParent ? fromTop
    : !fromTop ? fromParent
    : fromTop.hits > fromParent.hits ? fromTop : fromParent
  if (!best || best.hits === 0) return null
  return best.palette
}

function readFontFromRealm(realm: Window | null): string | null {
  if (!realm) return null
  try {
    const doc = realm.document
    if (!doc) return null
    // The font the app's UI actually inherits: a theme can set it on an
    // element (2.x puts var(--ls-font-family) on <html> with !important), so
    // the computed family beats the bare variable.
    const inherited = realm.getComputedStyle(themeRoot(doc)).fontFamily?.trim()
    if (inherited) return inherited
    const rootVar = realm.getComputedStyle(doc.documentElement)
      .getPropertyValue('--ls-font-family').trim()
    return rootVar || null
  } catch {
    return null
  }
}

function readFontFromParent(): string | null {
  return readFontFromRealm(window.parent ?? null) ?? readFontFromRealm(window.top ?? null)
}

async function resolvePalette(): Promise<Palette> {
  const fromParent = readFromParent()
  if (fromParent) return { ...DARK_FALLBACK, ...fromParent }
  let mode: string | undefined
  try {
    const cfg = (await logseq.App.getUserConfigs()) as { preferredThemeMode?: string }
    mode = cfg?.preferredThemeMode
  } catch { /* ignore */ }
  const dark = mode
    ? mode === 'dark'
    : window.matchMedia?.('(prefers-color-scheme: dark)').matches
  return dark ? DARK_FALLBACK : LIGHT_FALLBACK
}

export async function applyTheme(): Promise<void> {
  const palette = await resolvePalette()
  const font = readFontFromParent()
  if (font) palette['--ls-font-family'] = font
  const css = ':root{' + Object.entries(palette).map(([k, v]) => `${k}:${v};`).join('') + '}'
  let style = document.getElementById('ee-theme-vars') as HTMLStyleElement | null
  if (!style) {
    style = document.createElement('style')
    style.id = 'ee-theme-vars'
    document.head.appendChild(style)
  }
  style.textContent = css
}

/**
 * Re-apply whenever the host's look can have changed, so an open panel
 * restyles live: light/dark mode and theme switches (plugin events), and the
 * accent picker or a theme stylesheet arriving, which fire no event — watched
 * directly on the host document, which is same-origin on desktop.
 */
export function watchTheme(): void {
  let pending = 0
  const reapply = () => {
    cancelAnimationFrame(pending)
    pending = requestAnimationFrame(() => { void applyTheme() })
  }
  try {
    ;(logseq.App as any).onThemeModeChanged?.(reapply)
    ;(logseq.App as any).onThemeChanged?.(reapply)
  } catch (e) {
    console.warn('logseq-epub-export: theme event subscription failed', e)
  }
  try {
    const doc = window.parent?.document
    if (!doc || doc === document) return
    const observer = new MutationObserver(reapply)
    observer.observe(doc.documentElement, { attributes: true, attributeFilter: ['class', 'style', 'data-theme', 'data-color'] })
    observer.observe(doc.head, { childList: true, subtree: true, characterData: true })
    const wrapper = doc.querySelector('.dark-theme, .light-theme')
    if (wrapper) observer.observe(wrapper, { attributes: true, attributeFilter: ['class', 'style'] })
  } catch { /* cross-origin host: the plugin events above still apply */ }
}
