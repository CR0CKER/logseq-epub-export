# Changelog

All notable changes to this project are documented here, in
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) format. The project
follows [Semantic Versioning](https://semver.org/).

## [Unreleased]

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
- Settings: save to the graph's assets or a custom folder (remembered per
  graph), overwrite or versioned filenames, journals on/off, output filename.
- A panel that follows the app's light/dark theme, and command palette entries.
- **Logseq 2.x DB graph support.** 2.x returns links as `[[uuid]]`, lowercased
  page names, headings as a property and namespaced page properties; the
  plugin normalizes these (`src/entities.ts`), leaves Logseq's built-in
  property and class pages out, and titles the book with the graph's name
  rather than `logseq_db_<name>`.
- A live test suite (`npm run test:live`) that drives real Logseq 0.10.15 and
  Logseq 2.0.1 (plus a local Logseq OG build, when present) in isolated profiles, exports a seeded graph with one click and
  checks the resulting book. Offline tests (`npm test`) for the entity
  normalization and rendering run in CI.
- CI (typecheck, offline tests, build, `npm audit`), a tag-driven release
  workflow that attaches the plugin zip, Dependabot, `CONTRIBUTING.md` and
  `SECURITY.md`.

### Fixed

- Links to pages whose names contain `&`, `<` or `>` (e.g. `[[R&D]]`) now
  resolve, and their labels are escaped, so the chapter stays well-formed XHTML.
- `#[[multi word]]` tags render as one tag link instead of a page link with a
  stray `#`.

### Security

- `@logseq/libs` upgraded from 0.0.17 to 0.3.4, with its pinned `dompurify` and
  `lodash-es` overridden to patched releases; build tooling on Vite 6.4.3 and
  esbuild 0.28.2. `npm audit` reports no known vulnerabilities (7 before).

[Unreleased]: https://github.com/CR0CKER/logseq-epub-export/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/CR0CKER/logseq-epub-export/releases/tag/v0.1.0
