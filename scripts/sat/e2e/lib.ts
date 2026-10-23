/**
 * SAT v2 end-to-end harness, the shared pieces (scripts/sat/e2e/run.ts): a student's hand (the repo's
 * hand engine, src/lib/hand, as the iPad's StudentHand writes it), the recognize payload the iPad
 * sends (brain `clusterStrokes` + `buildPayload`), a thin-pencil crop for the second reader, the
 * local stack's accounts, the live routes with `sat_question_id`, and the iPad loop's judging
 * (LiveLoop+Render `analyze(column:)`, ported in its main rules) so the harness ticks and rings the way
 * the iPad would.
 *
 * REAL services: Mathpix and OpenRouter through a local `next dev`. Never against production.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import * as brain from "@/lib/brain";
import { layoutMath, mulberry32 } from "@/lib/hand";
import type { InkLine, InkStroke, LineAnalysis, StrokePayload } from "@/lib/live/contracts";
import { clusterLines, unionRects } from "@/lib/live/strokeClusters";
import { buildPayload } from "@/lib/live/strokePayload";
import { rereadTrigger } from "@/lib/live/readCheck";

export const ROOT = process.cwd();

// ---------------------------------------------------------------- env (never printed)

export function loadEnv(): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of readFileSync(path.join(ROOT, ".env.local"), "utf8").split("\n")) {
    const m = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
    if (m) out[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
  return out;
}

export const ENV = loadEnv();
export const BASE = process.env.E2E_BASE ?? "http://localhost:3217";
export const SUPABASE_URL = ENV.NEXT_PUBLIC_SUPABASE_URL;
if (!/^http:\/\/(127\.0\.0\.1|localhost)/.test(SUPABASE_URL)) throw new Error("the harness runs against the LOCAL Supabase only");
if (!/^http:\/\/(127\.0\.0\.1|localhost)/.test(BASE)) throw new Error("the harness runs against a LOCAL server only");

// ---------------------------------------------------------------- OpenRouter balance

export async function openRouterBalance(): Promise<number> {
  const res = await fetch("https://openrouter.ai/api/v1/credits", { headers: { Authorization: `Bearer ${ENV.OPENROUTER_API_KEY}` } });
  const j = (await res.json()) as { data: { total_credits: number; total_usage: number } };
  return j.data.total_credits - j.data.total_usage;
}

// ---------------------------------------------------------------- accounts (local stack)

export interface Account {
  email: string;
  userId: string;
  token: string;
}

export async function makeFreeAccount(tag: string): Promise<Account> {
  const email = `sat-e2e-${tag}-${Date.now()}@example.com`;
  const password = `e2e-${Math.random().toString(36).slice(2)}-Pw1`;
  const key = ENV.SUPABASE_SERVICE_ROLE_KEY;
  const made = await fetch(`${SUPABASE_URL}/auth/v1/admin/users`, {
    method: "POST",
    headers: { apikey: key, Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({ email, password, email_confirm: true, user_metadata: { terms_version: "2026-10-11" } }),
  });
  if (!made.ok) throw new Error(`create user ${made.status}: ${(await made.text()).slice(0, 200)}`);
  const signed = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: { apikey: ENV.NEXT_PUBLIC_SUPABASE_ANON_KEY, "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  const s = (await signed.json()) as { access_token: string; user: { id: string } };
  if (!s.access_token) throw new Error("sign in failed");
  return { email, userId: s.user.id, token: s.access_token };
}

// ---------------------------------------------------------------- HTTP

export interface Http {
  status: number;
  ms: number;
  json: unknown;
  text: string;
}

export async function call(acct: Account, method: "GET" | "POST", route: string, body?: unknown): Promise<Http> {
  const t0 = Date.now();
  const res = await fetch(`${BASE}${route}`, {
    method,
    headers: { Authorization: `Bearer ${acct.token}`, "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let json: unknown = null;
  try {
    json = JSON.parse(text);
  } catch {
    json = null;
  }
  return { status: res.status, ms: Date.now() - t0, json, text };
}

export interface SseEvent {
  event: string;
  data: any;
  at: number;
}

/** A Live SSE route (check / solve): every event, with its time from the request. */
export async function sse(acct: Account, route: string, body: unknown): Promise<{ status: number; events: SseEvent[]; json?: unknown; ms: number }> {
  const t0 = Date.now();
  const res = await fetch(`${BASE}${route}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${acct.token}`, "Content-Type": "application/json", Accept: "text/event-stream" },
    body: JSON.stringify(body),
  });
  if (!res.headers.get("content-type")?.includes("text/event-stream")) {
    const text = await res.text();
    let json: unknown = null;
    try {
      json = JSON.parse(text);
    } catch {
      json = text;
    }
    return { status: res.status, events: [], json, ms: Date.now() - t0 };
  }
  const events: SseEvent[] = [];
  const reader = res.body!.getReader();
  const dec = new TextDecoder();
  let buf = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let i: number;
    while ((i = buf.indexOf("\n\n")) >= 0) {
      const frame = buf.slice(0, i);
      buf = buf.slice(i + 2);
      let event = "message";
      let data = "";
      for (const l of frame.split("\n")) {
        if (l.startsWith("event:")) event = l.slice(6).trim();
        else if (l.startsWith("data:")) data += l.slice(5).trim();
      }
      if (!data) continue;
      try {
        events.push({ event, data: JSON.parse(data), at: Date.now() - t0 });
      } catch {
        events.push({ event, data, at: Date.now() - t0 });
      }
    }
  }
  return { status: res.status, events, ms: Date.now() - t0 };
}

