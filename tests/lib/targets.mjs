/**
 * The Logseq builds the live suite can drive.
 *
 * Each entry is only a *binding*: paths come from the environment, so the
 * suite is not tied to one machine. A target whose binary is missing is
 * skipped with a reason, never silently passed.
 */
import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

export const TARGETS = {
  og: {
    id: 'og',
    label: 'Logseq OG (file graphs, 0.10.x line)',
    bin: process.env.LOGSEQ_OG_BIN || join(homedir(), '.local/opt/logseq-og/Logseq-OG'),
    // Logseq's dot-root lives under $HOME and is NOT moved by --user-data-dir,
    // so every launch overrides HOME. OG uses its own name; official builds use
    // .logseq, which on a developer's machine is a real profile.
    dotRoot: '.logseq-og',
    flags: ['--enable-features=WaylandWindowDecorations', '--gtk-version=4'],
  },
  db: {
    id: 'db',
    label: 'Logseq 2.x (DB graphs)',
    bin: process.env.LOGSEQ_DB_BIN || join(homedir(), '.local/opt/logseq-db-2.0.1/logseq'),
    dotRoot: '.logseq',
    flags: ['--enable-features=WaylandWindowDecorations', '--gtk-version=4'],
  },
}

export function resolveTargets(ids) {
  const wanted = ids?.length ? ids : Object.keys(TARGETS)
  return wanted.map((id) => {
    const t = TARGETS[id]
    if (!t) throw new Error(`unknown target "${id}" (known: ${Object.keys(TARGETS).join(', ')})`)
    const available = Boolean(t.bin) && existsSync(t.bin)
    return { ...t, available, unavailableReason: available ? null : `binary not found at ${t.bin}` }
  })
}
