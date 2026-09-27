/**
 * HANDWRITING scoreboard: the whole pen-to-answer pipeline, with the tutor's OWN hand as the
 * student. Each corpus line is written by `layoutMath` (src/lib/hand), mildly perturbed (slant,
 * scale, a little per-stroke wobble), turned into the board's ink (`InkStroke`), clustered
 * (`clusterLines`) and normalized (`buildPayload`) exactly as LiveLoop does, sent to Mathpix
 * `v3/strokes` (`recognizeStrokes`, the server's own call), and the RECOGNIZED LaTeX is then put
 * through the same `localSolve` + `judge` as the offline scoreboard.
 *
 * Costs Mathpix calls, so it only runs with RUN_LIVE_EVAL=1 (src/__eval__/handwriting.test.ts):
 * at most `CONCURRENCY` in flight, paced, at most `MAX_CALLS` per run, and every answer cached on disk under
 * src/__eval__/.cache/ keyed by the sha-1 of the exact request body — a rerun is free.
 */
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import type { TLShapeId } from "tldraw";
import { layoutMath, mulberry32 } from "@/lib/hand";
import type { InkLine, InkStroke, LiveEngine, StrokePayload } from "@/lib/live/contracts";
import { unionRects, clusterLines } from "@/lib/live/strokeClusters";
import { buildPayload } from "@/lib/live/strokePayload";
import { buildStrokesBody, recognizeStrokes, type MathpixOutcome } from "@/lib/server/mathpix";
import type { EvalProblem } from "./corpus";
import type { Verdict } from "./judge";
import { solveAndJudge } from "./offline";
import { cleanLatex, compareExprs, parseLine, type Parsed } from "./oracle";

export const MAX_CALLS = 1500;
export const CONCURRENCY = 6;
/** the student's line on a 1600×900 screen is ~40–60 px tall; the payload is normalized anyway */
const HAND_SIZE = 44;

// ---------------------------------------------------------------- writing a line by hand

export interface Variant {
  name: string;
  seed: number;
  /** horizontal shear per unit of height above the baseline (italic lean) */
  slant: number;
  sx: number;
  sy: number;
  rotateDeg: number;
  /** per-stroke random offset, as a fraction of the hand size */
  jitter: number;
  /**
   * Uneven glyph sizes: the local size swings by ±this fraction along the line (a smooth,
   * monotone warp, so one glyph's strokes stay together while its neighbours grow and shrink).
   */
  sizeDrift?: number;
  /** A wandering baseline: ±this fraction of the hand size, slowly along the line. */
  wander?: number;
}

/**
 * The student, three ways. The glyph shapes come from the hand atlas (the seed picks between
 * its alternates); what changes here is how the pen moves across the line. `steep` is there to
 * find where recognition breaks; `messy` is a hurried student: uneven sizes, a wandering
 * baseline, strokes landing a little off.
 */
export const VARIANTS: readonly Variant[] = [
  { name: "clean", seed: 1, slant: 0, sx: 1, sy: 1, rotateDeg: 0, jitter: 0 },
  { name: "slanted", seed: 7, slant: 0.14, sx: 0.94, sy: 1.06, rotateDeg: -1.5, jitter: 0.035 },
  { name: "steep", seed: 11, slant: 0.3, sx: 0.9, sy: 1.1, rotateDeg: -4, jitter: 0.06 },
  { name: "messy", seed: 23, slant: 0.1, sx: 1, sy: 1, rotateDeg: 1, jitter: 0.05, sizeDrift: 0.2, wander: 0.12 },
];

export function describeVariant(v: Variant): string {
  const parts: string[] = [];
  if (v.slant) parts.push(`slant ${v.slant}`);
  if (v.sx !== 1 || v.sy !== 1) parts.push(`scale ${v.sx}×${v.sy}`);
  if (v.rotateDeg) parts.push(`rotate ${v.rotateDeg}°`);
  if (v.jitter) parts.push(`stroke wobble ${v.jitter}`);
  if (v.sizeDrift) parts.push(`glyph sizes ±${Math.round(v.sizeDrift * 100)}%`);
  if (v.wander) parts.push(`baseline wander ±${v.wander}`);
  return parts.length === 0 ? "as laid out" : parts.join(", ");
}