// ---------------------------------------------------------------- the student's hand

/** The iPad's StudentHand `.clean` (layoutMath size 44, scale 1.6) placed by SATAutowriter (×0.85). */
export const HAND = { size: 44, scale: 1.6 * 0.85 } as const;

export interface Hand {
  name: string;
  seed: number;
  slant: number;
  jitter: number;
}
export const CLEAN: Hand = { name: "clean", seed: 1, slant: 0, jitter: 0 };
export const SLANTED: Hand = { name: "slanted", seed: 7, slant: 0.14, jitter: 0.035 };

/** A student's line in page coordinates, its top-left at (x, y): the hand engine's strokes. */
export function writeLine(latex: string, at: { x: number; y: number }, hand: Hand, idBase: string): InkStroke[] {
  const layout = layoutMath(latex, { size: HAND.size, seed: hand.seed });
  if (layout.unsupported.length > 0 || layout.strokes.length === 0) throw new Error(`the hand cannot write ${latex}: ${layout.unsupported.join(", ")}`);
  const rand = mulberry32(hand.seed * 7919 + latex.length);
  return layout.strokes.map((st, i) => {
    const dx = (rand() - 0.5) * 2 * hand.jitter * HAND.size;
    const dy = (rand() - 0.5) * 2 * hand.jitter * HAND.size;
    const pts = st.points.map((p) => ({
      x: at.x + (p.x + hand.slant * (layout.baseline - p.y) + dx) * HAND.scale,
      y: at.y + (p.y + dy) * HAND.scale,
    }));
    const xs = pts.map((p) => p.x);
    const ys = pts.map((p) => p.y);
    return {
      id: `shape:${idBase}_${i}` as InkStroke["id"],
      bounds: { x: Math.min(...xs), y: Math.min(...ys), w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys) },
      segments: [pts],
    };
  });
}

export function lineOf(strokes: InkStroke[], id: string): { line: InkLine; clusters: number } {
  const clusters = clusterLines(strokes).length;
  const line: InkLine = { id, strokeIds: strokes.map((s) => s.id), bounds: unionRects(strokes.map((s) => s.bounds)), column: 0, row: 0, hash: "" };
  return { line, clusters };
}

export function payloadOf(strokes: InkStroke[], id: string): { payload: StrokePayload; line: InkLine; clusters: number } {
  const { line, clusters } = lineOf(strokes, id);
  const payload = buildPayload(line, strokes);
  if (!payload) throw new Error("no payload");
  return { payload, line, clusters };
}

/** The line's crop as the iPad's InkCrop makes it: bounds + 8, ~512 px wide (≤ 2×), JPEG 0.8, a THIN pencil (2.9). */
export async function cropOf(strokes: InkStroke[]): Promise<string> {
  const sharp = (await import("sharp")).default;
  const b = unionRects(strokes.map((s) => s.bounds));
  const pad = 8;
  const vb = { x: b.x - pad, y: b.y - pad, w: b.w + 2 * pad, h: b.h + 2 * pad };
  const scale = Math.min(2, 512 / vb.w);
  const W = Math.round(vb.w * scale);
  const H = Math.round(vb.h * scale);
  const paths = strokes
    .map((s) => s.segments.map((seg) => `<path d="${seg.map((p, i) => `${i ? "L" : "M"}${(p.x - vb.x).toFixed(2)} ${(p.y - vb.y).toFixed(2)}`).join(" ")}"/>`).join(""))
    .join("");
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${vb.w} ${vb.h}"><rect width="100%" height="100%" fill="#fff"/><g fill="none" stroke="#1b1b1f" stroke-width="2.9" stroke-linecap="round" stroke-linejoin="round">${paths}</g></svg>`;
  const jpg = await sharp(Buffer.from(svg)).jpeg({ quality: 80 }).toBuffer();
  return `data:image/jpeg;base64,${jpg.toString("base64")}`;
}

// ---------------------------------------------------------------- the page's head (SATStemMath.problemLines)

export function stemMaths(stem: string): string[] {
  const out: string[] = [];
  const re = /\$\$([\s\S]+?)\$\$|\$([^$]+?)\$/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(stem))) out.push((m[1] ?? m[2]).trim());
  return out;
}

export function problemLines(stem: string): string[] {
  const out: string[] = [];
  for (const t of stemMaths(stem)) {
    const relation = /=|<|>|\\le|\\ge|\\lt|\\gt/.test(t);
    const letters = /[a-zA-Z]/.test(t.replace(/\\[a-zA-Z]+/g, ""));
    if (!relation || !letters || t.includes("\\text") || /^[a-zA-Z]\s*=\s*-?\s*[0-9.]+$/.test(t) || out.includes(t)) continue;
    out.push(t);
    if (out.length === 3) break;
  }
  return out;
}

