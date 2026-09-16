# Contributing

A Logseq plugin that exports a graph to EPUB. The README covers what it does, how
it's built and how to test it. These are the conventions for changing it.

## Rules

- **It must work on both Logseq 0.10.x (file graphs) and Logseq 2.x (DB graphs).**
  - The two builds return differently shaped data from the same API calls. Read
    entities through `src/entities.ts`, and add a row to its table (with a
    fixture in `tests/entities.ts`) when you find a new difference.
  - `npm run test:live` runs 0.10.15, 2.0.1 and a local Logseq OG build, each
    when present; see README → Tests for the binary paths and overrides. Before
    a release, also run it with `--install=marketplace`.
- **Test first, and see it fail.** An offline test in `tests/` for anything
  that can be checked without Logseq, and a live case in `tests/live/cases.mjs`
  for anything that depends on what a real build returns or renders.
- **Run the live suite with the screen unlocked.** A locked session stops
  Logseq rendering.
- **Docs ship in the same commit:** README (and its tables), and
  `CHANGELOG.md` → `[Unreleased]`.
- **Keep `render.ts` and `epub.ts` free of `@logseq/libs`** (`import type`
  only), so they bundle into the Node tests.
- **Keep `"effect": true` in `package.json`.** Without it Logseq loads the plugin
  cross-origin (measured on 0.10.15 and 2.0.1): the folder picker is blocked and
  the panel cannot read the theme. `LIVE_EFFECT=false npm run test:live --
  --install=marketplace` shows it.
- **The EPUB must stay valid:** `mimetype` first and stored, every chapter
  well-formed XHTML. Both tiers check this.

## Gates

```sh
npm run typecheck && npm test && npm audit && npm run build
npm run test:live          # every build; screen unlocked
```

## Screenshots and icon

- `npm run screenshots` retakes `screenshots/panel.png` and `screenshots/book.png`
  in an isolated Logseq 0.10.15 (`--target=` for another build).
- `icon.png` (256 px) is rendered from `docs/icon.svg`: open it at 512 × 512 in a
  browser with a transparent background, screenshot, and downscale. Don't use the
  Chromium flatpak for text: its sandboxed fonts render plain Georgia in italics.

## Git

- Work on a branch and open a pull request; squash-merge.
- Use [Conventional Commits](https://www.conventionalcommits.org/)
  (`feat:`, `fix:`, `docs:`, `test:`, `build(deps):`, …).
- Releases are tag-driven; see README → Releasing.
