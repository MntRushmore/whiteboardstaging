/**
 * SAT v2's notes stage (docs/SAT-V2.md "Bank additions"): for every live generated question in
 * data/sat/bank.json, write the optional teaching notes, check them three ways, and keep only what
 * passes. A note that fails is DROPPED (the field left out), never guessed; the question stays live
 * either way. The 20 hand-written samples (docs/sat/sample-20.json) carry hand-written notes and are
 * copied as they are.
 *
 *   JITI_ALIAS='{"@/":"<repo>/src/"}' npx jiti scripts/sat/notes.ts [--limit N] [--offline] [--ids a,b]
 *
 *   --limit N   only the first N batches (of 5 questions)
 *   --offline   cached replies only (no network, no spend)
 *   --ids a,b   only these questions
 *
 *  1. WRITER (Claude Sonnet 5.5): per question the `nudge`, a `why` for each wrong choice (mcq) or
 *     0–3 `common_wrong` grid-ins (spr), each with a mathjs `check` (the arithmetic of the mistake),
 *     and `desmos_steps` when Desmos really helps (null otherwise). It sees the question, the answer,
 *     the solution and v1's distractor notes (data/sat/review.json), which it is told to re-check.
 *  2. MECHANICAL: the contract's lengths; the lint's note checks (SwiftMath-safe LaTeX, a nudge that
 *     names or writes the answer, a "wrong" grid-in that is right or not a grid-in); the numeric
 *     re-check (scripts/sat/cas.ts mistakeCheck: the `check` must land on the choice it explains;
 *     a check that does not evaluate is skipped, one that lands elsewhere fails).
 *  3. VERIFIER (GPT-5.4 mini at medium reasoning, a different family): re-derives every mistake from the question and
 *     reports what it gets, and checks the nudge gives nothing away and the Desmos steps work. A note
 *     it does not answer for is dropped.
 *
 * MONEY: the OpenRouter key is production's. The stage has its own spend file
 * (src/__eval__/.cache/sat-notes/spend.json) under a HARD cap of $4.00 (the bench's SpendLedger:
 * each call reserves its worst case first), and it reads the account's balance
 * (GET /api/v1/credits) before starting and every 50 network calls: below $8.00 left (with the
 * in-flight calls' worst case on top) it stops making calls. What is done is kept; a rerun resumes
 * from the cache (every reply is cached) for free.
 *
 * A person's verdicts: data/sat/notes-manual.json ({id: {drop?: ["why C", "nudge", ...], nudge?,
 * why?: {C: "..."}, common_wrong?: [...], desmos_steps?: [...] | null, note}}) is applied last on
 * every run: a hand-check's fixes replace the model's notes (and still pass the mechanical checks),
 * its drops remove them.
 *
 * Outputs (checked in): data/sat/bank.json (the notes merged into the live rows),
 * data/sat/notes-review.json (per question: what was written, each check, what was kept and why
 * anything was dropped), data/sat/notes-report.json (coverage, drops by reason, spend, balance).
 *
 * Env: OPENROUTER_API_KEY (read from .env.local when not set).
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { SAT_NOTE_LIMITS, SatQuestionSchema, type SatQuestion } from "../../src/lib/sat/contracts";
import { commonWrongIssues, desmosStepIssues, latexIssues, nudgeIssues, questionIssues } from "../../src/lib/sat/lint";
import { loadCatalog, pool, SpendLedger, type CallContext, type CallRecord, type CallSpec } from "../../src/__eval__/models/client";
import { loadDotEnvLocal } from "../lib/supabaseHttp.mjs";
import { mistakeCheck, type CasResult } from "./cas";
import { cachedOnly, callModel, DATA_DIR, normalizeLatex, parseJsonObject, ROOT } from "./pipeline";
import { NOTES_VERIFIER_SYSTEM, NOTES_WRITER_SYSTEM, notesVerifierPrompt, notesWriterPrompt, type NotesForCheck } from "./prompts";

export const NOTES_CACHE_DIR = join(ROOT, "src", "__eval__", ".cache", "sat-notes");
export const NOTES_SPEND_CAP_USD = 4;
/** Stop when the shared account would have less than this left. */
export const BALANCE_FLOOR_USD = 8;
const BALANCE_EVERY_CALLS = 50;
const BATCH = 5;

