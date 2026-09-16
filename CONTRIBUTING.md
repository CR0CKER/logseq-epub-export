# Contributing

A Logseq plugin that exports a graph to EPUB. The README covers what it does, how
it's built and how to test it. These are the conventions for changing it.

## Rules

- **It must work on both Logseq OG (file graphs) and Logseq 2.x (DB graphs).**
  - The two builds return differently shaped data from the same API calls. Read
    entities through `src/entities.ts`, and add a row to its table (with a
    fixture in `tests/entities.ts`) when you find a new difference.
  - `npm run test:live` runs both builds by default; see README → Tests for the
    binary paths and overrides.
- **Test first, and see it fail.** An offline test in `tests/` for anything
  that can be checked without Logseq, and a live case in `tests/live/cases.mjs`
  for anything that depends on what a real build returns or renders.
- **Run the live suite with the screen unlocked.** A locked session stops
  Logseq rendering.
- **Docs ship in the same commit:** README (and its tables), and
  `CHANGELOG.md` → `[Unreleased]`.
- **Keep `render.ts` and `epub.ts` free of `@logseq/libs`** (`import type`
  only), so they bundle into the Node tests.
- **The EPUB must stay valid:** `mimetype` first and stored, every chapter
  well-formed XHTML. Both tiers check this.

## Gates

```sh
npm run typecheck && npm test && npm audit && npm run build
npm run test:live          # both builds; screen unlocked
```

## Git

- Work on a branch and open a pull request; squash-merge.
- Use [Conventional Commits](https://www.conventionalcommits.org/)
  (`feat:`, `fix:`, `docs:`, `test:`, `build(deps):`, …).
- Releases are tag-driven; see README → Releasing.
