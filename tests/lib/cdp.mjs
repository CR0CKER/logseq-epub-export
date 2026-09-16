/**
 * Minimal Chrome DevTools Protocol client.
 *
 * Every call carries its own timeout, because the failure mode that matters is
 * a renderer that stops answering: without a per-call deadline the whole suite
 * hangs instead of reporting which step died. (Logseq 0.10.13's renderer aborts
 * with SIGTRAP on some systems and does exactly this — the browser process
 * keeps serving /json/list while nothing renderer-side ever replies.)
 */

const DEFAULT_TIMEOUT_MS = 15000;

export async function connect(port, { timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
  const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
  const page = list.find((t) => t.type === 'page' && !t.url.startsWith('devtools://'));
  if (!page) throw new Error(`no page target on port ${port}`);

  const ws = new WebSocket(page.webSocketDebuggerUrl);
  const pending = new Map();
  let id = 0;

  ws.onmessage = (e) => {
    const m = JSON.parse(e.data);
    if (m.id && pending.has(m.id)) {
      pending.get(m.id)(m);
      pending.delete(m.id);
    }
  };
  await new Promise((resolve, reject) => {
    ws.onopen = resolve;
    ws.onerror = () => reject(new Error(`websocket failed on port ${port}`));
  });

  function call(method, params = {}, opts = {}) {
    const i = ++id;
    const deadline = opts.timeoutMs ?? timeoutMs;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        pending.delete(i);
        reject(new Error(`CDP ${method} did not answer within ${deadline}ms — renderer may be gone`));
      }, deadline);
      pending.set(i, (m) => {
        clearTimeout(timer);
        if (m.error) reject(new Error(`CDP ${method}: ${m.error.message}`));
        else resolve(m.result);
      });
      ws.send(JSON.stringify({ id: i, method, params }));
    });
  }

  /** Evaluate an expression in the page and return its value. */
  async function evaluate(expression, opts) {
    const res = await call('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }, opts);
    if (res.exceptionDetails) {
      const d = res.exceptionDetails;
      throw new Error(`page threw: ${d.exception?.description ?? d.text}`);
    }
    return res.result?.value;
  }

  /** Evaluate and JSON-parse — the page side returns JSON.stringify(...). */
  const evaluateJson = async (expression, opts) => JSON.parse(await evaluate(expression, opts));

  return { call, evaluate, evaluateJson, close: () => ws.close() };
}

/** Poll an expression until it is truthy, or give up. */
export async function waitFor(cdp, expression, { timeoutMs = 30000, intervalMs = 500, label = expression } = {}) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      if (await cdp.evaluate(expression)) return true;
    } catch {
      // A renderer that is still booting can refuse a call; keep polling until
      // the deadline rather than failing on the first miss.
    }
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  throw new Error(`timed out waiting for: ${label}`);
}