export const NOTES_MODELS = {
  writer: "anthropic/claude-sonnet-5.5",
  verifier: "openai/gpt-5.4-mini",
} as const;

type Key = "A" | "B" | "C" | "D";
type Step = { text: string; math: string | null };

/** What the writer proposed for one question, cleaned (LaTeX normalized), before any check. */
export type Candidate = {
  nudge: string | null;
  whys: Partial<Record<Key, { why: string; check: string | null }>>;
  common_wrong: Array<{ answer: string; why: string; check: string | null }>;
  /** null: the writer says Desmos does not really help; undefined: nothing usable written */
  desmos_steps: Step[] | null | undefined;
};

export type NoteCheck = { ok: boolean; reason: string; numeric?: CasResult["result"]; result?: string };

export type NotesReview = {
  candidate: Candidate | null;
  mechanical: Record<string, NoteCheck>;
  verifier: Record<string, NoteCheck> | null;
  kept: string[];
  dropped: Record<string, string>;
  error?: string;
};

// ------------------------------------------------------------------ reading the writer

const str = (v: unknown) => (typeof v === "string" ? normalizeLatex(v.trim()) : "");
const nullish = (v: unknown) => v === null || v === undefined || (typeof v === "string" && /^(null|none|)$/i.test(v.trim()));

/** One question's notes from the writer's reply object (anything malformed is simply absent). */
export function parseCandidate(q: SatQuestion, raw: unknown): Candidate {
  const o = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const nudge = str(o.nudge) || null;
  const whys: Candidate["whys"] = {};
  if (q.format === "mcq" && o.whys && typeof o.whys === "object") {
    for (const [k, v] of Object.entries(o.whys as Record<string, unknown>)) {
      const key = k.trim().toUpperCase() as Key;
      if (!["A", "B", "C", "D"].includes(key) || !v || typeof v !== "object") continue;
      const why = str((v as { why?: unknown }).why);
      const check = (v as { check?: unknown }).check;
      if (why) whys[key] = { why, check: nullish(check) ? null : String(check).trim() };
    }
  }
  const common_wrong: Candidate["common_wrong"] = [];
  if (q.format === "spr" && Array.isArray(o.common_wrong)) {
    for (const w of o.common_wrong) {
      if (!w || typeof w !== "object") continue;
      const r = w as { answer?: unknown; why?: unknown; check?: unknown };
      const answer = typeof r.answer === "number" ? String(r.answer) : typeof r.answer === "string" ? r.answer.trim() : "";
      const why = str(r.why);
      if (answer && why) common_wrong.push({ answer, why, check: nullish(r.check) ? null : String(r.check).trim() });
    }
  }
  let desmos_steps: Candidate["desmos_steps"];
  if (o.desmos_steps === null || (typeof o.desmos_steps === "string" && nullish(o.desmos_steps))) desmos_steps = null;
  else if (Array.isArray(o.desmos_steps)) {
    const steps = o.desmos_steps
      .map((s) => {
        const r = (s ?? {}) as { text?: unknown; math?: unknown };
        const math = typeof r.math === "string" ? r.math.trim().replace(/^\$+|\$+$/g, "") : "";
        return { text: str(r.text), math: math && !nullish(math) ? math : null };
      })
      .filter((s) => s.text);
    desmos_steps = steps.length ? steps : undefined;
  }
  return { nudge, whys, common_wrong, desmos_steps };
}

/**
 * The JSON object in a reply that has `key`: the whole reply when it parses, else the LAST complete
 * top-level object that does (a model sometimes writes one, then "Wait, …" and a corrected one).
 */