// ---------------------------------------------------------------- the iPad loop's judging, ported

brain.init();

export interface Judged {
  latex: string;
  analysis: LineAnalysis;
  /** what the iPad would draw: tick, ring, or nothing (quiet / not judged) */
  mark: "tick" | "ring" | "none";
  /** unfinished (incomplete, ends with =): the iPad holds it, never judged */
  unfinished: boolean;
  /** the iPad would ask /api/live/check about it (verdict unknown, a kind the check takes) */
  wantsCheck: boolean;
}

const NOT_STEPS = ["label", "incomplete", "unknown", "operation", "continuation"];
/** the iPad's SAT session turns `LiveLoop.checksUnjudgedLines` on (feat/sat2-e2e); E2E_OLD_POLICY=1 runs the loop as before it */
export const SAT_CHECKS_UNJUDGED = process.env.E2E_OLD_POLICY !== "1";

/** LiveLoop+Render `analyze(column:)`: each line against the last right line, the first relation, the problem, the lines above and a slip above. */
export function judgeColumn(head: string[], latexes: string[], confidences: number[]): Judged[] {
  let previous: LineAnalysis | undefined;
  let original: LineAnalysis | undefined;
  const take = (a: LineAnalysis | null | undefined) => {
    if (!a || NOT_STEPS.includes(a.kind)) return;
    previous = a;
    if (!original && (a.kind === "equation" || a.kind === "inequality")) original = a;
  };
  if (head.length) brain.analyzeColumnOf({ lines: head, mode: "suggest" }).forEach(take);
  const problem = head.length ? head : latexes.slice(0, 1);
  const above: string[] = [];
  let slip: LineAnalysis | undefined;
  const out: Judged[] = [];
  latexes.forEach((latex, i) => {
    let a = brain.judgeLineOf({ latex, context: { mode: "suggest", previous, original }, problem, above, slip });
    // ArithmeticTruth: a true relation of plain numbers is never ringed
    if (a.verdict === "mismatch" && !/[a-zA-Z]/.test(latex.replace(/\\[a-zA-Z]+/g, ""))) {
      const t = brain.analyzeLine({ latex, context: { mode: "answer" } });
      if (t.verdict === "ok") a = { ...a, verdict: "none", carried: undefined };
    }
    above.push(latex);
    if (!NOT_STEPS.includes(a.kind)) slip = a.verdict === "mismatch" || a.carried ? a : undefined;
    if (!(a.verdict === "mismatch" || a.carried)) take(a);
    const unfinished = a.kind === "incomplete" || /=\s*$/.test(latex);
    const echo = !["label", "incomplete", "text", "continuation"].includes(a.kind) && (confidences[i] ?? 1) >= 0.6;
    const badge = a.solved ? "solved" : a.verdict === "ok" ? "ok" : a.verdict === "mismatch" ? "warn" : "none";
    const mark = unfinished || !echo ? "none" : badge === "ok" || badge === "solved" ? "tick" : badge === "warn" ? "ring" : "none";
    // LivePolicy.decide: a line the engine cannot read goes to the model; on an SAT page (`checksUnjudged`,
    // set by SATSessionModel) a line it leaves unjudged does too
    const checkable = ["equation", "expression", "inequality", "assignment"];
    const wantsCheck = !unfinished && echo && ((a.verdict === "unknown" && checkable.includes(a.kind))
      || (SAT_CHECKS_UNJUDGED && a.verdict === "none" && !a.carried && !a.solved && [...checkable, "function"].includes(a.kind)));
    out.push({ latex, analysis: a, mark, unfinished, wantsCheck });
  });
  return out;
}

/** Help me's local next step (LiveLoop.escalate → writeNextStep → writeLocal): the engine's, or null. */
export function localNextStep(head: string[], latexes: string[], judged: Judged[]): { step: string; source: string } | null {
  const last = judged[judged.length - 1];
  if (last?.analysis.nextStep) return { step: `= ${last.analysis.nextStep}`, source: "engine nextStep" };
  const local = brain.localSolveOf({ lines: [...head, ...latexes], targetIndex: head.length + latexes.length - 1, handwriting: true });
  if (local.source && local.steps.length) return { step: local.steps[0], source: `engine ${local.source}` };
  return null;
}

export function engineReads(latex: string): boolean {
  try {
    const a = brain.analyzeLine({ latex, context: { mode: "suggest" } });
    return a.kind !== "unknown";
  } catch {
    return false;
  }
}

export function rereadWanted(latex: string, confidence: number, strokeCount: number, others: string[]): string | null {
  let analysis: LineAnalysis | null = null;
  try {
    analysis = brain.analyzeLine({ latex, context: { mode: "suggest" } });
  } catch {
    analysis = null;
  }
  return rereadTrigger({ latex, confidence, analysis, strokeCount, others });
}

export const engine = brain;
