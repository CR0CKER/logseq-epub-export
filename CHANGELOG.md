# Changelog

All notable changes to this project are documented here, in
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) format. The project
follows [Semantic Versioning](https://semver.org/).

## [Unreleased]

### Added

- Block references and embeds (#5). `((block))` and `[label](((block)))` link
  to the referenced block, labelled with its text or the given label;
  `{{embed [[page]]}}` and `{{embed ((block))}}` show the page or block (with
  its children) in place. Embeds nest up to three levels, and one that embeds
  itself becomes a link.
- When images fail to load, the panel log names the first one, every address
  tried and what each returned, so a report says where the read went wrong.

### Fixed

- Images are embedded on Windows again: the `file://` address the plugin reads
  graph assets through was built from the raw Windows path
  (`file://C%3A%5CUsers…`), so every image became a placeholder (#4). Drive
  letters and UNC shares now give valid addresses.

### Security

- DOMPurify (pulled in by `@logseq/libs`) raised to 3.4.16 for GHSA-p98j-92pf-mc4p, a
  low-severity DOM XSS in its `IN_PLACE` mode.

## [0.1.0] - 2026-09-16

First public release.

### Added

- One-click export of the active graph to an EPUB 3 (with NCX fallback) for
  e-readers: pages as chapters, tap-to-navigate `[[wikilinks]]` and aliases,
  `#tag` index chapters, Linked References, `{{query (property …)}}` expansion,
  a Home chapter and a grouped Pages / Tags / Journals TOC.
- Graph images embedded in the book: `![…](../assets/…)` on file graphs and
  image blocks on DB graphs. Images over 1264 px are downscaled; photos become
  JPEG, transparent images stay PNG, other formats are converted; files that
  already fit are copied unchanged. Web images stay links (no network access),
  and unreadable images keep a labelled placeholder.
- An auto-generated, e-ink-friendly cover, written as an opaque JPEG and
  declared for EPUB 3, EPUB 2 and Calibre/ADE readers.
- Settings: save to the graph's assets or a custom folder, overwrite or
  versioned filenames, journals on/off, output filename.
- The default file name follows Calibre's library naming, `<graph> - Logseq EPUB
  Export.epub`, so a direct export and a Calibre copy of the book share a name
  (and KOReader's reading history). Titles are cleaned up exactly as Calibre
  does, checked against Calibre's own output; only non-Latin scripts differ.
- Custom export folder: the first export opens a folder picker and saves there;
  **Remember export folder** (on by default) keeps it per graph, and unticking it
  forgets the stored folders so each export asks again. The panel offers
  **Change folder…**, and **Choose folder and export…** when an export can't open
  the picker itself. Works for unpacked and installed plugins alike.
- The toolbar icon opens the export panel (graph, folder, a log of each step,
  **Export now**); the command palette also has a direct export. The panel
  closes with Esc or an × styled like the close button of Logseq's own
  settings dialog on the running build (0.10.x/OG or 2.x), in the theme's text
  colour. While it is open, messages go to its log instead of Logseq
  notifications, which would appear over its close button.
- A panel that follows the active theme — background, font and accent colour —
  and restyles live when the theme, mode or accent changes; command palette
  entries.
- **Logseq 2.x DB graph support.** 2.x returns links as `[[uuid]]`, lowercased
  page names, headings as a property and namespaced page properties; the
  plugin normalizes these (`src/entities.ts`), leaves Logseq's built-in
  property and class pages out, and titles the book with the graph's name
  rather than `logseq_db_<name>`.
- A live test suite (`npm run test:live`) that drives real Logseq 0.10.15 and
  Logseq 2.0.1 (plus a local Logseq OG build, when present) in isolated profiles, exports a seeded graph with one click and
  checks the resulting book. Offline tests (`npm test`) for the entity
  normalization and rendering run in CI.
- CI (typecheck, offline tests, build, `npm audit`), a tag-driven publish
  workflow that attaches the plugin zip, Dependabot, `CONTRIBUTING.md` and
  `SECURITY.md`.
- A plugin and marketplace icon (an e-reader whose screen shows a
  connected-nodes graph, on the cover's teal; source `docs/icon.svg`), and README screenshots of the panel
  and of an exported book, retaken by `npm run screenshots`.
- The plugin declares `"effect": true`: Logseq otherwise loads it cross-origin
  (measured on 0.10.15 and 2.0.1), where the folder picker is blocked and the
  panel cannot follow the theme.

### Fixed

- Links to pages whose names contain `&`, `<` or `>` (e.g. `[[R&D]]`) now
  resolve, and their labels are escaped, so the chapter stays well-formed XHTML.
- `#[[multi word]]` tags render as one tag link instead of a page link with a
  stray `#`.
- Choosing a protected folder (the root of Downloads, Documents or Desktop, or
  the home folder) no longer fails silently. Electron waits for Logseq to allow
  such a folder and Logseq never answers, so the picker hung and later exports
  failed with "File picker already active". The picker now says to choose a
  folder inside one of those, and a stuck picker is explained (restart Logseq,
  then pick a subfolder). An export also shows progress, and a picker that
  returns no folder says so.

### Security

- `@logseq/libs` upgraded from 0.0.17 to 0.3.4, with its pinned `dompurify` and
  `lodash-es` overridden to patched releases; build tooling on Vite 6.4.3 and
  esbuild 0.28.2. `npm audit` reports no known vulnerabilities (7 before).

[Unreleased]: https://github.com/CR0CKER/logseq-epub-export/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/CR0CKER/logseq-epub-export/releases/tag/v0.1.0