export function lastJsonWith(text: string, key: string): Record<string, unknown> | null {
  const whole = parseJsonObject(text);
  if (whole && key in whole) return whole;
  const found: Array<Record<string, unknown>> = [];
  let depth = 0;
  let start = -1;
  let inString = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inString) {
      if (ch === "\\") i++;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === "{") {
      if (depth === 0) start = i;
      depth++;
    } else if (ch === "}" && depth > 0 && --depth === 0) {
      try {
        const v = JSON.parse(text.slice(start, i + 1)) as unknown;
        if (v && typeof v === "object" && !Array.isArray(v) && key in (v as object)) found.push(v as Record<string, unknown>);
      } catch {
        // not an object on its own
      }
    }
  }
  return found.at(-1) ?? null;
}

// ------------------------------------------------------------------ the mechanical checks

/** The contract's lengths, the lint's note checks and the numeric re-check, per note. */
export function mechanicalChecks(q: SatQuestion, c: Candidate): Record<string, NoteCheck> {
  const out: Record<string, NoteCheck> = {};
  if (c.nudge !== null) {
    const issues = [...(c.nudge.length > SAT_NOTE_LIMITS.nudge ? [`longer than ${SAT_NOTE_LIMITS.nudge} characters`] : []), ...nudgeIssues(q, c.nudge)];
    out.nudge = { ok: !issues.length, reason: issues.join("; ") };
  }
  const key = "key" in q.answer ? q.answer.key : null;
  for (const [k, w] of Object.entries(c.whys) as Array<[Key, { why: string; check: string | null }]>) {
    const choice = q.choices?.find((x) => x.key === k);
    const issues: string[] = [];
    if (k === key) issues.push("a why on the correct choice");
    if (w.why.length > SAT_NOTE_LIMITS.why) issues.push(`longer than ${SAT_NOTE_LIMITS.why} characters`);
    issues.push(...latexIssues(w.why));
    const numeric = choice ? mistakeCheck(choice.text, w.check) : { result: "skipped" as const, detail: "" };
    if (numeric.result === "fail") issues.push(`numeric: ${numeric.detail}`);
    out[`why ${k}`] = { ok: !issues.length, reason: issues.join("; "), numeric: numeric.result };
  }
  if ("accepted" in q.answer) {
    const kept: Array<{ answer: string }> = [];
    c.common_wrong.forEach((w) => {
      const issues: string[] = [];
      if (w.why.length > SAT_NOTE_LIMITS.why) issues.push(`longer than ${SAT_NOTE_LIMITS.why} characters`);
      issues.push(...commonWrongIssues((q.answer as { accepted: string[] }).accepted, w, kept));
      const numeric = mistakeCheck(w.answer, w.check);
      if (numeric.result === "fail") issues.push(`numeric: ${numeric.detail}`);
      // at most 3: the first three good ones
      if (!issues.length && kept.length >= SAT_NOTE_LIMITS.commonWrong) issues.push(`more than ${SAT_NOTE_LIMITS.commonWrong}`);
      if (!issues.length) kept.push(w);
      out[`common_wrong ${w.answer}`] = { ok: !issues.length, reason: issues.join("; "), numeric: numeric.result };
    });
  }
  if (c.desmos_steps) {
    const issues = [
      ...(c.desmos_steps.length > SAT_NOTE_LIMITS.desmosSteps ? [`more than ${SAT_NOTE_LIMITS.desmosSteps} steps`] : []),
      ...c.desmos_steps.flatMap((s) => [...(s.text.length > 400 ? ["a step over 400 characters"] : []), ...(s.math && s.math.length > 300 ? ["a step's math over 300 characters"] : [])]),
      ...desmosStepIssues(c.desmos_steps),
    ];
    out.desmos_steps = { ok: !issues.length, reason: issues.join("; ") };
  }
  return out;
}

/** The notes that passed the mechanical checks, as the verifier sees them. */
export function forVerifier(c: Candidate, mech: Record<string, NoteCheck>): NotesForCheck {
  const n: NotesForCheck = {};
  if (c.nudge !== null && mech.nudge?.ok) n.nudge = c.nudge;
  const whys = Object.fromEntries((Object.entries(c.whys) as Array<[Key, { why: string }]>).filter(([k]) => mech[`why ${k}`]?.ok).map(([k, w]) => [k, w.why]));
  if (Object.keys(whys).length) n.whys = whys;
  const cw = c.common_wrong.filter((w) => mech[`common_wrong ${w.answer}`]?.ok).map(({ answer, why }) => ({ answer, why }));
  if (cw.length) n.common_wrong = cw;
  if (c.desmos_steps && mech.desmos_steps?.ok) n.desmos_steps = c.desmos_steps;
  return n;
}

