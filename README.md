# Logseq EPUB Export

Export a whole Logseq graph to a single, navigable **EPUB** so you can read and
explore it like a wiki on an e-reader — built for **KOReader** on e-ink devices
(Boox, Kobo, Kindle, …) where Markdown files render as plain text and
`[[wikilinks]]` aren't tappable.

One click on the toolbar icon builds an EPUB of the **currently selected graph**
with:

- **Tap-to-navigate `[[wikilinks]]`** — resolved to internal EPUB links, aliases
  included (and a muted style for links to pages that don't exist).
- **`#tags` as browsable index chapters** — each tag lists its member pages.
- **"Linked References"** on every page — the backlinks, as working links.
- **Your images, embedded** — pictures from the graph's `assets` folder are
  packed into the book, downscaled for e-ink (see [Images](#images)).
- **`{{query (property type "X")}}` expansion** — index/MoC pages like
  `[[People]]` become real lists instead of dead macros.
- **A Home/Contents chapter** plus a grouped TOC (Pages / Tags / Journals) that
  KOReader reads natively, along with full-text search, dictionary and a
  tap-history back button.
- **An auto-generated cover** — a clean, modern, Logseq-inspired graphic
  (connected-nodes graph motif + teal accent) titled with the graph name. The
  EPUB title (`dc:title`) is the graph name too, so it lists correctly on the
  device.

## Contents

- [Compatibility](#compatibility)
- [How it works](#how-it-works)
- [Install](#install)
- [Usage](#usage)
- [Settings](#settings)
- [Delivering to the Boox / KOReader](#delivering-to-the-boox--koreader)
- [Images](#images)
- [Cover](#cover)
- [Limitations](#limitations)
- [Troubleshooting](#troubleshooting)
- [Development](#development)
- [Releasing](#releasing)
- [License](#license)

## Compatibility

Works on both lines of Logseq, file graphs and DB graphs. "Verified" means the
[live suite](#tests) exported a seeded graph on that build and every check on
the book passed:

| Logseq | Graph type | Status |
|---|---|---|
| **Logseq 0.10.15** (last official file-graph release) | file (Markdown) | verified: every live case passes; one reports itself skipped, because 0.10.x flags no page as built-in |
| **Logseq 2.0.1** (DB version) | DB | verified: every live case passes |
| Earlier 0.10.x releases | file | expected to work: same plugin API and data shape as 0.10.15; not in the live suite |

The suite also runs a local, unreleased build of [`logseq/og`](https://github.com/logseq/og)
(the community continuation of the file-graph line, on Electron 43) when one is
present; it passes the same cases as 0.10.15.

The two lines answer the same plugin API calls with differently shaped data —
a DB graph stores links as `[[uuid]]`, keeps headings in a property and page
properties under namespaced keys — so the plugin normalizes both before
rendering (`src/entities.ts` has the full table).

<sub>[↑ Back to contents](#contents)</sub>

## How it works

A plugin reads Logseq's database (not the raw Markdown), so block trees,
properties, aliases and tags come pre-resolved. Each page becomes one XHTML
chapter; everything is packaged into a valid EPUB 3 (with an NCX fallback) using
[JSZip](https://stuk.github.io/jszip/).

<sub>[↑ Back to contents](#contents)</sub>

## Install

**From a release:** download `logseq-epub-export-<version>.zip` from the latest
GitHub release and unzip it. In Logseq, turn on **Settings → Advanced →
Developer mode**, then **Plugins → Load unpacked plugin** and pick the unzipped
folder.

**From source:**

```sh
npm install
npm run build        # outputs ./dist
```

then **Load unpacked plugin** on this folder.

<sub>[↑ Back to contents](#contents)</sub>

## Usage

- Click the **book-download icon** in the toolbar to export the active graph
  using your saved settings (genuinely one click).
- Or run **`EPUB Export: export current graph now`** from the command palette.
- **`EPUB Export: open panel / choose folder`** opens a small panel to pick a
  custom export folder and watch progress.
- **`EPUB Export: forget export folder (this graph)`** clears a remembered
  custom folder.

<sub>[↑ Back to contents](#contents)</sub>

## Settings

| Setting | Options | Notes |
|---|---|---|
| **Save destination** | `graph-assets` (default) · `custom-folder` | Graph-assets writes into the graph's `assets/storages/logseq-epub-export/` (see below for where that is). Custom-folder writes to a folder you pick once per graph, through the File System Access API. |
| **On re-export** | `overwrite` (default) · `versioned` | Overwrite the same file, or keep history with a timestamped filename (`<graph> YYYY-MM-DD-HHmm.epub`). |
| **Include journal pages** | on/off | Adds journals as their own TOC section. |
| **Output filename** | string | Blank = use the graph name. |

The custom export folder is remembered **per graph** (stored in IndexedDB, since
File System Access handles can't live in plugin settings).

Where **graph-assets** lands:

| Graph type | Folder |
|---|---|
| File graph (0.10.x) | `<your graph folder>/assets/storages/logseq-epub-export/` |
| DB graph (2.x) | `~/logseq/graphs/<graph name>/assets/storages/logseq-epub-export/` |

<sub>[↑ Back to contents](#contents)</sub>

## Delivering to the Boox / KOReader

Default flow for a **file graph**: keep **Save destination = graph-assets**, let
**Syncthing** carry the graph folder to the device, and open the `.epub` from
`assets/storages/logseq-epub-export/` or another selected destination in KOReader.

A **DB graph** lives in Logseq's own data folder rather than a folder you chose,
so either sync `~/logseq/graphs/<graph name>/assets/storages/logseq-epub-export/`
on its own, or switch **Save destination** to **custom-folder** and pick a folder
you already sync.

<sub>[↑ Back to contents](#contents)</sub>

## Images

Images stored in the graph are embedded in the EPUB: `![alt](../assets/…)` in a
file graph, and pasted or dropped images (image blocks) in a DB graph.

- **Sized for e-ink.** Anything larger than **1264 px** on its long edge is
  downscaled — about the size of a 6–7″ e-reader screen, so a phone photo doesn't
  add megabytes the device can't show.
- **In formats KOReader renders reliably.** JPEG and PNG that already fit are
  copied unchanged. Larger photos are re-encoded as JPEG, images with
  transparency stay PNG, and other formats (WebP, GIF, SVG, …) are converted.
- **Web images stay links.** `![alt](https://…)` becomes a link labelled
  `[image: alt]`: the export makes no network requests.
- An image that can't be read or decoded (a missing file, a PDF, an unsupported
  format) keeps a labelled `[image: …]` placeholder, and the panel log says how
  many.

<sub>[↑ Back to contents](#contents)</sub>

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

<sub>[↑ Back to contents](#contents)</sub>

## Limitations

- **Read-only snapshot** — re-run to refresh after editing the graph.
- **Web images are not downloaded**, and other assets (PDFs, audio, video) are
  not embedded; see [Images](#images).
- Block references / embeds (`((…))`, `{{embed …}}`) are not resolved.
- Only `(property <key> "<value>")` queries are expanded; other `{{query}}`
  forms render as a muted note. On DB graphs the key is matched against the
  property's **title**.
- **DB graphs:** Logseq's own properties (icons, timestamps, …) and built-in
  classes (Page, Journal, Task, …) are left out of the properties table and the
  tag index; block-level properties are not shown.
- **Images are re-encoded in the app**, one at a time; a graph with many large
  photos makes the export noticeably slower.
- **Large graphs export page by page** through the plugin API (three calls per
  page on a DB graph), so a graph with thousands of pages takes a while.

<sub>[↑ Back to contents](#contents)</sub>

## Troubleshooting

**Cover not updating in KOReader?** KOReader caches each book's cover **by file
path** on the device. If you re-export over the same filename, KOReader can keep
showing the old (or missing) thumbnail. To force a refresh: in the file browser
**long-press the book → Book information → refresh**, or **Settings → … → clear
the cover/book-info cache**. The cover *inside* the book always reflects the
latest export (it's the first page) — only the browser thumbnail is cached.
Using **versioned** output (a new filename each time) side-steps the cache
entirely.

**"Could not read the current graph."** No graph is open — on a fresh Logseq 0.10.x
profile the demo graph is not a real graph. Open or create a graph first.

**Can't find the EPUB after exporting a DB graph.** It is not next to your notes:
DB graphs live under `~/logseq/graphs/<graph name>/`. See
[Settings](#settings) for the exact folder.

**An image shows as `[image: …]` instead of the picture.** The file could not be
read or decoded: it is missing from `assets/`, is not an image (e.g. a PDF), or
is in a format Logseq's Chromium can't decode (e.g. HEIC). The panel log counts
these. Images linked from the web are always links, by design.

**A link shows as grey text instead of a link.** The target page has no content,
so it has no chapter. Empty pages are skipped on purpose.

<sub>[↑ Back to contents](#contents)</sub>

## Development

```sh
npm run typecheck      # tsc --noEmit
npm test               # offline tests: entity normalization + render/EPUB smoke test
npm run build          # production build to ./dist
npm run test:live      # build, then drive real Logseq 0.10.15 and 2.x (local only)
npm run preview:cover  # build docs/cover-preview.js, then open docs/cover-preview.html
```

`docs/cover-preview.html` renders the generated cover in a plain browser so you
can iterate on the artwork without loading the plugin into Logseq. (`cover.ts`
uses the browser `<canvas>`/`toBlob` API, so the cover can't be rendered under
plain Node — preview it in a real browser, or screenshot `tests/cover-shot.ts`
headlessly.)

Contribution conventions are in [`CONTRIBUTING.md`](CONTRIBUTING.md).

### Tests

Two tiers, because a hand-built model cannot show what each Logseq build's API
really returns — and that difference is exactly what broke DB graphs.

**Offline (`npm test`, the CI gate).** `tests/entities.ts` checks the OG/2.x
normalization against entity shapes captured from both builds;
`tests/smoke.ts` renders a synthetic graph and packages an EPUB (mimetype first
and stored, cover declared, inline rules not re-processing each other, names with
`&`/`<`/`>` escaped but still linked); `tests/assets.ts` covers which image
paths count as graph assets (no path traversal), magic-byte type detection, the
downscale/re-encode decision and images in the EPUB manifest).

**Live (`npm run test:live`, local only).** Launches each Logseq build with an
isolated `HOME` and `--user-data-dir`, loads this repo's `dist/` as an unpacked
plugin, seeds the same small graph (Markdown files on OG, the plugin API on 2.x),
clicks the toolbar button with a real pointer event and takes the written EPUB
apart: container validity, well-formed XHTML (Chromium's own XML parser), book
title, page-name casing, links, aliases, `&` in names, multi-word tags, tag
indexes, backlinks, headings and nesting, properties and property queries,
journals, built-in pages left out, embedded images (a 2000 px photo arriving as
a 1264 px JPEG, a small transparent PNG kept byte-for-byte, a web image left a
link; on 2.x the images are pasted in, as a user would), the icon glyph, the File System Access API,
and the panel opening in the app's colours.

On 0.10.x a fresh profile has no graph, and it only opens a folder through the
native dialog. The harness starts the app with `--inspect` and answers
`dialog.showOpenDialog` in the main process with the seeded folder, then clicks
"Choose a folder" — so the export runs against a real file graph.

It runs every build it finds, by default:

| Target | Build | Default binary | Override |
|---|---|---|---|
| `legacy` | Logseq 0.10.15, from the release's `Logseq-linux-arm64-0.10.15.zip` (check it against the release's `SHA256SUMS.txt` before extracting) | `~/.local/opt/logseq-0.10.15/Logseq` | `LOGSEQ_LEGACY_BIN` |
| `db` | Logseq 2.0.1, from `Logseq-linux-arm64-2.0.1.zip` | `~/.local/opt/logseq-db-2.0.1/logseq` | `LOGSEQ_DB_BIN` |
| `og` | a local build of `logseq/og` (optional) | `~/.local/opt/logseq-og/Logseq-OG` | `LOGSEQ_OG_BIN` |

```sh
npm run test:live -- --target=legacy,db    # the released builds only
LOGSEQ_LEGACY_BIN=/path/to/Logseq npm run test:live -- --target=legacy
```

A target whose binary is missing is skipped with a reason, never silently passed.
Run it with the screen **unlocked**: a locked session stops Logseq rendering.
Check first with `loginctl show-session "$XDG_SESSION_ID" -p LockedHint`.

<sub>[↑ Back to contents](#contents)</sub>

## Releasing

Releases are tag-driven:

1. Move `CHANGELOG.md` → `[Unreleased]` into a dated version section, and bump
   the version with `npm version <x.y.z> --no-git-tag-version` (keeps
   `package.json` and `package-lock.json` in step).
2. Run every gate, including the live suite on 0.10.15 and 2.x:
   `npm run typecheck && npm test && npm audit && npm run test:live`.
3. Merge, then tag `v<x.y.z>` on the default branch and push the tag. The
   *Release* workflow builds the plugin and attaches
   `logseq-epub-export-v<x.y.z>.zip` and `package.json` to a GitHub Release.
4. Paste the matching release notes (drafts live in `docs/releases/`).

For the Logseq marketplace, a `packages/logseq-epub-export/manifest.json` in
[`logseq/marketplace`](https://github.com/logseq/marketplace) with
`"supportsDB": true` (verified above) installs the latest release; later
releases need no marketplace PR.

<sub>[↑ Back to contents](#contents)</sub>

## License

MIT © CR0CKER
