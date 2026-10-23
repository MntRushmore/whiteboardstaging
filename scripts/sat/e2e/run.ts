/**
 * SAT v2 end to end, server level, with the REAL models and the REAL Mathpix (docs/SAT-V2.md): for each
 * question of plan.ts, a student's hand writes lines on the question's page and the live routes are
 * called as the iPad calls them, `sat_question_id` (and `sat_figure_marks`) on every body.
 *
 *   1 reading   L1 in a clean and a slanted hand → /api/live/recognize (→ /reread when the iPad would)
 *   2 checking  [L1, L2] never ringed; [L1, S] S ringed; [L1, U] U not judged — the iPad loop's own
 *               judging (lib.ts judgeColumn) plus /api/live/check when the iPad would ask it
 *   3 Help me   rung 2 after L1: the engine's step, else /api/live/solve (as LiveLoop.startSolve)
 *   4 context   the model's system prompt (the dev server's fetch log) holds the bank question and marks
 *   5 cap       (cap.ts) the third question's live call is a 402 sat_tutor
 *   6 leaks     no nudge holds its answer; no non-SAT route is called (B)
 *
 * Run (a local `next dev` started with scripts/sat/e2e/fetch-log.cjs, see README in the report):
 *   E2E_FETCH_LOG=/path/fetch.jsonl node scripts/sat/e2e/bundle.mjs scripts/sat/e2e/run.ts [--only id,id] [--out file]
 */
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { create, all } from "mathjs";
import { PLAN, MARKS_PROBE, type Num, type QuestionPlan } from "./plan";
import {
  CLEAN, SLANTED, call, cropOf, engine, engineReads, judgeColumn, localNextStep, makeFreeAccount, openRouterBalance,
  payloadOf, problemLines, rereadWanted, sse, writeLine, type Account, type Hand, type Judged,
} from "./lib";
import type { InkStroke, LineAnalysis } from "@/lib/live/contracts";
import { acceptChainReread } from "@/lib/live/readCheck";

const math = create(all, {});
const args = process.argv.slice(2);
const only = args.includes("--only") ? args[args.indexOf("--only") + 1].split(",") : null;
const outFile = args.includes("--out") ? args[args.indexOf("--out") + 1] : "docs/sat2/e2e/harness-results.json";
const FETCH_LOG = process.env.E2E_FETCH_LOG ?? "";
const START_BALANCE_FLOOR = 15.4;

// ---------------------------------------------------------------- numbers over the engine

function toMath(latex: string): string {
  const a = engine.analyzeLine({ latex, context: { mode: "suggest" } });
  return a.math || "";
}
function sidesOf(latex: string, scope: Record<string, number>): number[] | null {
  const src = toMath(latex.replace(/^\s*=/, "0+0="));
  if (!src) return null;
  const parts = src.split(/==|<=|>=|(?<![<>!=])=(?!=)|<|>/).map((p) => p.trim()).filter(Boolean);
  try {
    const out = parts.map((p) => {
      const val = math.evaluate(p, { ...scope });
      const n = typeof val === "number" ? val : typeof val?.toNumber === "function" ? val.toNumber() : Number(val);
      if (!Number.isFinite(n)) throw new Error("nan");
      return n;
    });
    // an `=`-first line: its first side is the 0+0 we put there
    return latex.trim().startsWith("=") ? out.slice(1) : out;
  } catch {
    return null;
  }
}
const num: Num = {
  sides: sidesOf,
  holds(latex, scope) {
    const s = sidesOf(latex, scope);
    return s !== null && s.length >= 2 && s.every((x) => Math.abs(x - s[0]) < 1e-6 * Math.max(1, Math.abs(s[0])));
  },
  last(latex, scope = {}) {
    const s = sidesOf(latex, scope);
    return s && s.length ? Math.round(s[s.length - 1] * 1e9) / 1e9 : null;
  },
  flat: (l) => l.replace(/\\left|\\right|\\,|\\cdot|\\times|\s|[{}]/g, (m) => (m === "\\cdot" || m === "\\times" ? "*" : "")).replace(/\\dfrac/g, "\\frac"),
};