// ------------------------------------------------------------------ the verifier's verdict

const okOf = (v: unknown): NoteCheck | null => {
  if (!v || typeof v !== "object") return null;
  const r = v as { ok?: unknown; reason?: unknown; result?: unknown };
  if (typeof r.ok !== "boolean") return null;
  return { ok: r.ok, reason: typeof r.reason === "string" ? r.reason : "", ...(r.result !== undefined ? { result: String(r.result) } : {}) };
};

/** The verifier's answer for one question, note by note (a note it did not answer for is absent). */
export function parseVerdict(raw: unknown, sent: NotesForCheck): Record<string, NoteCheck> {
  const o = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const out: Record<string, NoteCheck> = {};
  if (sent.nudge) {
    const v = okOf(o.nudge);
    if (v) out.nudge = v;
  }
  const whys = (o.whys && typeof o.whys === "object" ? o.whys : {}) as Record<string, unknown>;
  for (const k of Object.keys(sent.whys ?? {})) {
    const v = okOf(whys[k]);
    if (v) out[`why ${k}`] = v;
  }
  const cw = (o.common_wrong && typeof o.common_wrong === "object" ? o.common_wrong : {}) as Record<string, unknown>;
  for (const w of sent.common_wrong ?? []) {
    const v = okOf(cw[w.answer]);
    if (v) out[`common_wrong ${w.answer}`] = v;
  }
  if (sent.desmos_steps) {
    const v = okOf(o.desmos_steps);
    if (v) out.desmos_steps = v;
  }
  return out;
}

/**
 * The question with the notes that passed every check, and why each other note was dropped. A
 * writer's `desmos_steps: null` (Desmos does not really help) is kept as null. Notes the question
 * already had are replaced: this stage is the only writer of the generated questions' notes.
 */
export function mergeNotes(q: SatQuestion, c: Candidate | null, mech: Record<string, NoteCheck>, verdict: Record<string, NoteCheck> | null): { q: SatQuestion; kept: string[]; dropped: Record<string, string> } {
  const kept: string[] = [];
  const dropped: Record<string, string> = {};
  const passes = (name: string): boolean => {
    const m = mech[name];
    if (!m?.ok) {
      dropped[name] = `mechanical: ${m?.reason || "failed"}`;
      return false;
    }
    const v = verdict?.[name];
    if (!v) {
      dropped[name] = verdict ? "verifier: no answer for this note" : "verifier: not run";
      return false;
    }
    if (!v.ok) {
      dropped[name] = `verifier: ${v.reason || "rejected"}${v.result ? ` (got ${v.result})` : ""}`;
      return false;
    }
    kept.push(name);
    return true;
  };
  const out: SatQuestion = { ...q, choices: q.choices ? q.choices.map(({ key, text }) => ({ key, text })) : null, solution: { steps: q.solution.steps, desmos_tip: q.solution.desmos_tip } };
  delete out.nudge;
  delete out.common_wrong;
  if (!c) return { q: out, kept, dropped };
  if (c.nudge !== null && passes("nudge")) out.nudge = c.nudge;
  for (const choice of out.choices ?? []) {
    const w = c.whys[choice.key];
    if (w && passes(`why ${choice.key}`)) choice.why = w.why;
  }
  const cw = c.common_wrong.filter((w) => passes(`common_wrong ${w.answer}`)).map(({ answer, why }) => ({ answer, why }));
  if (cw.length) out.common_wrong = cw.slice(0, SAT_NOTE_LIMITS.commonWrong);
  if (c.desmos_steps === null) out.solution.desmos_steps = null;
  else if (c.desmos_steps && passes("desmos_steps")) out.solution.desmos_steps = c.desmos_steps;
  return { q: out, kept, dropped };
}