/**
 * A line as a student WRITES it: Mathpix's `\mathrm{~km}` spacing is not ink, and the power in
 * `\mathrm{m/s^{2}}` is a superscript on the page (inside `\mathrm` the hand draws a literal `^`).
 */
export function handLatex(latex: string): string {
  return latex
    .replace(/\\mathrm\s*\{\s*~\s*/g, "\\,\\mathrm{")
    .replace(/~/g, " ")
    .replace(/\\mathrm\s*\{([^{}]*?)\^\{([^{}]*)\}\s*\}/g, "\\mathrm{$1}^{$2}");
}

export interface HandInk {
  strokes: InkStroke[];
  unsupported: string[];
}

/** The tutor's hand writing `latex`, as the board's ink (page coordinates). */
export function handInk(latex: string, variant: Variant): HandInk {
  const layout = layoutMath(handLatex(latex), { size: HAND_SIZE, seed: variant.seed });
  if (layout.unsupported.length > 0 || layout.strokes.length === 0) return { strokes: [], unsupported: layout.unsupported.length > 0 ? layout.unsupported : ["(no ink)"] };
  const rand = mulberry32(variant.seed * 7919 + latex.length);
  const cx = layout.width / 2;
  const cy = layout.height / 2;
  const angle = (variant.rotateDeg * Math.PI) / 180;
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  const origin = { x: 240, y: 320 };
  // uneven sizes: local scale s(x) = 1 + A·sin(kx + φ); x is warped by ∫s so widths follow it
  const A = variant.sizeDrift ?? 0;
  const W = (variant.wander ?? 0) * HAND_SIZE;
  const warpRand = mulberry32(variant.seed * 104729 + latex.length);
  const phi = warpRand() * 2 * Math.PI;
  const psi = warpRand() * 2 * Math.PI;
  const k = (2 * Math.PI) / (4 * HAND_SIZE);
  const warp = (p: { x: number; y: number }): { x: number; y: number } => {
    if (A === 0 && W === 0) return p;
    const s = 1 + A * Math.sin(k * p.x + phi);
    const x = A === 0 ? p.x : p.x - (A / k) * (Math.cos(k * p.x + phi) - Math.cos(phi));
    return { x, y: layout.baseline + (p.y - layout.baseline) * s + W * Math.sin(((2 * Math.PI) / (7 * HAND_SIZE)) * p.x + psi) };
  };
  const strokes: InkStroke[] = layout.strokes.map((st, i) => {
    const dx = (rand() - 0.5) * 2 * variant.jitter * HAND_SIZE;
    const dy = (rand() - 0.5) * 2 * variant.jitter * HAND_SIZE;
    const points = st.points.map((raw) => {
      const p = warp(raw);
      let x = p.x + variant.slant * (layout.baseline - p.y);
      let y = p.y;
      x = (x - cx) * variant.sx;
      y = (y - cy) * variant.sy;
      return { x: origin.x + cx + x * cos - y * sin + dx, y: origin.y + cy + x * sin + y * cos + dy };
    });
    const xs = points.map((p) => p.x);
    const ys = points.map((p) => p.y);
    const bounds = { x: Math.min(...xs), y: Math.min(...ys), w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys) };
    return { id: `shape:hand_${i}` as TLShapeId, bounds, segments: [points] };
  });
  return { strokes, unsupported: [] };
}

export interface LinePayload {
  payload: StrokePayload | null;
  /** how many lines `clusterLines` made of it (1 = the board reads it as one line) */
  clusters: number;
}

/**
 * The payload the board would send for this ink. When the clusterer splits one written line in
 * two, the board would send the pieces separately; the eval records the split (a segmentation
 * failure) and still sends the whole line, so recognition is measured on its own.
 */
export function payloadFor(strokes: InkStroke[]): LinePayload {
  const lines = clusterLines(strokes);
  const whole: InkLine = {
    id: "eval",
    strokeIds: strokes.map((s) => s.id),
    bounds: unionRects(strokes.map((s) => s.bounds)),
    column: 0,
    row: 0,
    hash: "",
  };
  const line = lines.length === 1 ? lines[0] : whole;
  return { payload: buildPayload(line, strokes), clusters: lines.length };
}