/** The reads are the same maths: the same text, else every side equal at random values. */
function sameMaths(a: string, b: string): boolean {
  if (num.flat(a) === num.flat(b)) return true;
  const letters = [...new Set((toMath(a) + " " + toMath(b)).match(/\b[a-zA-Z]\b/g) ?? [])];
  for (let k = 0; k < 3; k++) {
    const scope = Object.fromEntries(letters.map((l, i) => [l, 1.37 + k * 0.91 + i * 0.53]));
    const sa = sidesOf(a, scope);
    const sb = sidesOf(b, scope);
    if (!sa || !sb || sa.length !== sb.length) return false;
    if (!sa.every((x, i) => Math.abs(x - sb[i]) < 1e-6 * Math.max(1, Math.abs(x)))) return false;
  }
  return true;
}

// ---------------------------------------------------------------- spend and the fetch log

let orCalls = 0;
let mpxCalls = 0;
let lastBalanceAt = 0;
let startBalance = 0;
function fetchLogSince(at: number): any[] {
  if (!FETCH_LOG || !existsSync(FETCH_LOG)) return [];
  return readFileSync(FETCH_LOG, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l)).filter((e) => e.at >= at);
}
async function tally(since: number) {
  const entries = fetchLogSince(since);
  orCalls += entries.filter((e) => e.service === "openrouter").length;
  mpxCalls += entries.filter((e) => e.service === "mathpix").length;
  if (orCalls - lastBalanceAt >= 40) {
    lastBalanceAt = orCalls;
    const b = await openRouterBalance();
    console.log(`  [balance] $${b.toFixed(3)} after ${orCalls} OpenRouter calls (spent $${(startBalance - b).toFixed(3)})`);
    if (b < START_BALANCE_FLOOR) throw new Error(`balance ${b.toFixed(2)} near the $15 floor: stopping`);
  }
  return entries;
}

// ---------------------------------------------------------------- one line on the page

interface Read {
  latex: string;
  confidence: number;
  provider: string;
  ms: number;
  status: number;
  reread?: { trigger: string; latex: string; status: number; ms: number; satBlock: boolean };
  error?: unknown;
  strokes: InkStroke[];
  bounds: { x: number; y: number; w: number; h: number };
  id: string;
  clusters: number;
  satBlockInVision?: boolean;
  /** Mathpix's (or the second reader's) read before the loop's own fixes */
  mathpix?: string;
  chain?: boolean;
}

const BOARD = `sat-e2e-${Date.now().toString(36)}`;
let lineSeq = 0;

const brainStrokes = (strokes: InkStroke[]) => strokes.map((s) => ({ id: String(s.id), x: s.segments.flat().map((p) => p.x), y: s.segments.flat().map((p) => p.y) }));

/** Would `latex` follow from the line above (LiveLoop.follows), else from the problem's last line (stepFollows). */
function stepFollows(latex: string, above: string | null, head: string[]): boolean {
  if (above !== null) {
    if (!/[a-zA-Z]/.test(latex.replace(/\\[a-zA-Z]+/g, "")) && engine.analyzeLine({ latex, context: { mode: "answer" } }).verdict === "ok") return true;
    const previous = engine.analyzeLine({ latex: above, context: { mode: "suggest" } });
    const a = engine.judgeLineOf({ latex, context: { mode: "suggest", previous }, problem: head.length ? head : [above], above: [above] });
    return a.verdict === "ok" || a.solved === true;
  }
  const last = head[head.length - 1];
  if (!last) return false;
  const previous = engine.analyzeLine({ latex: last, context: { mode: "suggest" } });
  const a = engine.judgeLineOf({ latex, context: { mode: "suggest", previous, original: previous }, problem: head, above: [] });
  return a.verdict === "ok" || a.solved === true;
}

