/**
 * Launch a Logseq instance that cannot touch anything real, then tear it down.
 *
 * Isolation is the hard requirement, and it has one non-obvious part:
 * `--user-data-dir` moves only Chromium's profile. Logseq's dot-root (plugins,
 * settings, graph list) comes from `$HOME`, so every launch overrides HOME as
 * well. Getting this wrong runs a test instance against a real profile.
 *
 * Adapted from the logseq-adwaita-theme live suite (tests/lib/scratch.mjs).
 */
import { spawn, execFileSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync, cpSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, basename } from 'node:path'
import { connect, waitFor } from './cdp.mjs'

export const PLUGIN_ID = 'logseq-epub-export'
const REPO_ROOT = new URL('../..', import.meta.url).pathname.replace(/\/$/, '')

function pickPort() {
  return 9600 + Math.floor(Math.random() * 300)
}

/**
 * @param install 'unpacked' loads the repo as Developer mode's "Load unpacked
 *   plugin" does (listed in preferences.json `externals`); 'marketplace' copies
 *   the built plugin into <dotRoot>/plugins/<id>/, where a marketplace or zip
 *   install lives. The two can load the plugin iframe from different origins.
 */
export async function launch(target, { pluginPath = REPO_ROOT, settings = {}, install = 'unpacked' } = {}) {
  const root = mkdtempSync(join(tmpdir(), `epub-live-${target.id}-`))
  const home = join(root, 'home')
  const userData = join(root, 'user-data')
  const dot = join(home, target.dotRoot)
  mkdirSync(join(dot, 'config'), { recursive: true })
  mkdirSync(join(dot, 'settings'), { recursive: true })
  mkdirSync(userData, { recursive: true })

  // Unpacked: straight from the repo, so the suite tests the working tree (its
  // dist/ build) rather than a copy that can go stale. Marketplace: a copy of
  // that same build, in the installed-plugins folder.
  if (install === 'marketplace') {
    const dest = join(dot, 'plugins', PLUGIN_ID)
    mkdirSync(dest, { recursive: true })
    for (const f of ['package.json', 'icon.svg', 'dist']) cpSync(join(pluginPath, f), join(dest, f), { recursive: true })
  }
  writeFileSync(
    join(dot, 'preferences.json'),
    JSON.stringify({ theme: null, themes: { mode: 'light' }, externals: install === 'marketplace' ? [] : [pluginPath] }, null, 2),
  )
  writeFileSync(join(dot, 'config/plugins.edn'), '{}\n')
  writeFileSync(join(dot, `settings/${PLUGIN_ID}.json`), JSON.stringify({ disabled: false, ...settings }, null, 2))

  const port = pickPort()
  // The main process's Node inspector, so openFileGraph can answer the native
  // folder dialog. Electron honours --inspect only while the
  // EnableNodeCliInspectArguments fuse is on; OG ships with it on.
  const inspectPort = port + 1000
  const args = [`--user-data-dir=${userData}`, `--remote-debugging-port=${port}`, `--inspect=127.0.0.1:${inspectPort}`, ...target.flags]
  const proc = spawn(target.bin, args, {
    env: { ...process.env, HOME: home },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  const logLines = []
  proc.stdout?.on('data', (d) => logLines.push(String(d)))
  proc.stderr?.on('data', (d) => logLines.push(String(d)))

  const deadline = Date.now() + 60000
  let cdp
  while (Date.now() < deadline) {
    try {
      cdp = await connect(port)
      break
    } catch {
      await new Promise((r) => setTimeout(r, 1000))
    }
  }
  const session = { cdp, proc, root, home, port, inspectPort, target, log: () => logLines.join('') }
  if (!cdp) {
    teardown(session)
    throw new Error(`${target.label}: no DevTools endpoint after 60s\n${session.log().slice(-800)}`)
  }
  await waitFor(cdp, 'Boolean(window.LSPluginCore)', { label: 'LSPluginCore', timeoutMs: 45000 })
  return session
}

/** Evaluate one expression in the Electron main process via its Node inspector. */
async function evaluateInMain(inspectPort, expression) {
  const list = await (await fetch(`http://127.0.0.1:${inspectPort}/json/list`)).json()
  if (!list[0]) throw new Error(`no Node inspector target on port ${inspectPort}`)
  const ws = new WebSocket(list[0].webSocketDebuggerUrl)
  await new Promise((resolve, reject) => {
    ws.onopen = resolve
    ws.onerror = () => reject(new Error(`inspector websocket failed on port ${inspectPort}`))
  })
  try {
    const reply = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('main process did not answer within 10s')), 10000)
      ws.onmessage = (e) => {
        const m = JSON.parse(e.data)
        if (m.id === 1) { clearTimeout(timer); resolve(m) }
      }
      ws.send(JSON.stringify({ id: 1, method: 'Runtime.evaluate', params: { expression, returnByValue: true } }))
    })
    const r = reply.result
    if (reply.error || r?.exceptionDetails) {
      throw new Error(`main process threw: ${reply.error?.message ?? r.exceptionDetails.exception?.description}`)
    }
    return r?.result?.value
  } finally {
    ws.close()
  }
}