// ------------------------------------------------------------------ a person's verdicts

export type ManualNotes = {
  drop?: string[];
  nudge?: string;
  why?: Partial<Record<Key, string>>;
  common_wrong?: Array<{ answer: string; why: string }>;
  desmos_steps?: Step[] | null;
  /** what the hand-check found (not used, kept for the record) */
  note?: string;
};

/**
 * A hand-check's verdict on one question, applied after the models': drops first, then the hand
 * written notes (which still have to pass the mechanical checks, or the run fails loudly).
 */
export function applyManual(q: SatQuestion, m: ManualNotes): SatQuestion {
  const out: SatQuestion = { ...q, choices: q.choices ? q.choices.map((c) => ({ ...c })) : null, solution: { ...q.solution } };
  for (const name of m.drop ?? []) {
    if (name === "nudge") delete out.nudge;
    else if (name === "desmos_steps") delete out.solution.desmos_steps;
    else if (name.startsWith("why ")) delete out.choices?.find((c) => c.key === name.slice(4))?.why;
    else if (name.startsWith("common_wrong ")) {
      out.common_wrong = out.common_wrong?.filter((w) => w.answer !== name.slice(13));
      if (!out.common_wrong?.length) delete out.common_wrong;
    } else throw new Error(`${q.id}: unknown note "${name}" in notes-manual.json`);
  }
  if (m.nudge !== undefined) out.nudge = m.nudge;
  for (const [k, why] of Object.entries(m.why ?? {})) {
    const c = out.choices?.find((x) => x.key === k);
    if (!c) throw new Error(`${q.id}: no choice ${k}`);
    c.why = why;
  }
  if (m.common_wrong !== undefined) {
    if (m.common_wrong.length) out.common_wrong = m.common_wrong;
    else delete out.common_wrong;
  }
  if (m.desmos_steps !== undefined) out.solution.desmos_steps = m.desmos_steps;
  const c: Candidate = {
    nudge: m.nudge ?? null,
    whys: Object.fromEntries(Object.entries(m.why ?? {}).map(([k, why]) => [k, { why: why!, check: null }])),
    common_wrong: (m.common_wrong ?? []).map((w) => ({ ...w, check: null })),
    desmos_steps: m.desmos_steps ?? undefined,
  };
  const bad = Object.entries(mechanicalChecks(q, c)).filter(([, v]) => !v.ok);
  if (bad.length) throw new Error(`${q.id}: a hand-written note fails a check: ${bad.map(([k, v]) => `${k} (${v.reason})`).join("; ")}`);
  return out;
}

// ------------------------------------------------------------------ money

/** The shared account's balance (total_credits - total_usage), or null when it cannot be read. */
export async function readBalance(fetchImpl: typeof fetch = fetch): Promise<number | null> {
  try {
    const res = await fetchImpl("https://openrouter.ai/api/v1/credits", { headers: { Authorization: `Bearer ${process.env.OPENROUTER_API_KEY ?? ""}` }, signal: AbortSignal.timeout(20_000) });
    if (!res.ok) return null;
    const d = ((await res.json()) as { data?: { total_credits?: number; total_usage?: number } }).data;
    return typeof d?.total_credits === "number" && typeof d.total_usage === "number" ? d.total_credits - d.total_usage : null;
  } catch {
    return null;
  }
}

// ------------------------------------------------------------------ the run

function arg(name: string): string | null {
  const i = process.argv.indexOf(name);
  return i >= 0 ? (process.argv[i + 1] ?? "") : null;
}