async function readLine(acct: Account, qid: string, latex: string, at: { x: number; y: number }, hand: Hand, others: string[], marks?: string, head: string[] = [], above: string | null = null): Promise<Read> {
  const id = `ln_${(++lineSeq).toString(36).padStart(6, "0")}`;
  const strokes = writeLine(latex, at, hand, id);
  const { payload, line, clusters } = payloadOf(strokes, id);
  const tag: Record<string, string> = { sat_question_id: qid };
  if (marks) tag.sat_figure_marks = marks;
  const t0 = Date.now();
  const r = await call(acct, "POST", "/api/live/recognize", { boardId: BOARD, lineId: id, strokes: { x: payload.x, y: payload.y }, bounds: { w: payload.w, h: payload.h }, ...tag });
  const j = r.json as any;
  const read: Read = { latex: j?.latex ?? "", confidence: j?.confidence ?? 0, provider: j?.provider ?? "-", ms: r.ms, status: r.status, strokes, bounds: line.bounds, id, clusters };
  if (r.status !== 200) read.error = j;
  const log = await tally(t0);
  read.satBlockInVision = log.some((e) => e.service === "openrouter" && JSON.stringify(e.messages ?? "").includes("SAT PRACTICE PAGE"));
  if (r.status === 200 && read.latex) {
    const trig = rereadWanted(read.latex, read.confidence, strokes.length, others);
    if (trig) {
      const t1 = Date.now();
      const crop = await cropOf(strokes);
      const rr = await call(acct, "POST", "/api/live/reread", { boardId: BOARD, lineId: id, crop, latex: read.latex, above: others, below: [], ...tag });
      const rlog = await tally(t1);
      const rj = rr.json as any;
      read.reread = { trigger: trig, latex: rj?.latex ?? "", status: rr.status, ms: rr.ms, satBlock: rlog.some((e) => JSON.stringify(e.messages ?? "").includes("SAT PRACTICE PAGE")) };
      // the iPad takes the second read when it changed and the engine reads it (acceptReread, simplified)
      if (rr.status === 200 && rj?.latex && rj.latex !== read.latex && engineReads(rj.latex)) read.latex = rj.latex;
    }
  }
  // applyRecognition: a young hand's read put right, then what a messy read may have been as the ink shows it
  if (read.latex) {
    read.mathpix = read.latex;
    const ink = brainStrokes(strokes);
    read.latex = engine.youngReadOf({ latex: read.latex, problem: head, strokes: ink, bar: false }).latex;
    if (above !== null || head.length) {
      const keep = [...(above !== null ? [above] : []), ...head];
      const variants = engine.readVariantsOf({ latex: read.latex, strokes: ink, keep }).variants;
      if (variants.length && !stepFollows(read.latex, above, head)) {
        const v = variants.find((x) => stepFollows(x, above, head));
        if (v) read.latex = v;
      }
    }
  }
  return read;
}

// ---------------------------------------------------------------- the check and the solve, as the iPad sends them