// ---------------------------------------------------------------- Mathpix, cached

export const CACHE_DIR = resolve(__dirname, ".cache", "mathpix");

export interface Recognition {
  ok: boolean;
  latex: string;
  confidence: number;
  /** why there is no LaTeX: a Mathpix failure reason, or `budget` */
  reason?: string;
  detail?: string;
  cached: boolean;
}

export function cacheKey(payload: StrokePayload): string {
  return createHash("sha1").update(JSON.stringify(buildStrokesBody(payload))).digest("hex");
}

export interface CallBudget {
  /** calls still allowed this run (every request counts, retries included) */
  remaining: number;
  calls: number;
  hits: number;
  /**
   * Least ms between two request starts. Mathpix answers `http_max_requests` ("Limit exceeded
   * for req (200)") past ~200 requests a minute — the first full run hit it at 4 in flight.
   */
  minIntervalMs?: number;
  /** wait before retrying a timeout / network failure */
  retryDelayMs?: number;
  /** wait after Mathpix says too many requests */
  rateLimitWaitMs?: number;
  /** when the next request may start (the throttle's state) */
  nextAt?: number;
  /** how many times Mathpix said too many requests */
  rateLimited?: number;
}

/** Pacing for a real run: ≤ ~500 requests a minute, halved on every 429, and a minute's pause after one. */
export const PACING = { minIntervalMs: 120, retryDelayMs: 2_000, rateLimitWaitMs: 61_000 } as const;

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** Reserves the next start slot synchronously (so concurrent callers queue), then waits for it. */
async function waitTurn(budget: CallBudget): Promise<void> {
  const interval = budget.minIntervalMs ?? 0;
  if (interval <= 0) return;
  const now = Date.now();
  const at = Math.max(now, budget.nextAt ?? 0);
  budget.nextAt = at + interval;
  if (at > now) await sleep(at - now);
}

function isRateLimit(o: MathpixOutcome): boolean {
  return !o.ok && (o.status === 429 || /max_requests|limit exceeded|too many/i.test(o.detail ?? ""));
}

export async function recognizeCached(payload: StrokePayload, budget: CallBudget, cacheDir = CACHE_DIR): Promise<Recognition> {
  const file = join(cacheDir, `${cacheKey(payload)}.json`);
  if (existsSync(file)) {
    budget.hits++;
    return { ...(JSON.parse(readFileSync(file, "utf8")) as Omit<Recognition, "cached">), cached: true };
  }
  let outcome: MathpixOutcome | null = null;
  let transient = 0;
  let limited = 0;
  for (;;) {
    if (budget.remaining <= 0) return { ok: false, latex: "", confidence: 0, reason: "budget", cached: false };
    budget.remaining--;
    budget.calls++;
    await waitTurn(budget);
    outcome = await recognizeStrokes(payload, undefined, { timeoutMs: 15_000, log: { warn: () => {} } });
    if (outcome.ok) break;
    if (isRateLimit(outcome)) {
      budget.rateLimited = (budget.rateLimited ?? 0) + 1;
      // slow down for the rest of the run, then wait the minute out
      budget.minIntervalMs = Math.min(2_000, Math.max(250, (budget.minIntervalMs ?? 0) * 2));
      if (++limited > 2) break;
      await sleep(budget.rateLimitWaitMs ?? 0);
      continue;
    }
    if ((outcome.reason === "timeout" || outcome.reason === "network") && ++transient <= 1) {
      await sleep(budget.retryDelayMs ?? 0);
      continue;
    }
    break;
  }
  const rec: Omit<Recognition, "cached"> = outcome?.ok
    ? { ok: true, latex: outcome.latex, confidence: outcome.confidence }
    : { ok: false, latex: "", confidence: 0, reason: outcome?.reason ?? "unknown", detail: outcome && !outcome.ok ? outcome.detail : undefined };
  // only answers are cached: a read (or Mathpix saying it cannot read the ink), never a transport failure
  if (rec.ok || rec.reason === "api_error") {
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, JSON.stringify(rec) + "\n");
  }
  return { ...rec, cached: false };
}

