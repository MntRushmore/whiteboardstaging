#!/usr/bin/env node
/**
 * Live Math route smoke test. Node 22+, no dependencies beyond fetch.
 *
 *   node scripts/live-smoke.mjs
 *
 * Env (defaults are read from .env.local when present):
 *   BASE_URL                      http://localhost:3113
 *   NEXT_PUBLIC_SUPABASE_URL      local Supabase (npx supabase start)
 *   NEXT_PUBLIC_SUPABASE_ANON_KEY
 *   SMOKE_EMAIL / SMOKE_PASSWORD  qa-student@example.com / password123
 *   SMOKE_SKIP_LLM=1              skip the check/solve streams (no OpenRouter spend)
 *
 * Besides the Live Math contract it walks every route in scripts/lib/routes.mjs
 * (kept in sync with src/app/api by src/__tests__/routeProtection.test.ts):
 * 401 unauthorized without a token, 200 for the public config/status route, and
 * a cheap 429 probe on /api/credits.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { API_ROUTES, protectedRoutes, routeProbes } from "./lib/routes.mjs";

// ---------------------------------------------------------------- env
function loadDotEnvLocal() {
  try {
    const text = readFileSync(resolve(process.cwd(), ".env.local"), "utf8");
    for (const raw of text.split("\n")) {
      const line = raw.trim();
      if (!line || line.startsWith("#")) continue;
      const eq = line.indexOf("=");
      if (eq < 0) continue;
      const key = line.slice(0, eq).trim();
      let value = line.slice(eq + 1).trim();
      if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
        value = value.slice(1, -1);
      }
      if (process.env[key] === undefined) process.env[key] = value;
    }
  } catch {
    /* no .env.local */
  }
}
loadDotEnvLocal();

const BASE_URL = (process.env.BASE_URL || "http://localhost:3113").replace(/\/$/, "");
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const EMAIL = process.env.SMOKE_EMAIL || "qa-student@example.com";
const PASSWORD = process.env.SMOKE_PASSWORD || "password123";
const SKIP_LLM = process.env.SMOKE_SKIP_LLM === "1";

if (!SUPABASE_URL || !ANON_KEY) {
  console.error("Missing NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY");
  process.exit(2);
}

// ---------------------------------------------------------------- tiny harness
let failures = 0;
let passes = 0;
function ok(cond, label, detail) {
  if (cond) {
    passes++;
    console.log(`  ok   ${label}${detail ? `  (${detail})` : ""}`);
  } else {
    failures++;
    console.log(`  FAIL ${label}${detail ? `  (${detail})` : ""}`);
  }
}
function section(title) {
  console.log(`\n== ${title}`);
}

// ---------------------------------------------------------------- helpers
async function signIn() {
  const res = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: { apikey: ANON_KEY, "Content-Type": "application/json" },
    body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
  });
  if (!res.ok) throw new Error(`sign-in failed: ${res.status} ${await res.text()}`);
  const data = await res.json();
  return data.access_token;
}