function checkBody(head: string[], reads: Read[], judged: Judged[], focus: string, qid: string, marks?: string) {
  const headRect = { x: 140, y: 80, w: 680, h: 120 };
  const rects = [headRect, ...reads.map((r) => r.bounds)];
  const x0 = Math.min(...rects.map((r) => r.x)) - 24;
  const y0 = Math.min(...rects.map((r) => r.y)) - 24;
  const x1 = Math.max(...rects.map((r) => r.x + r.w)) + 24;
  const y1 = Math.max(...rects.map((r) => r.y + r.h)) + 24;
  const region = { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
  const norm = (r: { x: number; y: number; w: number; h: number }): [number, number, number, number] => [(r.x - x0) / region.w, (r.y - y0) / region.h, (r.x + r.w - x0) / region.w, (r.y + r.h - y0) / region.h];
  const heads = head.length ? engine.analyzeColumnOf({ lines: head, mode: "suggest" }) : [];
  const lines = [
    ...head.slice(0, 3).map((l, i) => ({ id: `chat-problem-sat-${i}`, latex: l, bbox: norm(headRect), local: { kind: heads[i]?.kind ?? "unknown", verdict: heads[i]?.verdict ?? "none" } })),
    ...reads.map((r, i) => ({
      id: r.id, latex: r.latex, bbox: norm(r.bounds),
      local: { kind: judged[i].analysis.kind, verdict: judged[i].analysis.verdict, ...(judged[i].analysis.resultLatex ? { resultLatex: judged[i].analysis.resultLatex.slice(0, 500) } : {}), ...(judged[i].analysis.note ? { note: judged[i].analysis.note.slice(0, 200) } : {}) },
    })),
  ];
  const tag: Record<string, string> = { sat_question_id: qid };
  if (marks) tag.sat_figure_marks = marks;
  return { region, lines, focus, tag };
}

interface Column {
  latexes: string[];
  judged: Judged[];
  check?: { status: number; ms: number; ttfa: number | null; annotations: any[]; satBlock: boolean; marksInPrompt: boolean };
  marks: ("tick" | "ring" | "none")[];
}

const chainEngine = { analyzeLine: (latex: string, ctx: any) => engine.analyzeLine({ latex, context: ctx }) } as any;
const numbersIn = (l: string) => l.match(/\d+(?:\.\d+)?/g) ?? [];

/** LiveLoop.holdRing / checkChain: before a ring, the step and the line above (Mathpix reads not yet re-read) are read again; a near transcription that makes the step follow takes the ring back. */
async function secondLookBeforeRing(acct: Account, plan: QuestionPlan, head: string[], reads: Read[], i: number, marks?: string): Promise<{ reads: Read[]; looked: string[] }> {
  const looked: string[] = [];
  if (i === 0) return { reads, looked };
  const due = [i - 1, i].filter((k) => !reads[k].reread && !reads[k].chain);
  if (!due.length) return { reads, looked };
  const next = reads.map((r) => ({ ...r }));
  const tag: Record<string, string> = { sat_question_id: plan.id };
  if (marks) tag.sat_figure_marks = marks;
  for (const k of due) {
    const s = next[k];
    const crop = await cropOf(s.strokes);
    const body = { boardId: BOARD, lineId: s.id, crop, latex: s.latex, above: [], below: [], ...tag };
    const t0 = Date.now();
    const first = await call(acct, "POST", "/api/live/reread", body);
    let latex: string | null = (first.json as any)?.latex ?? null;
    let agreed = true;
    if (s.confidence >= 0.95 && latex && latex !== s.latex) {
      const second = await call(acct, "POST", "/api/live/reread", body);
      agreed = (second.json as any)?.latex === latex;
    }
    await tally(t0);
    s.chain = true;
    looked.push(`${s.latex} → ${latex ?? "(none)"}${agreed ? "" : " (2nd look disagreed)"}`);
    if (!latex || !agreed) continue;
    const others = next.filter((_, j) => j !== k).map((r) => r.latex);
    const c = acceptChainReread(chainEngine, s.latex, latex, others);
    if (!c) continue;
    const known = [...head.flatMap(numbersIn), ...(k === i ? numbersIn(next[i - 1].latex).filter((n) => n.replace(".", "").length >= 2) : [])];
    const before = numbersIn(s.latex);
    const after = numbersIn(c);
    if (known.some((n) => before.includes(n) && !after.includes(n))) continue;
    s.latex = c;
  }
  // the fewest reads that make the step follow are taken (chainFix): here, all of them or none
  if (stepFollows(next[i].latex, next[i - 1].latex, head)) return { reads: next, looked };
  return { reads: reads.map((r, j) => ({ ...r, chain: due.includes(j) ? true : r.chain })), looked };
}

async function runColumn(acct: Account, plan: QuestionPlan, head: string[], reads0: Read[], marks?: string): Promise<Column & { looked?: string[] }> {
  let reads = reads0;
  let judged = judgeColumn(head, reads.map((r) => r.latex), reads.map((r) => r.confidence));
  const lookedAll: string[] = [];
  for (let i = 0; i < judged.length; i++) {
    if (judged[i].mark !== "ring") continue;
    const r = await secondLookBeforeRing(acct, plan, head, reads, i, marks);
    lookedAll.push(...r.looked);
    reads = r.reads;
    judged = judgeColumn(head, reads.map((x) => x.latex), reads.map((x) => x.confidence));
  }
  const latexes = reads.map((r) => r.latex);
  const out: Column & { looked?: string[] } = { latexes, judged, marks: judged.map((j) => j.mark), looked: lookedAll.length ? lookedAll : undefined };
  const asks = judged.map((j, i) => (j.wantsCheck ? i : -1)).filter((i) => i >= 0);
  if (asks.length) {
    const focusIdx = asks[asks.length - 1];
    const b = checkBody(head, reads, judged, reads[focusIdx].id, plan.id, marks);
    const t0 = Date.now();
    const res = await sse(acct, "/api/live/check", { boardId: BOARD, mode: "suggest", region: b.region, lines: b.lines, focusLineId: b.focus, userAsked: false, ...b.tag });
    const log = await tally(t0);
    const annotations = res.events.filter((e) => e.event === "annotation").map((e) => e.data);
    const first = res.events.find((e) => e.event === "annotation");
    const prompt = JSON.stringify(log.filter((e) => e.service === "openrouter").map((e) => e.messages));
    out.check = { status: res.status, ms: res.ms, ttfa: first?.at ?? null, annotations, satBlock: prompt.includes("SAT PRACTICE PAGE") && prompt.includes(plan.id), marksInPrompt: Boolean(marks && prompt.includes(marks)) };
    // LiveLoop.applyAnnotation: a warn rings its line unless the engine says ok, its `expected` is what
    // the line says, it is praise or notation, or the line is unfinished (held) / the warn says only that
    for (const a of annotations) {
      const i = reads.findIndex((r) => r.id === a.lineId);
      if (i < 0 || a.verdict !== "warn" || judged[i].analysis.verdict === "ok") continue;
      if (a.expected && engine.verifyExpected({ expected: a.expected, latex: reads[i].latex }) === "equal") continue;
      if (a.kind === "praise" || a.kind === "notation" || a.kind === "incomplete" || judged[i].unfinished) continue;
      out.marks[i] = "ring";
    }
  }
  return out;
}

interface Help {
  source: string;
  step: string | null;
  ms: number;
  status?: number;
  satBlock?: boolean;
  marksInPrompt?: boolean;
  modelSteps?: string[];
  error?: unknown;
}

/** Help me rung 2 after the student's lines: LiveLoop.escalate → writeNextStep / writeLocal → solveWithModel. */
async function helpOneStep(acct: Account, plan: QuestionPlan, head: string[], reads: Read[], marks?: string): Promise<Help> {
  const t0 = Date.now();
  const latexes = reads.map((r) => r.latex);
  const judged = judgeColumn(head, latexes, reads.map((r) => r.confidence));
  const local = localNextStep(head, latexes, judged);
  if (local) return { source: local.source, step: local.step, ms: Date.now() - t0 };
  const b = checkBody(head, reads, judged, reads[reads.length - 1].id, plan.id, marks);
  const res = await sse(acct, "/api/live/solve", { boardId: BOARD, region: b.region, lines: b.lines, fromLineId: reads[reads.length - 1].id, ...b.tag });
  const log = await tally(t0);
  const prompt = JSON.stringify(log.filter((e) => e.service === "openrouter").map((e) => e.messages));
  const steps = res.events.filter((e) => e.event === "step").map((e) => String(e.data.latex ?? ""));
  const given = new Set(b.lines.map((l) => num.flat(l.latex)));
  // the first step the engine reads that is not one of the given lines (the iPad's onlyFirstStep)
  const firstIdx = steps.findIndex((s) => s && !given.has(num.flat(s.replace(/\\boxed\{(.*)\}/, "$1"))) && engineReads(s.replace(/\\boxed\{(.*)\}/, "$1")));
  let first = firstIdx >= 0 ? steps[firstIdx].replace(/\\boxed\{(.*)\}/, "$1") : null;
  // LiveLoop.solveWithModel: a step after a finished relation is written alone (no leading `=`)
  const lastLine = reads[reads.length - 1].latex;
  if (first && /^\s*=/.test(first) && /=|<|>/.test(lastLine) && !/=\s*$/.test(lastLine)) first = first.replace(/^\s*=+\s*/, "");
  const stepAt = firstIdx >= 0 ? res.events.filter((e) => e.event === "step")[firstIdx].at : null;
  return {
    source: "model /api/live/solve", step: first, ms: stepAt ?? res.ms, status: res.status, modelSteps: steps,
    satBlock: prompt.includes("SAT PRACTICE PAGE") && prompt.includes(plan.id), marksInPrompt: Boolean(marks && prompt.includes(marks)),
    error: res.status !== 200 ? res.json : res.events.find((e) => e.event === "error")?.data,
  };
}

// ---------------------------------------------------------------- the run

async function main() {
  startBalance = await openRouterBalance();
  console.log(`OpenRouter balance at start: $${startBalance.toFixed(3)}`);
  if (startBalance < START_BALANCE_FLOOR + 0.5) throw new Error("balance too low to start");
  const acct = await makeFreeAccount("main");
  console.log(`account ${acct.email}`);
  const bank = new Map<string, any>();
  {
    const ids = PLAN.map((p) => p.id);
    const r = await fetch(`${process.env.SUPABASE_REST ?? ""}`).catch(() => null);
    void r;
    // the bank rows as the student reads them (RLS: live only)
    const { SUPABASE_URL, ENV } = await import("./lib");
    const q = await fetch(`${SUPABASE_URL}/rest/v1/sat_questions?select=*&id=in.(${ids.join(",")})`, { headers: { apikey: ENV.NEXT_PUBLIC_SUPABASE_ANON_KEY, Authorization: `Bearer ${acct.token}` } });
    for (const row of (await q.json()) as any[]) bank.set(row.id, row);
  }
  const results: any[] = [];
  for (const plan of PLAN) {
    if (only && !only.includes(plan.id)) continue;
    const q = bank.get(plan.id);
    if (!q) {
      results.push({ id: plan.id, error: "not live" });
      continue;
    }
    console.log(`\n=== ${plan.id} (${plan.kind})`);
    const head = problemLines(q.stem);
    const res: any = { id: plan.id, kind: plan.kind, head };
    // the first ink claims the pass
    const pass = await call(acct, "POST", "/api/sat/tutor", { question_id: plan.id, tz: "America/New_York" });
    res.pass = pass.json;
    if (!(pass.json as any)?.allowed) {
      console.log("  no pass:", pass.json);
      results.push(res);
      continue;
    }
    const X = 140;
    const Y = 620;
    // 1. reading: L1 in two hands
    const l1 = await readLine(acct, plan.id, plan.L1, { x: X, y: Y }, CLEAN, [], plan.marks, head, null);
    const l1s = await readLine(acct, plan.id, plan.L1, { x: X, y: Y }, SLANTED, [], plan.marks, head, null);
    res.reading = {
      clean: { latex: l1.latex, conf: l1.confidence, ms: l1.ms, status: l1.status, reread: l1.reread, clusters: l1.clusters, same: sameMaths(l1.latex, plan.L1) },
      slanted: { latex: l1s.latex, conf: l1s.confidence, ms: l1s.ms, status: l1s.status, reread: l1s.reread, clusters: l1s.clusters, same: sameMaths(l1s.latex, plan.L1) },
    };
    console.log(`  read L1 clean  ${l1.status} ${l1.ms}ms "${l1.latex}" (${l1.confidence.toFixed(2)})${l1.reread ? ` reread[${l1.reread.trigger}] "${l1.reread.latex}"` : ""} same=${res.reading.clean.same}`);
    console.log(`  read L1 slant  ${l1s.status} ${l1s.ms}ms "${l1s.latex}" (${l1s.confidence.toFixed(2)})${l1s.reread ? ` reread[${l1s.reread.trigger}] "${l1s.reread.latex}"` : ""} same=${res.reading.slanted.same}`);
    // 3. Help me rung 2 after L1 (before L2 is written, as a student would ask)
    const help = await helpOneStep(acct, plan, head, [l1], plan.marks);
    res.help = { ...help, verdict: help.step ? plan.next(help.step, num) : null };
    console.log(`  help  ${help.source} ${help.ms}ms → ${help.step ?? "(none)"} ${help.modelSteps ? JSON.stringify(help.modelSteps) : ""}`);
    if (res.help.verdict) console.log(`        ${JSON.stringify(res.help.verdict)}`);
    // 2. checking: L2, S, U each under L1
    const y2 = Y + 92;
    const l2 = await readLine(acct, plan.id, plan.L2, { x: X, y: y2 }, CLEAN, [l1.latex], plan.marks, head, l1.latex);
    const sl = await readLine(acct, plan.id, plan.S, { x: X, y: y2 }, CLEAN, [l1.latex], plan.marks, head, l1.latex);
    const un = await readLine(acct, plan.id, plan.U, { x: X, y: y2 }, CLEAN, [l1.latex], plan.marks, head, l1.latex);
    const good = await runColumn(acct, plan, head, [l1, l2], plan.marks);
    const slip = await runColumn(acct, plan, head, [l1, sl], plan.marks);
    const unf = await runColumn(acct, plan, head, [l1, un], plan.marks);
    res.checking = {
      reads: { L2: { latex: l2.latex, same: sameMaths(l2.latex, plan.L2), ms: l2.ms }, S: { latex: sl.latex, same: sameMaths(sl.latex, plan.S), ms: sl.ms }, U: { latex: un.latex, ms: un.ms } },
      good: { looked: good.looked, latexes: good.latexes, marks: good.marks, verdicts: good.judged.map((j) => `${j.analysis.kind}/${j.analysis.verdict}`), check: good.check },
      slip: { looked: slip.looked, latexes: slip.latexes, marks: slip.marks, verdicts: slip.judged.map((j) => `${j.analysis.kind}/${j.analysis.verdict}`), check: slip.check },
      unfinished: { looked: unf.looked, latexes: unf.latexes, marks: unf.marks, verdicts: unf.judged.map((j) => `${j.analysis.kind}/${j.analysis.verdict}${j.unfinished ? " held" : ""}`), check: unf.check, held: unf.judged[1].unfinished },
    };
    for (const [name, col] of [["good", good], ["slip", slip], ["unfin", unf]] as const) {
      console.log(`  ${name.padEnd(5)} ${JSON.stringify(col.latexes)} → ${col.marks.join(",")} [${col.judged.map((j) => `${j.analysis.kind}/${j.analysis.verdict}`).join(", ")}]${col.check ? ` check ${col.check.status} ${col.check.ms}ms ${JSON.stringify(col.check.annotations.map((a: any) => `${a.lineId === col.judged.length ? "" : a.lineId}:${a.verdict}:${a.message}`))} ctx=${col.check.satBlock}` : ""}${col.looked ? ` 2nd-look[${col.looked.join(" | ")}]` : ""}`);
    }
    results.push(res);
    writeFileSync(outFile, JSON.stringify({ at: new Date().toISOString(), account: acct.email, results }, null, 2));
  }
  // 4. the figure-marks probe: a general slope formula; the marks circle the two labelled points
  if (!only || only.includes("marks")) {
    console.log(`\n=== marks probe on ${MARKS_PROBE.id}`);
    const q = bank.get(MARKS_PROBE.id);
    const head = problemLines(q.stem);
    const r1 = await readLine(acct, MARKS_PROBE.id, MARKS_PROBE.line, { x: 140, y: 620 }, CLEAN, [], MARKS_PROBE.marks, head, null);
    console.log(`  read "${r1.latex}" (${r1.confidence.toFixed(2)})`);
    const help = await helpOneStep(acct, PLAN[0], head, [r1], MARKS_PROBE.marks);
    console.log(`  help ${help.source} ${help.ms}ms → ${help.step} ${JSON.stringify(help.modelSteps ?? [])} ctx=${help.satBlock} marks=${help.marksInPrompt}`);
    results.push({ id: "marks-probe", read: r1.latex, help });
    writeFileSync(outFile, JSON.stringify({ at: new Date().toISOString(), account: acct.email, results }, null, 2));
  }
  const end = await openRouterBalance();
  console.log(`\nOpenRouter calls ${orCalls}, Mathpix calls ${mpxCalls}; balance $${end.toFixed(3)} (this run ~$${(startBalance - end).toFixed(3)}, production shares the key)`);
  writeFileSync(outFile, JSON.stringify({ at: new Date().toISOString(), account: acct.email, openrouterCalls: orCalls, mathpixCalls: mpxCalls, balanceStart: startBalance, balanceEnd: end, results }, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
