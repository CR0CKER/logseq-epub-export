# Logseq EPUB Export

Export a whole Logseq graph to a single, navigable **EPUB** so you can read and
explore it like a wiki on an e-reader — built for **KOReader** on e-ink devices
(Boox, Kobo, Kindle, …) where Markdown files render as plain text and
`[[wikilinks]]` aren't tappable.

One click on the toolbar icon builds an EPUB of the **currently selected graph**
with:

- **Tap-to-navigate `[[wikilinks]]`** — resolved to internal EPUB links (and a
  muted style for links to pages that don't exist).
- **`#tags` as browsable index chapters** — each tag lists its member pages.
- **"Linked References"** on every page — the backlinks, as working links.
- **`{{query (property type "X")}}` expansion** — index/MoC pages like
  `[[People]]` become real lists instead of dead macros.
- **A Home/Contents chapter** plus a grouped TOC (Pages / Tags / Journals) that
  KOReader reads natively, along with full-text search, dictionary and a
  tap-history back button.
- **An auto-generated cover** — a clean, modern, Logseq-inspired graphic
  (connected-nodes graph motif + teal accent) titled with the graph name. The
  EPUB title (`dc:title`) is the graph name too, so it lists correctly on the
  device.

## How it works

A plugin reads Logseq's database (not the raw Markdown), so block trees,
properties, aliases and tags come pre-resolved. Each page becomes one XHTML
chapter; everything is packaged into a valid EPUB 3 (with an NCX fallback) using
[JSZip](https://stuk.github.io/jszip/).

## Install (dev / unpacked)

```sh
npm install
npm run build        # outputs ./dist
```

In Logseq: **Settings → Advanced → Developer mode**, then **Plugins → Load
unpacked plugin** → select this folder.

## Usage

- Click the **book-download icon** in the toolbar to export the active graph
  using your saved settings (genuinely one click).
- Or run **`EPUB Export: export current graph now`** from the command palette.
- **`EPUB Export: open panel / choose folder`** opens a small panel to pick a
  custom export folder and watch progress.

## Settings

| Setting | Options | Notes |
|---|---|---|
| **Save destination** | `graph-assets` (default) · `custom-folder` | Graph-assets writes into `assets/storages/<plugin-id>/`. If the graph syncs via **Syncthing**, the EPUB reaches your e-reader automatically. Custom-folder writes to a folder you pick once per graph (dev/unpacked install only). |
| **On re-export** | `overwrite` (default) · `versioned` | Overwrite the same file, or keep history with a timestamped filename (`<graph> YYYY-MM-DD-HHmm.epub`). |
| **Include journal pages** | on/off | Adds journals as their own TOC section. |
| **Output filename** | string | Blank = use the graph name. |

The custom export folder is remembered **per graph** (stored in IndexedDB, since
File System Access handles can't live in plugin settings).

## Delivering to the Boox / KOReader

Default flow: keep **Save destination = graph-assets**, let **Syncthing** carry
the graph folder to the device, and open the `.epub` from
`assets/storages/logseq-epub-export/` in KOReader.

## Cover

Each export auto-generates a clean, Logseq-inspired cover (a connected-nodes
graph glyph + teal accent) titled with the graph name. It's drawn on a `<canvas>`
in the plugin and embedded in the EPUB. A few things worth knowing:

- **Designed for e-ink.** Light background, near-black title and glyph, deep-teal
  accent that maps to a clean mid-gray on grayscale. Dark/flooded covers cause
  heavy ink, low contrast, and ghosting on reflective e-ink screens.
- **Written as an opaque JPEG.** This is the format crengine (KOReader's EPUB
  engine) renders most reliably — a structurally valid EPUB with an *RGBA PNG*
  cover may silently fail to display, while opaque JPEG works.
- **Maximum reader compatibility.** The cover is declared three ways so any
  reader finds it: EPUB3 `properties="cover-image"`, EPUB2
  `<meta name="cover">`, a full-page `cover.xhtml` as the first spine item, and
  an EPUB2 `<guide>` reference (used by Calibre/ADE; crengine ignores it). The
  EPUB title (`dc:title`) is the graph name, so it lists correctly on the device.

### Cover not updating in KOReader?

KOReader caches each book's cover **by file path** on the device. If you
re-export over the same filename, KOReader can keep showing the old (or missing)
thumbnail. To force a refresh: in the file browser **long-press the book →
Book information → refresh**, or **Settings → … → clear the cover/book-info
cache**. The cover *inside* the book always reflects the latest export (it's the
first page) — only the browser thumbnail is cached. Using **versioned** output (a
new filename each time) side-steps the cache entirely.

## Limitations (v1)

- **Read-only snapshot** — re-run to refresh after editing the graph.
- **Images are shown as labelled placeholders**, not embedded (graph asset files
  aren't readable from the plugin sandbox).
- Block references / embeds (`((…))`, `{{embed …}}`) are not resolved.
- Only `(property <key> "<value>")` queries are expanded; other `{{query}}`
  forms render as a muted note.

## Development

```sh
npm run typecheck      # tsc --noEmit
npm run test           # bundles + runs the render/EPUB smoke test
npm run build          # production build to ./dist
npm run preview:cover  # build docs/cover-preview.js, then open docs/cover-preview.html
```

`docs/cover-preview.html` renders the generated cover in a plain browser so you
can iterate on the artwork without loading the plugin into Logseq. (`cover.ts`
uses the browser `<canvas>`/`toBlob` API, so the cover can't be rendered under
plain Node — preview it in a real browser, or screenshot `tests/cover-shot.ts`
headlessly.)

## License

MIT © CR0CKER