/** Runs `work` over `items` with at most `limit` in flight, results in input order. */
export async function pool<T, R>(items: readonly T[], limit: number, work: (item: T) => Promise<R>): Promise<R[]> {
  const out = new Array<R>(items.length);
  let next = 0;
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await work(items[i]);
    }
  });
  await Promise.all(runners);
  return out;
}

// ---------------------------------------------------------------- env

/**
 * Loads the Mathpix keys (and the three variables the server env insists on) from the nearest
 * `.env.local` up from the repo root, without overriding anything already set. Never logs them.
 * Returns the file it read, or null.
 */
export function loadEnvLocal(start = resolve(__dirname, "..", "..")): string | null {
  const wanted = ["MATHPIX_APP_ID", "MATHPIX_APP_KEY", "NEXT_PUBLIC_SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_ANON_KEY", "OPENROUTER_API_KEY"];
  let dir = start;
  for (let i = 0; i < 8; i++) {
    const file = join(dir, ".env.local");
    if (existsSync(file)) {
      for (const raw of readFileSync(file, "utf8").split(/\r?\n/)) {
        const m = /^\s*([A-Z][A-Z0-9_]*)\s*=\s*(.*)\s*$/.exec(raw);
        if (!m || !wanted.includes(m[1]) || process.env[m[1]]) continue;
        process.env[m[1]] = m[2].replace(/^(['"])(.*)\1$/, "$2");
      }
      return file;
    }
    const up = dirname(dir);
    if (up === dir) break;
    dir = up;
  }
  return null;
}

// ---------------------------------------------------------------- judging a read

export type ReadVerdict = "exact" | "semantic" | "wrong" | "failed" | "unwritable" | "skipped";

/** Spacing, `\left`, braces around one symbol, `\leq`/`\le`: the same LaTeX for a reader. */
export function normalizeTex(latex: string): string {
  let s = cleanLatex(latex)
    .replace(/\\left|\\right/g, "")
    .replace(/\\(?:[,;:! ]|quad|qquad)/g, "")
    .replace(/\\(?:dfrac|tfrac)/g, "\\frac")
    .replace(/\\leq(?![a-zA-Z])/g, "\\le")
    .replace(/\\geq(?![a-zA-Z])/g, "\\ge")
    .replace(/\\operatorname\s*\{\s*([a-z]+)\s*\}/g, "\\$1")
    .replace(/\^\s*\{?\s*\\prime\s*\}?/g, "'")
    .replace(/\s+/g, "");
  for (let i = 0; i < 4; i++) s = s.replace(/\{([^{}\\]|\\[a-zA-Z]+)\}/g, "$1");
  return s;
}

function sameParsed(a: Parsed, b: Parsed): boolean {
  if (a.kind !== b.kind) return false;
  switch (a.kind) {
    case "expr": {
      const c = compareExprs(a, b as typeof a);
      return !c.unknown && c.exact;
    }
    case "indefinite": {
      const o = b as typeof a;
      if (a.variable !== o.variable) return false;
      const c = compareExprs(a.integrand, o.integrand);
      return !c.unknown && c.exact;
    }
    case "relation": {
      const o = b as typeof a;
      if (a.alternatives.length !== o.alternatives.length) return false;
      const flip: Record<string, string> = { "<": ">", ">": "<", "<=": ">=", ">=": "<=", "==": "==", "!=": "!=" };
      return a.alternatives.every((alt, i) => {
        const other = o.alternatives[i];
        if (alt.sides.length !== other.sides.length) return false;
        const eq = (x: (typeof alt.sides)[number], y: (typeof alt.sides)[number]) => {
          const c = compareExprs(x, y);
          return !c.unknown && c.exact;
        };
        const straight = alt.ops.every((op, k) => op === other.ops[k]) && alt.sides.every((s, k) => eq(s, other.sides[k]));
        if (straight) return true;
        const n = alt.sides.length;
        return alt.ops.every((op, k) => flip[op] === other.ops[n - 2 - k]) && alt.sides.every((s, k) => eq(s, other.sides[n - 1 - k]));
      });
    }
    case "question":
      return a.variable === (b as typeof a).variable;
    case "empty-set":
    case "all-reals":
      return true;
    case "unreadable":
      return false;
  }
}

/** Did Mathpix read the line the student wrote? Exactly, the same maths, or something else. */
export function judgeRead(original: string, recognized: string): "exact" | "semantic" | "wrong" {
  if (!recognized.trim()) return "wrong";
  if (normalizeTex(original) === normalizeTex(recognized)) return "exact";
  return sameParsed(parseLine(original), parseLine(recognized)) ? "semantic" : "wrong";
}

// ---------------------------------------------------------------- the run

export interface LineRead {
  original: string;
  unsupported: string[];
  clusters: number;
  recognized: string;
  confidence: number;
  read: ReadVerdict;
  error?: string;
}

export interface HandRun {
  id: string;
  topic: EvalProblem["topic"];
  variant: string;
  lines: LineRead[];
  /** every line read as the same maths (exact or semantic) */
  readOk: boolean;
  /** Solve on what Mathpix read; null when a line could not be written or sent */
  verdict: Verdict | null;
}

interface Task {
  key: string;
  payload: StrokePayload;
}

export interface HandwritingResult {
  runs: HandRun[];
  budget: CallBudget;
}

/** Writes, sends (cached, capped) and judges every problem in every variant. */
export async function runHandwritingEval(engine: LiveEngine, problems: readonly EvalProblem[], opts: { variants?: readonly Variant[]; maxCalls?: number; cacheDir?: string } = {}): Promise<HandwritingResult> {
  const variants = opts.variants ?? VARIANTS;
  const budget: CallBudget = { remaining: opts.maxCalls ?? MAX_CALLS, calls: 0, hits: 0, ...PACING };

  type Prepared = { problem: EvalProblem; variant: Variant; lines: Array<{ original: string; ink: HandInk; lp: LinePayload | null; key: string | null }> };
  const prepared: Prepared[] = [];
  const tasks = new Map<string, Task>();
  // variant-major, so a capped run still covers every problem once before any is repeated
  for (const variant of variants) {
    for (const problem of problems) {
      const lines = problem.lines.map((original) => {
        const ink = handInk(original, variant);
        if (ink.unsupported.length > 0) return { original, ink, lp: null, key: null };
        const lp = payloadFor(ink.strokes);
        const key = lp.payload ? cacheKey(lp.payload) : null;
        if (key && lp.payload && !tasks.has(key)) tasks.set(key, { key, payload: lp.payload });
        return { original, ink, lp, key };
      });
      prepared.push({ problem, variant, lines });
    }
  }

  const taskList = [...tasks.values()];
  const results = await pool(taskList, CONCURRENCY, (t) => recognizeCached(t.payload, budget, opts.cacheDir));
  const byKey = new Map(taskList.map((t, i) => [t.key, results[i]]));

  const runs: HandRun[] = prepared.map(({ problem, variant, lines }) => {
    const reads: LineRead[] = lines.map(({ original, ink, lp, key }) => {
      if (!lp || !key) return { original, unsupported: ink.unsupported, clusters: 0, recognized: "", confidence: 0, read: "unwritable" as const };
      const rec = byKey.get(key);
      if (!rec || !rec.ok) {
        // `api_error` is Mathpix saying it cannot read the ink: a recognition failure. Anything
        // else (the budget, a timeout, a rate limit, credentials) says nothing about the ink.
        const skipped = rec?.reason !== "api_error";
        return { original, unsupported: [], clusters: lp.clusters, recognized: "", confidence: 0, read: skipped ? ("skipped" as const) : ("failed" as const), error: rec ? [rec.reason, rec.detail].filter(Boolean).join(": ") : "no payload" };
      }
      return { original, unsupported: [], clusters: lp.clusters, recognized: rec.latex, confidence: rec.confidence, read: judgeRead(original, rec.latex) };
    });
    const sendable = reads.every((r) => r.read !== "unwritable" && r.read !== "skipped");
    const recognizedLines = reads.map((r) => r.recognized);
    return {
      id: problem.id,
      topic: problem.topic,
      variant: variant.name,
      lines: reads,
      readOk: reads.every((r) => r.read === "exact" || r.read === "semantic"),
      verdict: sendable ? solveAndJudge(engine, problem, recognizedLines) : null,
    };
  });
  return { runs, budget };
}