/**
 * Open `graphDir` as a real file graph on Logseq OG.
 *
 * OG only opens a folder through the native dialog (ipc `openDir` →
 * `dialog.showOpenDialog`), and a scratch profile has no graph to fall back
 * on: it sits on the unsaved demo graph, where the plugin's asset storage has
 * nowhere to write. So the main process's dialog is answered with the seeded
 * folder, and the onboarding card is clicked the way a user would.
 */
export async function openFileGraph(session, graphDir) {
  const { cdp } = session
  const stubbed = await evaluateInMain(
    session.inspectPort,
    `(() => {
      const { dialog } = process.mainModule.require('electron')
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [${JSON.stringify(graphDir)}] })
      return true
    })()`,
  )
  if (!stubbed) throw new Error('could not stub the folder dialog in the main process')
  await waitFor(cdp, `Boolean(document.querySelector('.cp__onboarding-setups label.action-input'))`, {
    label: 'the onboarding "Choose a folder" card',
    timeoutMs: 30000,
  })
  await cdp.evaluate(`document.querySelector('.cp__onboarding-setups label.action-input').click(); true`)
  // Fail loudly if the graph did not open: a readiness check that also passes
  // on the demo graph is how the theme suite's openGraph went silently wrong.
  await waitFor(cdp, `(async () => (await logseq.api.get_current_graph())?.path === ${JSON.stringify(graphDir)})()`, {
    label: `Logseq to open the graph at ${graphDir}`,
    timeoutMs: 45000,
  })
}

/**
 * Stop the instance. Kill by PID only: `pkill -f` matches the shell running it
 * and Chromium children, and has killed the wrong thing before.
 */
export function teardown(session) {
  const { proc, root, target } = session
  try {
    session.cdp?.close()
  } catch {
    /* already closed */
  }
  try {
    proc.kill('SIGKILL')
  } catch {
    /* already gone */
  }
  // Electron can outlive a killed launcher; sweep any process of this binary
  // still pointing at our scratch profile.
  try {
    const pids = execFileSync('pgrep', ['-x', basename(target.bin)], { encoding: 'utf8' }).trim().split('\n').filter(Boolean)
    for (const pid of pids) {
      try {
        const cmdline = readFileSync(`/proc/${pid}/cmdline`, 'utf8').replace(/\0/g, ' ')
        if (cmdline.includes(root)) process.kill(Number(pid), 'SIGKILL')
      } catch {
        /* raced with exit */
      }
    }
  } catch {
    /* pgrep found nothing */
  }
  try {
    rmSync(root, { recursive: true, force: true })
  } catch {
    /* best effort */
  }
}
