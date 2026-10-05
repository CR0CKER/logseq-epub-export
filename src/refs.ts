/**
 * Logseq's block-reference syntax, shared by graph.ts (indexing) and
 * render.ts (resolving). Pure, so the render layer bundles into the tests.
 *
 * Both file and DB graphs hand plugins the raw `((uuid))` text (measured on
 * 0.10.15 and 2.0.1): unlike `[[uuid]]` page links, DB graphs' `fullTitle`
 * leaves block references unresolved.
 */
const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}'

/** `((uuid))`, alone or inside a labelled reference or an embed. */
export const BLOCK_REF = new RegExp(`\\(\\((${UUID})\\)\\)`, 'gi')

/** `[label](((uuid)))`: a reference shown with its own label. */
export const LABELLED_REF = new RegExp(`\\[([^\\]]+)\\]\\(\\(\\((${UUID})\\)\\)\\)`, 'gi')

/** `{{embed ((uuid))}}` or `{{embed [[page]]}}`. */
export const EMBED = new RegExp(`\\{\\{embed\\s+(?:\\(\\((${UUID})\\)\\)|\\[\\[([^\\]]+)\\]\\])\\s*\\}\\}`, 'gi')