async function main(): Promise<void> {
  loadDotEnvLocal(ROOT);
  const offline = process.argv.includes("--offline");
  const limit = arg("--limit") ? Number(arg("--limit")) : Infinity;
  const only = arg("--ids") ? new Set(arg("--ids")!.split(",")) : null;

  mkdirSync(NOTES_CACHE_DIR, { recursive: true });
  const { models } = await loadCatalog(NOTES_CACHE_DIR);
  for (const m of Object.values(NOTES_MODELS)) if (!models.has(m)) throw new Error(`${m} is not in the OpenRouter catalog`);
  const ledger = new SpendLedger(NOTES_SPEND_CAP_USD, join(NOTES_CACHE_DIR, "spend.json"));
  const ctx: CallContext = { catalog: models, ledger, cacheDir: NOTES_CACHE_DIR };
  const startUsd = ledger.totalUsd;
  const log = (msg: string) => console.log(`[notes ${new Date().toISOString().slice(11, 19)} $${ledger.totalUsd.toFixed(3)}] ${msg}`);

  // the money guard: the stage's cap is the ledger's; the account's floor is read here
  let stop: string | null = null;
  let networkCalls = 0;
  let inFlightWorst = 0;
  let balanceStart: number | null = null;
  let balanceLast: number | null = null;
  const checkBalance = async (): Promise<void> => {
    const b = await readBalance();
    balanceLast = b;
    if (balanceStart === null) balanceStart = b;
    if (b === null) stop ??= "the account balance could not be read";
    else if (b - inFlightWorst - 0.25 < BALANCE_FLOOR_USD) stop ??= `the account balance is $${b.toFixed(2)} (floor $${BALANCE_FLOOR_USD.toFixed(2)})`;
    log(`balance $${b?.toFixed(2) ?? "?"}${stop ? `: STOP (${stop})` : ""}`);
  };
  const call = async (spec: CallSpec): Promise<CallRecord | null> => {
    if (offline) return cachedOnly(spec, ctx);
    const hit = await cachedOnly(spec, ctx);
    if (hit.cached && hit.ok) return hit;
    // not cached (or a cached failure, which the pipeline's callModel may try again): a network call
    if (stop) return null;
    const worst = 0.1;
    inFlightWorst += worst;
    try {
      const rec = await callModel(spec, ctx);
      if (!rec.cached) {
        networkCalls++;
        if (networkCalls % BALANCE_EVERY_CALLS === 0) await checkBalance();
      }
      if (rec.failure === "budget") stop ??= `the stage's spend cap $${NOTES_SPEND_CAP_USD.toFixed(2)} was reached`;
      if (rec.failure === "http" && rec.status === 402) stop ??= "the account is out of credits (402)";
      return rec;
    } finally {
      inFlightWorst -= worst;
    }
  };
  if (!offline) {
    await checkBalance();
    if (stop) throw new Error(`not starting: ${stop}`);
  }

  const bank = JSON.parse(readFileSync(join(DATA_DIR, "bank.json"), "utf8")) as SatQuestion[];
  const samples = JSON.parse(readFileSync(join(ROOT, "docs", "sat", "sample-20.json"), "utf8")) as SatQuestion[];
  const sampleById = new Map(samples.map((q) => [q.id, q]));
  const v1Review = JSON.parse(readFileSync(join(DATA_DIR, "review.json"), "utf8")) as Record<string, { distractors?: Record<string, string> | null }>;
  // retired questions stay in the batches, so retiring one later never shifts the others (or their
  // cached replies); a retired question's notes are never served
  const targets = bank.filter((q) => (q.status === "live" || q.status === "retired") && !sampleById.has(q.id) && (!only || only.has(q.id)));
  const groups: SatQuestion[][] = [];
  for (let i = 0; i < targets.length; i += BATCH) groups.push(targets.slice(i, i + BATCH));
  const run = groups.slice(0, limit);
  log(`${targets.length} live generated questions in ${groups.length} batches; running ${run.length}`);

  // 1. the writer
  const candidates = new Map<string, Candidate>();
  // replies whose notes were in a second, corrected JSON object (lastJsonWith): verified in batches
  // of their own after the rest, so the other batches (and their cached replies) never shift
  const recovered = new Set<string>();
  const errors = new Map<string, string>();
  let wrote = 0;
  await pool(run, 3, async (batch) => {
    const rec = await call({
      model: NOTES_MODELS.writer,
      messages: [
        { role: "system", content: NOTES_WRITER_SYSTEM },
        { role: "user", content: notesWriterPrompt(batch.map((q) => ({ ...q, distractors: v1Review[q.id]?.distractors ?? null }))) },
      ],
      maxTokens: 8000,
      json: true,
      reasoning: "low",
      timeoutMs: 240_000,
    });
    if (!rec) return batch.forEach((q) => errors.set(q.id, `writer not run: ${stop}`));
    const o = rec.ok ? lastJsonWith(rec.content, "notes") : null;
    const list = Array.isArray(o?.notes) ? (o!.notes as Array<Record<string, unknown>>) : [];
    const second = rec.ok && !parseJsonObject(rec.content);
    for (const q of batch) {
      const raw = list.find((r) => r.id === q.id);
      if (raw && second) recovered.add(q.id);
      if (raw) candidates.set(q.id, parseCandidate(q, raw));
      else errors.set(q.id, rec.ok ? "writer: no notes for this question" : `writer: ${rec.error ?? rec.failure}`);
    }
    if (++wrote % 10 === 0) log(`writer ${wrote}/${run.length}`);
  });
  log(`writer: notes for ${candidates.size} of ${run.reduce((s, b) => s + b.length, 0)}`);

  // 2. mechanical checks, 3. the verifier
  const mech = new Map<string, Record<string, NoteCheck>>();
  const sent = new Map<string, NotesForCheck>();
  for (const [id, c] of candidates) {
    const q = targets.find((t) => t.id === id)!;
    const m = mechanicalChecks(q, c);
    mech.set(id, m);
    const n = forVerifier(c, m);
    if (Object.keys(n).length) sent.set(id, n);
  }
  const vGroups: SatQuestion[][] = [];
  for (const part of [targets.filter((q) => sent.has(q.id) && !recovered.has(q.id)), targets.filter((q) => sent.has(q.id) && recovered.has(q.id))]) {
    for (let i = 0; i < part.length; i += BATCH) vGroups.push(part.slice(i, i + BATCH));
  }
  const verdicts = new Map<string, Record<string, NoteCheck>>();
  let verified = 0;
  await pool(vGroups, 3, async (batch) => {
    const rec = await call({
      model: NOTES_MODELS.verifier,
      messages: [
        { role: "system", content: NOTES_VERIFIER_SYSTEM },
        { role: "user", content: notesVerifierPrompt(batch.map((q) => ({ q, notes: sent.get(q.id)! }))) },
      ],
      maxTokens: 12000,
      json: true,
      reasoning: "medium",
      timeoutMs: 240_000,
    });
    if (!rec) return batch.forEach((q) => errors.set(q.id, `verifier not run: ${stop}`));
    const o = rec.ok ? lastJsonWith(rec.content, "checks") : null;
    const list = Array.isArray(o?.checks) ? (o!.checks as Array<Record<string, unknown>>) : [];
    for (const q of batch) {
      const raw = list.find((r) => r.id === q.id);
      if (raw) verdicts.set(q.id, parseVerdict(raw, sent.get(q.id)!));
      else errors.set(q.id, rec.ok ? "verifier: no checks for this question" : `verifier: ${rec.error ?? rec.failure}`);
    }
    if (++verified % 10 === 0) log(`verifier ${verified}/${vGroups.length}`);
  });
  if (!offline) await checkBalance();

  // 4. merge: generated live questions get what passed; samples their hand-written notes
  const reviewFile = join(DATA_DIR, "notes-review.json");
  const reviews: Record<string, NotesReview> = existsSync(reviewFile) && only ? (JSON.parse(readFileSync(reviewFile, "utf8")) as Record<string, NotesReview>) : {};
  const ran = new Set(run.flat().map((q) => q.id));
  const merged: SatQuestion[] = bank.map((q) => {
    const sample = sampleById.get(q.id);
    if (sample && q.status === "live") return { ...sample, status: q.status, version: q.version };
    if (!ran.has(q.id)) return q;
    const c = candidates.get(q.id) ?? null;
    const m = mech.get(q.id) ?? {};
    const v = verdicts.get(q.id) ?? null;
    const r = mergeNotes(q, c, m, v);
    reviews[q.id] = { candidate: c, mechanical: m, verifier: v, kept: r.kept, dropped: r.dropped, ...(errors.has(q.id) ? { error: errors.get(q.id) } : {}) };
    return r.q;
  });
  const manualFile = join(DATA_DIR, "notes-manual.json");
  const manual = existsSync(manualFile) ? (JSON.parse(readFileSync(manualFile, "utf8")) as Record<string, ManualNotes>) : {};
  for (let i = 0; i < merged.length; i++) {
    const m = manual[merged[i].id];
    if (m && !sampleById.has(merged[i].id)) merged[i] = applyManual(merged[i], m);
  }
  // a live row must still be whole (drafts may never have fit: they are drafts for a reason)
  for (const q of merged) {
    if (q.status !== "live") continue;
    const parsed = SatQuestionSchema.safeParse(q);
    if (!parsed.success) throw new Error(`${q.id} no longer fits the contract: ${parsed.error.issues[0]?.message}`);
    if (q.status === "live" && questionIssues(q).length) throw new Error(`${q.id} no longer passes the checks: ${questionIssues(q).join("; ")}`);
  }
  writeFileSync(join(DATA_DIR, "bank.json"), JSON.stringify(merged, null, 1) + "\n");
  const sortedReviews = Object.fromEntries(Object.keys(reviews).sort().map((id) => [id, reviews[id]]));
  writeFileSync(reviewFile, JSON.stringify(sortedReviews, null, 1) + "\n");

  // 5. the report
  const live = merged.filter((q) => q.status === "live");
  const mcq = live.filter((q) => q.format === "mcq");
  const spr = live.filter((q) => q.format === "spr");
  const wrongChoices = mcq.length * 3;
  const dropKinds: Record<string, number> = {};
  for (const r of Object.values(sortedReviews)) for (const [name, why] of Object.entries(r.dropped)) {
    const kind = `${name.split(" ")[0]}: ${why.split(":")[0]}`;
    dropKinds[kind] = (dropKinds[kind] ?? 0) + 1;
  }
  const report = {
    at: new Date().toISOString(),
    models: NOTES_MODELS,
    live: live.length,
    hand_written_samples: live.filter((q) => sampleById.has(q.id)).length,
    generated_live: targets.filter((q) => q.status === "live").length,
    batches: { total: groups.length, run: run.length },
    stopped: stop,
    coverage: {
      nudge: live.filter((q) => q.nudge).length,
      mcq: mcq.length,
      mcq_with_any_why: mcq.filter((q) => q.choices?.some((c) => c.why)).length,
      mcq_with_all_three_whys: mcq.filter((q) => q.choices?.filter((c) => c.why).length === 3).length,
      whys: mcq.reduce((s, q) => s + (q.choices?.filter((c) => c.why).length ?? 0), 0),
      wrong_choices: wrongChoices,
      spr: spr.length,
      spr_with_common_wrong: spr.filter((q) => q.common_wrong?.length).length,
      common_wrong: spr.reduce((s, q) => s + (q.common_wrong?.length ?? 0), 0),
      desmos_steps: live.filter((q) => q.solution.desmos_steps).length,
      desmos_steps_null: live.filter((q) => q.solution.desmos_steps === null).length,
    },
    dropped: { total: Object.values(dropKinds).reduce((a, b) => a + b, 0), by_kind: dropKinds },
    errors: Object.values(sortedReviews).filter((r) => r.error).length,
    spend_usd: { total: Number(ledger.totalUsd.toFixed(4)), this_run: Number((ledger.totalUsd - startUsd).toFixed(4)), cap: NOTES_SPEND_CAP_USD, by_model: ledger.snapshot.byModel },
    balance_usd: { at_start: balanceStart, at_end: balanceLast, floor: BALANCE_FLOOR_USD },
    network_calls: networkCalls,
    hand_checked_overrides: Object.keys(manual).length,
  };
  writeFileSync(join(DATA_DIR, "notes-report.json"), JSON.stringify(report, null, 1) + "\n");
  log(`done: ${JSON.stringify(report.coverage)}; dropped ${report.dropped.total}${stop ? `; STOPPED: ${stop}` : ""}`);
}

if (process.argv[1]?.endsWith("notes.ts")) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
