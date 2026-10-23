/**
 * Dev-only preload for the SAT v2 end-to-end run (scripts/sat/e2e/README in run.ts): logs every
 * outgoing request to OpenRouter and Mathpix as one JSON line in $E2E_FETCH_LOG — the URL, the
 * model, the messages (so the SAT context block the model really reads can be checked) and the
 * time. Headers (the keys) are never logged. Load it with
 *   NODE_OPTIONS="--require ./scripts/sat/e2e/fetch-log.cjs" E2E_FETCH_LOG=/tmp/x.jsonl next dev
 * Never used in production.
 */
const fs = require("node:fs");

const file = process.env.E2E_FETCH_LOG;
if (file && typeof globalThis.fetch === "function" && process.env.NODE_ENV !== "production") {
  const original = globalThis.fetch;
  const watched = /openrouter\.ai|mathpix\.com/;
  globalThis.fetch = async function loggedFetch(input, init) {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input?.url;
    if (!url || !watched.test(url)) return original(input, init);
    const at = Date.now();
    let body = null;
    try {
      if (init && typeof init.body === "string") body = JSON.parse(init.body);
    } catch {
      body = null;
    }
    const entry = { at, url, pid: process.pid };
    if (/mathpix/.test(url)) {
      entry.service = "mathpix";
      entry.formats = body?.formats ?? null;
      entry.hasImage = Boolean(body?.src);
      entry.strokes = body?.strokes ? body.strokes.strokes?.x?.length ?? null : null;
    } else {
      entry.service = "openrouter";
      entry.model = body?.model ?? null;
      entry.models = body?.models ?? null;
      entry.messages = Array.isArray(body?.messages)
        ? body.messages.map((m) => ({ role: m.role, content: typeof m.content === "string" ? m.content : Array.isArray(m.content) ? m.content.map((p) => (p.type === "text" ? { type: "text", text: p.text } : { type: p.type })) : null }))
        : null;
    }
    try {
      const res = await original(input, init);
      entry.status = res.status;
      entry.ms = Date.now() - at;
      fs.appendFileSync(file, JSON.stringify(entry) + "\n");
      return res;
    } catch (err) {
      entry.error = String(err && err.message ? err.message : err);
      fs.appendFileSync(file, JSON.stringify(entry) + "\n");
      throw err;
    }
  };
}