function authHeaders(token) {
  return { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
}

async function postJson(path, body, token) {
  return fetch(`${BASE_URL}${path}`, {
    method: "POST",
    headers: token ? authHeaders(token) : { "Content-Type": "application/json" },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

/** Parse an SSE body into [{event, data, atMs}] with timing relative to `startedAt`. */
async function readSse(res, startedAt) {
  const events = [];
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let idx;
    while ((idx = buffer.indexOf("\n\n")) >= 0) {
      const frame = buffer.slice(0, idx);
      buffer = buffer.slice(idx + 2);
      if (!frame.trim() || frame.startsWith(":")) continue;
      let event = "message";
      let data = "";
      for (const line of frame.split("\n")) {
        if (line.startsWith("event:")) event = line.slice(6).trim();
        else if (line.startsWith("data:")) data += line.slice(5).trim();
      }
      let parsed = data;
      try {
        parsed = JSON.parse(data);
      } catch {
        /* keep raw */
      }
      events.push({ event, data: parsed, atMs: Date.now() - startedAt });
    }
  }
  return events;
}

// ---------------------------------------------------------------- fixtures
/**
 * Synthetic strokes shaped like "2x+3=11" in a 180 px-high normalized box. Mathpix does not
 * need them to be pretty: the assertion is 200 + schema-valid, not a specific reading.
 */
function line(x0, y0, x1, y1, n = 12) {
  const xs = [];
  const ys = [];
  for (let i = 0; i < n; i++) {
    const t = i / (n - 1);
    xs.push(Math.round(x0 + (x1 - x0) * t));
    ys.push(Math.round(y0 + (y1 - y0) * t));
  }
  return [xs, ys];
}
function arc(cx, cy, r, a0, a1, n = 16) {
  const xs = [];
  const ys = [];
  for (let i = 0; i < n; i++) {
    const a = a0 + ((a1 - a0) * i) / (n - 1);
    xs.push(Math.round(cx + r * Math.cos(a)));
    ys.push(Math.round(cy + r * Math.sin(a)));
  }
  return [xs, ys];
}
function buildStrokes() {
  const strokes = [];
  // "2": top arc then diagonal then base
  strokes.push(arc(40, 60, 25, Math.PI, 2 * Math.PI + 0.6));
  strokes.push(line(58, 75, 15, 130));
  strokes.push(line(15, 130, 65, 130));
  // "x"
  strokes.push(line(90, 80, 140, 130));
  strokes.push(line(140, 80, 90, 130));
  // "+"
  strokes.push(line(170, 105, 220, 105));
  strokes.push(line(195, 80, 195, 130));
  // "3"
  strokes.push(arc(265, 75, 20, -Math.PI * 0.9, Math.PI * 0.5));
  strokes.push(arc(265, 115, 22, -Math.PI * 0.5, Math.PI * 0.9));
  // "="
  strokes.push(line(310, 95, 360, 95));
  strokes.push(line(310, 115, 360, 115));
  // "11"
  strokes.push(line(390, 50, 390, 130));
  strokes.push(line(420, 50, 420, 130));
  return { x: strokes.map((s) => s[0]), y: strokes.map((s) => s[1]) };
}

const CHECK_LINES = [
  { id: "l1", latex: "2x+3=11", bbox: [0, 0, 1, 0.33], local: { kind: "equation", verdict: "none" } },
  { id: "l2", latex: "2x=8", bbox: [0, 0.33, 1, 0.66], local: { kind: "equation", verdict: "ok" } },
  { id: "l3", latex: "x=5", bbox: [0, 0.66, 1, 1], local: { kind: "equation", verdict: "mismatch" } },
];
const REGION = { x: 100, y: 100, w: 400, h: 200 };

const ANNOTATION_VERDICTS = new Set(["ok", "warn", "info"]);
const ANNOTATION_KINDS = new Set(["arithmetic", "sign", "algebra", "units", "concept", "notation", "incomplete", "praise"]);
function isValidAnnotation(a) {
  return (
    a &&
    (a.lineId === null || typeof a.lineId === "string") &&
    ANNOTATION_VERDICTS.has(a.verdict) &&
    ANNOTATION_KINDS.has(a.kind) &&
    typeof a.message === "string" &&
    a.message.length > 0 &&
    a.message.length <= 200 &&
    typeof a.confidence === "number"
  );
}
function isValidStep(s) {
  return (
    s &&
    Number.isInteger(s.index) &&
    s.index >= 1 &&
    s.index <= 8 &&
    typeof s.latex === "string" &&
    s.latex.length > 0 &&
    typeof s.explanation === "string" &&
    typeof s.final === "boolean"
  );
}

// ---------------------------------------------------------------- run
async function main() {
  console.log(`Live smoke against ${BASE_URL} (supabase ${SUPABASE_URL}, user ${EMAIL})`);

  section(`401 without a bearer token (every protected route in scripts/lib/routes.mjs: ${protectedRoutes().length} files)`);
  for (const { method, path } of routeProbes(protectedRoutes())) {
    const res = await fetch(`${BASE_URL}${path}`, {
      method,
      headers: { "Content-Type": "application/json" },
      body: method === "POST" ? "{}" : undefined,
    });
    const body = await res.json().catch(() => ({}));
    ok(res.status === 401 && body.error === "unauthorized", `${method} ${path} -> 401 unauthorized`, `status ${res.status}`);
    ok(res.headers.get("www-authenticate") === "Bearer", `${method} ${path} sets WWW-Authenticate: Bearer`);
    // X-Request-Id is part of the Live contract only (see docs/ARCHITECTURE.md routes table).
    if (path.startsWith("/api/live/")) {
      ok(Boolean(res.headers.get("x-request-id")), `${method} ${path} carries X-Request-Id`);
    }
  }

  section("public routes answer without a token");
  for (const route of API_ROUTES.filter((r) => r.auth === "public")) {
    for (const method of route.methods) {
      const res = await fetch(`${BASE_URL}${route.path}`, { method });
      const body = await res.json().catch(() => null);
      const expected = route.withoutTokenStatus ?? [200];
      ok(expected.includes(res.status), `${method} ${route.path} -> ${expected.join("/")} without a token`, `status ${res.status}`);
      if (route.path === "/api/config/status") {
        ok(body && typeof body.configured === "boolean" && Array.isArray(body.providers), "config/status body is { configured, providers[] }");
        ok(
          Boolean(body) && body.providers.every((p) => typeof p.present === "boolean" && !("value" in p)),
          "config/status providers expose booleans only (no key material)",
        );
        ok(res.headers.get("cache-control") === "no-store", "config/status is Cache-Control: no-store", res.headers.get("cache-control"));
      }
    }
  }

  const token = await signIn();
  ok(typeof token === "string" && token.split(".").length === 3, "signed in (password grant)");

  section("GET /api/live/recognize (capabilities)");
  {
    const res = await fetch(`${BASE_URL}/api/live/recognize`, { headers: authHeaders(token) });
    const body = await res.json();
    ok(res.status === 200, "status 200", `status ${res.status}`);
    ok(["mathpix", "vision"].includes(body.recognizer), "recognizer is mathpix|vision", body.recognizer);
    ok(typeof body.liveEnabled === "boolean", "liveEnabled boolean", String(body.liveEnabled));
    ok(
      body.models && ["check", "solve", "vision"].every((k) => typeof body.models[k] === "string" && body.models[k].includes("/")),
      "models.check/solve/vision are model ids",
      JSON.stringify(body.models),
    );
    ok(Boolean(res.headers.get("x-request-id")), "X-Request-Id present");
  }

  section("POST /api/live/recognize");
  {
    const strokes = buildStrokes();
    const startedAt = Date.now();
    const res = await postJson(
      "/api/live/recognize",
      { boardId: "smoke-board", lineId: "ln_smoke001", strokes, bounds: { w: 440, h: 180 }, hint: "math" },
      token,
    );
    const body = await res.json();
    const ms = Date.now() - startedAt;
    ok(res.status === 200, "status 200", `status ${res.status} ${res.status !== 200 ? JSON.stringify(body) : ""}`);
    ok(typeof body.latex === "string", "latex string", JSON.stringify(body.latex));
    ok(typeof body.text === "string", "text string");
    ok(["math", "chem", "text", "unknown"].includes(body.kind), "kind enum", body.kind);
    ok(typeof body.confidence === "number" && body.confidence >= 0 && body.confidence <= 1, "confidence 0..1", String(body.confidence));
    ok(["mathpix", "vision"].includes(body.provider), "provider enum", body.provider);
    ok(typeof body.ms === "number", "ms number", `server ${body.ms} ms, wall ${ms} ms`);

    const bad = await postJson("/api/live/recognize", { boardId: "b", strokes: { x: [[1]], y: [[1], [2]] } }, token);
    const badBody = await bad.json();
    ok(bad.status === 400 && badBody.error === "invalid_request" && Array.isArray(badBody.issues), "bad body -> 400 invalid_request with issues", `status ${bad.status}`);

    const notJson = await postJson("/api/live/recognize", "{not json", token);
    ok(notJson.status === 400, "malformed JSON -> 400", `status ${notJson.status}`);
  }

  if (SKIP_LLM) {
    console.log("\n(skipping check/solve streams: SMOKE_SKIP_LLM=1)");
  } else {
    section("POST /api/live/check (SSE)");
    {
      const startedAt = Date.now();
      const res = await postJson(
        "/api/live/check",
        { boardId: "smoke-board", mode: "suggest", subject: "algebra", region: REGION, lines: CHECK_LINES, focusLineId: "l3", userAsked: true },
        token,
      );
      ok(res.status === 200, "status 200", `status ${res.status}`);
      ok((res.headers.get("content-type") || "").startsWith("text/event-stream"), "content-type text/event-stream", res.headers.get("content-type"));
      ok(res.headers.get("x-accel-buffering") === "no", "X-Accel-Buffering: no");
      const events = await readSse(res, startedAt);
      const names = events.map((e) => e.event);
      console.log("  events:", events.map((e) => `${e.event}@${e.atMs}ms`).join(" "));
      ok(names[0] === "meta", "first event is meta", names[0]);
      const meta = events.find((e) => e.event === "meta");
      ok(meta && typeof meta.data.requestId === "string" && typeof meta.data.model === "string", "meta has requestId + model", meta && meta.data.model);
      ok(meta && meta.atMs < 1000, "meta within 1 s", meta && `${meta.atMs} ms`);
      ok(names[names.length - 1] === "done", "last event is done", names[names.length - 1]);
      const annotations = events.filter((e) => e.event === "annotation");
      ok(annotations.length >= 1, "at least one annotation for the mismatched line 3", `${annotations.length} annotation(s)`);
      ok(annotations.every((a) => isValidAnnotation(a.data)), "every annotation matches AnnotationSchema");
      ok(annotations.length <= 3, "at most 3 annotations");
      if (annotations[0]) {
        console.log("  first annotation:", JSON.stringify(annotations[0].data));
        ok(annotations[0].atMs < 6000, "first annotation < 6 s (target 2 s)", `${annotations[0].atMs} ms`);
        ok(!/!/.test(annotations[0].data.message), "no exclamation marks");
      }
      const done = events.find((e) => e.event === "done");
      ok(done && done.data.count === annotations.length && typeof done.data.ms === "number", "done.count matches annotations", done && JSON.stringify(done.data));
      ok(!names.includes("error"), "no error event");
    }

    section("POST /api/live/check (feedback mode strips question/latex)");
    {
      const startedAt = Date.now();
      const res = await postJson(
        "/api/live/check",
        { boardId: "smoke-board", mode: "feedback", region: REGION, lines: CHECK_LINES, userAsked: true },
        token,
      );
      const events = await readSse(res, startedAt);
      const annotations = events.filter((e) => e.event === "annotation");
      console.log("  events:", events.map((e) => `${e.event}@${e.atMs}ms`).join(" "));
      ok(events[0]?.event === "meta" && events[events.length - 1]?.event === "done", "meta ... done");
      ok(annotations.every((a) => a.data.question === undefined && a.data.latex === undefined), "no question/latex in feedback mode", `${annotations.length} annotation(s)`);
    }

    section("POST /api/live/solve (SSE)");
    {
      const startedAt = Date.now();
      const res = await postJson(
        "/api/live/solve",
        { boardId: "smoke-board", region: REGION, lines: CHECK_LINES.slice(0, 1), goal: "solve for x" },
        token,
      );
      ok(res.status === 200, "status 200", `status ${res.status}`);
      const events = await readSse(res, startedAt);
      const names = events.map((e) => e.event);
      console.log("  events:", events.map((e) => `${e.event}@${e.atMs}ms`).join(" "));
      ok(names[0] === "meta", "first event is meta", names[0]);
      const steps = events.filter((e) => e.event === "step");
      ok(steps.length >= 1 && steps.length <= 8, "1..8 steps", `${steps.length}`);
      ok(steps.every((s) => isValidStep(s.data)), "every step matches SolveStepSchema");
      ok(steps.every((s, i) => s.data.index === i + 1), "steps are indexed 1..n");
      const last = steps[steps.length - 1];
      ok(last && last.data.final === true, "last step has final: true", last && JSON.stringify(last.data));
      ok(last && /\\boxed\{/.test(last.data.latex), "final step is boxed", last && last.data.latex);
      ok(steps.slice(0, -1).every((s) => s.data.final === false), "only the last step is final");
      ok(names[names.length - 1] === "done", "last event is done", names[names.length - 1]);
      for (const s of steps) console.log(`  step ${s.data.index}${s.data.final ? " (final)" : ""}: ${s.data.latex}  -- ${s.data.explanation}`);
    }
  }

  section("429 on /api/credits after a burst (credits bucket: 30/min)");
  {
    const results = await Promise.all(
      Array.from({ length: 31 }, () => fetch(`${BASE_URL}/api/credits`, { headers: authHeaders(token) })),
    );
    const statuses = results.map((r) => r.status);
    const limited = results.find((r) => r.status === 429);
    ok(Boolean(limited), "at least one 429 within 31 GETs", `statuses: ${[...new Set(statuses)].join(",")}`);
    if (limited) {
      const body = await limited.json();
      ok(body.error === "rate_limited" && typeof body.retryAfterMs === "number", "429 body is rate_limited + retryAfterMs", JSON.stringify(body));
      ok(/^\d+$/.test(limited.headers.get("retry-after") || ""), "Retry-After header (seconds)", limited.headers.get("retry-after"));
    }
    ok(statuses.every((s) => s !== 401), "no 401 while signed in");
  }

  section("429 after a burst (recognize bucket: 120/min; bad bodies still consume slots)");
  {
    let got429 = null;
    const total = 130;
    const batch = 26;
    for (let i = 0; i < total && !got429; i += batch) {
      const results = await Promise.all(
        Array.from({ length: batch }, () => postJson("/api/live/recognize", { nope: true }, token)),
      );
      got429 = results.find((r) => r.status === 429) || null;
    }
    ok(Boolean(got429), "a 429 appears within 130 rapid calls");
    if (got429) {
      const body = await got429.json();
      ok(body.error === "rate_limited" && typeof body.retryAfterMs === "number", "429 body is rate_limited + retryAfterMs", JSON.stringify(body));
      ok(/^\d+$/.test(got429.headers.get("retry-after") || ""), "Retry-After header (seconds)", got429.headers.get("retry-after"));
      ok(Boolean(got429.headers.get("x-request-id")), "X-Request-Id on the 429");
    }
  }

  console.log(`\n${passes} passed, ${failures} failed`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error("smoke crashed:", err);
  process.exit(1);
});
