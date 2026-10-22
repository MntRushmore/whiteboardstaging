/**
 * The SAT bank pipeline (docs/SAT-MODE.md "Our own bank"): plan -> generate -> independent solve
 * -> numeric check -> lint -> dedupe -> write. Anything that fails a check is written as `draft`,
 * never `live`, with its reasons in data/sat/review.json.
 *
 *   JITI_ALIAS='{"@/":"<repo>/src/"}' npx jiti scripts/sat/pipeline.ts [--samples] [--limit N] [--offline]
 *
 *   --samples   only run the hand-written docs/sat/sample-20.json through the solver (the pipeline check)
 *   --limit N   only the first N writer batches (of 150)
 *   --offline   cached replies only (no network, no spend)
 *
 * Models (OpenRouter): the WRITER is Claude Opus 5.5; the SOLVER, a different family, is GPT-5.4
 * mini, and it never sees the answer. When it disagrees with the writer or flags a problem, GPT-5.4
 * breaks the tie: the question is live only if the tie-breaker agrees with the writer's answer and
 * flags nothing. Every reply is cached under src/__eval__/.cache/sat/ (gitignored), so a rerun is
 * free and gives the same bank; spend is kept in src/__eval__/.cache/sat/spend.json under a HARD
 * cap of $35 (the model bench's SpendLedger: each call reserves its worst case first).
 *
 * Outputs (checked in): data/sat/bank.json (every question, live and draft, sorted by id: the
 * samples plus the generated), data/sat/review.json (per question: why draft, the numeric check,
 * the solvers' answers, the mistake behind each wrong choice), data/sat/report.json (the numbers).
 * Load the bank with scripts/sat/upsert.ts.
 *
 * Env: OPENROUTER_API_KEY (read from .env.local when not set).
 */
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { isSprCorrect } from "../../src/lib/sat/answer";
import { SatQuestionSchema, type SatQuestion } from "../../src/lib/sat/contracts";
import { questionIssues } from "../../src/lib/sat/lint";
import { buildBody, cachedCall, callModel as benchCall, loadCatalog, pool, requestKey, SpendLedger, type CallContext, type CallRecord, type CallSpec } from "../../src/__eval__/models/client";
import { loadDotEnvLocal } from "../lib/supabaseHttp.mjs";
import { casCheck, type CasResult, type Verify } from "./cas";
import { nearDuplicates } from "./dedupe";
import { batches, buildPlan, type Slot } from "./plan";
import { SOLVER_SYSTEM, solverPrompt, WRITER_SYSTEM, writerPrompt } from "./prompts";

export const ROOT = resolve(__dirname, "..", "..");
export const CACHE_DIR = join(ROOT, "src", "__eval__", ".cache", "sat");
export const DATA_DIR = join(ROOT, "data", "sat");
export const SPEND_CAP_USD = 35;

export const MODELS = {
  writer: "anthropic/claude-opus-5.5",
  solver: "openai/gpt-5.4-mini",
  tiebreak: "openai/gpt-5.4",
} as const;

// ------------------------------------------------------------------ calls

let OFFLINE = false;

/**
 * One cached, priced model call (the bench's `callModel`), with two changes for a long run that may
 * be stopped and resumed: a cached TRANSIENT failure (timeout, network, 429, 5xx) is dropped and
 * tried again, and `--offline` answers from the cache only (a miss is a `budget`-style failure that
 * is never cached).
 */
export async function callModel(spec: CallSpec, ctx: CallContext): Promise<CallRecord> {
  if (OFFLINE) {
    return cachedCall(spec, ctx) ?? { model: spec.model, key: "", ok: false, failure: "budget", error: "offline: not cached", content: "", latencyMs: 0, promptTokens: 0, completionTokens: 0, reasoningTokens: 0, costUsd: 0, costSource: "none", attempts: 0, at: new Date().toISOString(), cached: false };
  }
  const hit = cachedCall(spec, ctx);
  const transient = hit && !hit.ok && (hit.failure === "timeout" || hit.failure === "network" || (hit.failure === "http" && (hit.status === 429 || (hit.status ?? 0) >= 500 || hit.status === undefined)));
  if (transient) {
    const file = join(ctx.cacheDir ?? CACHE_DIR, spec.model.replace(/[^a-zA-Z0-9._-]+/g, "_"), `${requestKey(buildBody(spec, ctx.catalog.get(spec.model)))}.json`);
    if (existsSync(file)) rmSync(file);
  }
  return benchCall(spec, ctx);
}

// ------------------------------------------------------------------ parsing the writer

export type RawQuestion = {
  slot?: unknown;
  stem?: unknown;
  figure?: unknown;
  choices?: unknown;
  answer?: unknown;
  distractors?: unknown;
  steps?: unknown;
  desmos_tip?: unknown;
  verify?: unknown;
};

/** The first JSON object in a reply (models sometimes wrap it in a fence or a sentence). */
export function parseJsonObject(text: string): Record<string, unknown> | null {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try {
    const v = JSON.parse(text.slice(start, end + 1)) as unknown;
    return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/**
 * Mechanical clean-ups before the lint (the subset's equivalents, never a change of meaning):
 * \dfrac and \tfrac are \frac, \times is \cdot, \div is /, \left and \right go, a thin space \, goes.
 */
export function normalizeLatex(text: string): string {
  return text
    .replace(/\\[dt]frac/g, "\\frac")
    .replace(/\\times/g, "\\cdot")
    .replace(/\\div/g, "/")
    .replace(/\\left\s*([(|[])/g, "$1")
    .replace(/\\right\s*([)|\]])/g, "$1")
    .replace(/\\,/g, " ")
    .replace(/\\leq\b/g, "\\le")
    .replace(/\\geq\b/g, "\\ge")
    .replace(/\\neq\b/g, "\\ne");
}

const str = (v: unknown) => (typeof v === "string" ? normalizeLatex(v.trim()) : "");

/** A writer's question as a bank row (status `draft` until every check passes). */
export function toQuestion(slot: Slot, raw: RawQuestion): { q: SatQuestion; verify: Verify | null; distractors: Record<string, string> | null } {
  const steps = Array.isArray(raw.steps)
    ? raw.steps.map((s) => {
        const o = (s ?? {}) as { text?: unknown; math?: unknown };
        const math = str(o.math).replace(/^\$+|\$+$/g, "");
        return { text: str(o.text), math: math || null };
      })
    : [];
  const choices =
    slot.format === "mcq" && Array.isArray(raw.choices)
      ? raw.choices.slice(0, 4).map((t, i) => ({ key: "ABCD"[i] as "A" | "B" | "C" | "D", text: str(typeof t === "object" && t ? (t as { text?: unknown }).text : t) }))
      : null;
  const answer =
    slot.format === "mcq"
      ? { key: (typeof raw.answer === "string" ? raw.answer.trim().toUpperCase().slice(0, 1) : "?") as "A" }
      : { accepted: (Array.isArray(raw.answer) ? raw.answer : [raw.answer]).filter((a): a is string | number => typeof a === "string" || typeof a === "number").map((a) => String(a).trim()) };
  const v = (raw.verify ?? null) as Record<string, unknown> | null;
  const verify: Verify | null =
    v?.kind === "value" && typeof v.expr === "string"
      ? { kind: "value", expr: v.expr }
      : v?.kind === "expression" && typeof v.target === "string"
        ? { kind: "expression", target: v.target }
        : v?.kind === "none"
          ? { kind: "none" }
          : null;
  const tip = str(raw.desmos_tip);
  return {
    q: {
      id: slot.id,
      domain: slot.domain,
      skill: slot.skill,
      difficulty: slot.difficulty,
      format: slot.format,
      stem: str(raw.stem),
      figure: raw.figure && typeof raw.figure === "object" ? (raw.figure as SatQuestion["figure"]) : null,
      choices,
      answer,
      solution: { steps, desmos_tip: tip && tip.toLowerCase() !== "null" ? tip : null },
      status: "draft",
      version: 1,
    },
    verify,
    distractors: raw.distractors && typeof raw.distractors === "object" ? (raw.distractors as Record<string, string>) : null,
  };
}

// ------------------------------------------------------------------ the solver's verdict

export type Solve = { model: string; answer: string | null; issues: string[]; agrees: boolean; ok: boolean; error?: string };

/** Does the solver's answer match the question's? (mcq: the key; spr: any accepted form or an equal value) */
export function agrees(q: Pick<SatQuestion, "format" | "answer">, answer: string | null): boolean {
  if (!answer) return false;
  const a = answer.trim().replace(/^\(?([A-Da-d])\)?[.):]?$/, "$1");
  if (q.format === "mcq") return "key" in q.answer && a.toUpperCase() === q.answer.key;
  if (!("accepted" in q.answer)) return false;
  if (isSprCorrect(a, q.answer.accepted)) return true;
  // a solver may write 0.75 where the grid wants .75, or 7.0: compare values to the listed forms' precision
  const v = Number(a.includes("/") ? Number(a.split("/")[0]) / Number(a.split("/")[1]) : a);
  return Number.isFinite(v) && q.answer.accepted.some((f) => {
    const fv = f.includes("/") ? Number(f.replace(/^-/, "").split("/")[0]) / Number(f.split("/")[1]) * (f.startsWith("-") ? -1 : 1) : Number(f);
    const decimals = f.includes(".") ? f.split(".")[1].length : 0;
    return Number.isFinite(fv) && Math.abs(fv - v) <= (decimals ? Math.pow(10, -decimals) : 1e-9);
  });
}

function readSolve(model: string, q: SatQuestion, rec: CallRecord): Solve {
  if (!rec.ok) return { model, answer: null, issues: [], agrees: false, ok: false, error: rec.error ?? rec.failure };
  const o = parseJsonObject(rec.content);
  if (!o) return { model, answer: null, issues: [], agrees: false, ok: false, error: "unreadable reply" };
  const answer = typeof o.answer === "string" || typeof o.answer === "number" ? String(o.answer) : null;
  const issues = Array.isArray(o.issues) ? o.issues.filter((i): i is string => typeof i === "string" && i.trim().length > 0) : [];
  return { model, answer, issues, agrees: agrees(q, answer), ok: true };
}

async function solve(model: string, q: SatQuestion, ctx: CallContext, reasoning: "low" | "medium"): Promise<Solve> {
  const rec = await callModel(
    { model, messages: [{ role: "system", content: SOLVER_SYSTEM }, { role: "user", content: solverPrompt(q) }], maxTokens: 8000, json: true, reasoning, timeoutMs: 180_000 },
    ctx,
  );
  return readSolve(model, q, rec);
}

/** The writer's answer stands when the solver agrees and flags nothing, or the tie-breaker does. */
export async function independentSolve(q: SatQuestion, ctx: CallContext): Promise<{ first: Solve; tiebreak: Solve | null; verdict: "agree" | "tiebreak" | "disagree" | "error" }> {
  const first = await solve(MODELS.solver, q, ctx, "medium");
  if (first.ok && first.agrees && !first.issues.length) return { first, tiebreak: null, verdict: "agree" };
  const tiebreak = await solve(MODELS.tiebreak, q, ctx, "medium");
  if (tiebreak.ok && tiebreak.agrees && !tiebreak.issues.length) return { first, tiebreak, verdict: "tiebreak" };
  return { first, tiebreak, verdict: first.ok || tiebreak.ok ? "disagree" : "error" };
}

// ------------------------------------------------------------------ the run

export type Review = {
  status: "live" | "draft";
  reasons: string[];
  cas: CasResult | null;
  solve: { verdict: string; first: Solve | null; tiebreak: Solve | null } | null;
  distractors: Record<string, string> | null;
  source: "sample" | "generated";
};

function arg(name: string): string | null {
  const i = process.argv.indexOf(name);
  return i >= 0 ? (process.argv[i + 1] ?? "") : null;
}

async function main(): Promise<void> {
  loadDotEnvLocal(ROOT);
  const offline = process.argv.includes("--offline");
  const samplesOnly = process.argv.includes("--samples");
  const limit = arg("--limit") ? Number(arg("--limit")) : Infinity;

  mkdirSync(CACHE_DIR, { recursive: true });
  const { models } = await loadCatalog(CACHE_DIR);
  for (const m of Object.values(MODELS)) if (!models.has(m)) throw new Error(`${m} is not in the OpenRouter catalog`);
  const ledger = new SpendLedger(SPEND_CAP_USD, join(CACHE_DIR, "spend.json"));
  OFFLINE = offline;
  const ctx: CallContext = { catalog: models, ledger, cacheDir: CACHE_DIR };
  const startUsd = ledger.totalUsd;
  const log = (msg: string) => console.log(`[sat ${new Date().toISOString().slice(11, 19)} $${ledger.totalUsd.toFixed(2)}] ${msg}`);

  const samples = JSON.parse(readFileSync(join(ROOT, "docs", "sat", "sample-20.json"), "utf8")) as SatQuestion[];
  const reviews = new Map<string, Review>();
  const questions = new Map<string, SatQuestion>();

  // 1. the hand-written samples: the pipeline check (they must come through clean)
  await pool(samples, 8, async (q) => {
    const s = await independentSolve(q, ctx);
    const reasons = [...questionIssues(q)];
    if (s.verdict !== "agree" && s.verdict !== "tiebreak") reasons.push(`independent solve: ${s.verdict} (${s.first.model} said ${s.first.answer}${s.first.issues.length ? `, flagged: ${s.first.issues.join("; ")}` : ""}; ${s.tiebreak?.model ?? ""} said ${s.tiebreak?.answer ?? "-"}${s.tiebreak?.issues.length ? `, flagged: ${s.tiebreak.issues.join("; ")}` : ""})`);
    questions.set(q.id, { ...q, status: reasons.length ? "draft" : "live" });
    reviews.set(q.id, { status: reasons.length ? "draft" : "live", reasons, cas: null, solve: { verdict: s.verdict, first: s.first, tiebreak: s.tiebreak }, distractors: null, source: "sample" });
  });
  const sampleBad = samples.filter((q) => reviews.get(q.id)!.status !== "live");
  log(`samples: ${samples.length - sampleBad.length}/${samples.length} clean${sampleBad.length ? `; not clean: ${sampleBad.map((q) => `${q.id} (${reviews.get(q.id)!.reasons.join(" | ")})`).join(", ")}` : ""}`);
  if (samplesOnly) {
    writeOutputs(questions, reviews, ledger, startUsd, { planned: 0, batches: 0, generated: 0 });
    return;
  }

  // 2. generate
  const plan = buildPlan();
  const groups = batches(plan).slice(0, limit);
  let budgetStop = false;
  const generated = new Map<string, { q: SatQuestion; verify: Verify | null; distractors: Record<string, string> | null }>();
  await pool(groups, 4, async (batch, i) => {
    if (budgetStop) return;
    const rec = await callModel(
      { model: MODELS.writer, messages: [{ role: "system", content: WRITER_SYSTEM }, { role: "user", content: writerPrompt(batch) }], maxTokens: 14000, json: true, reasoning: "low", timeoutMs: 300_000 },
      ctx,
    );
    if (rec.failure === "budget") {
      budgetStop = true;
      log("SPEND CAP reached: stopping generation");
      return;
    }
    const o = rec.ok ? parseJsonObject(rec.content) : null;
    const list = Array.isArray(o?.questions) ? (o!.questions as RawQuestion[]) : [];
    for (const slot of batch) {
      const raw = list.find((r) => r.slot === slot.id) ?? list[batch.indexOf(slot)];
      if (raw) generated.set(slot.id, toQuestion(slot, raw));
    }
    if ((i + 1) % 10 === 0 || !rec.ok) log(`writer ${i + 1}/${groups.length}${rec.ok ? "" : ` FAILED: ${rec.error}`} (${generated.size} questions)`);
  });
  log(`generated ${generated.size} of ${groups.reduce((s, b) => s + b.length, 0)} planned`);

  // 3. lint + numeric check (cheap) before the solve
  const toSolve: SatQuestion[] = [];
  for (const [id, g] of generated) {
    const reasons = questionIssues(g.q).map((r) => `lint: ${r}`);
    const cas = SatQuestionSchema.safeParse(g.q).success ? casCheck(g.q, g.verify) : null;
    if (cas?.result === "fail") reasons.push(`numeric check: ${cas.detail}`);
    if (!g.verify) reasons.push("no verify block from the writer");
    reviews.set(id, { status: "draft", reasons, cas, solve: null, distractors: g.distractors, source: "generated" });
    questions.set(id, g.q);
    if (!reasons.length) toSolve.push(g.q);
  }
  log(`lint + numeric: ${toSolve.length} go to the solver, ${generated.size - toSolve.length} draft`);

  // 4. independent solve
  let done = 0;
  await pool(toSolve, 8, async (q) => {
    if (budgetStop) return;
    const s = await independentSolve(q, ctx);
    const r = reviews.get(q.id)!;
    r.solve = { verdict: s.verdict, first: s.first, tiebreak: s.tiebreak };
    if (s.first.error === `spend cap $${SPEND_CAP_USD.toFixed(2)} reached` || s.tiebreak?.error?.startsWith("spend cap")) {
      budgetStop = true;
      r.reasons.push("not solved: spend cap reached");
    } else if (s.verdict !== "agree" && s.verdict !== "tiebreak") {
      r.reasons.push(
        `independent solve: ${s.verdict} (writer ${"key" in q.answer ? q.answer.key : q.answer.accepted[0]}; ${s.first.model} ${s.first.answer ?? s.first.error}${s.first.issues.length ? ` [${s.first.issues.join("; ")}]` : ""}; ${s.tiebreak?.model ?? "-"} ${s.tiebreak?.answer ?? s.tiebreak?.error ?? "-"}${s.tiebreak?.issues.length ? ` [${s.tiebreak.issues.join("; ")}]` : ""})`,
      );
    }
    if (++done % 50 === 0) log(`solved ${done}/${toSolve.length}`);
  });

  // 5. dedupe (samples first, then the plan's order)
  const order = [...samples.map((q) => q.id), ...plan.map((s) => s.id).filter((id) => questions.has(id) && !samples.some((q) => q.id === id))];
  const twins = nearDuplicates(order.map((id) => questions.get(id)!).filter(Boolean));
  for (const [id, of] of twins) reviews.get(id)?.reasons.push(`near-duplicate of ${of}`);

  // 6. status
  for (const [id, r] of reviews) {
    if (r.source === "generated" && !r.solve && !r.reasons.length) r.reasons.push("not solved");
    r.status = r.reasons.length ? "draft" : "live";
    questions.set(id, { ...questions.get(id)!, status: r.status });
  }
  writeOutputs(questions, reviews, ledger, startUsd, { planned: plan.length, batches: groups.length, generated: generated.size });
  log(`done: ${[...reviews.values()].filter((r) => r.status === "live").length} live, ${[...reviews.values()].filter((r) => r.status === "draft").length} draft`);
}

function writeOutputs(questions: Map<string, SatQuestion>, reviews: Map<string, Review>, ledger: SpendLedger, startUsd: number, counts: { planned: number; batches: number; generated: number }): void {
  mkdirSync(DATA_DIR, { recursive: true });
  const ids = [...questions.keys()].sort();
  const bank = ids.map((id) => questions.get(id)!);
  writeFileSync(join(DATA_DIR, "bank.json"), JSON.stringify(bank, null, 1) + "\n");
  writeFileSync(join(DATA_DIR, "review.json"), JSON.stringify(Object.fromEntries(ids.map((id) => [id, reviews.get(id)])), null, 1) + "\n");
  const live = bank.filter((q) => q.status === "live");
  const tally = (list: SatQuestion[], f: (q: SatQuestion) => string) => list.reduce<Record<string, number>>((m, q) => ((m[f(q)] = (m[f(q)] ?? 0) + 1), m), {});
  const reasonKinds = [...reviews.values()].flatMap((r) => r.reasons.map((x) => x.replace(/[:(].*$/, "").trim())).reduce<Record<string, number>>((m, k) => ((m[k] = (m[k] ?? 0) + 1), m), {});
  const report = {
    at: new Date().toISOString(),
    models: MODELS,
    planned: counts.planned,
    writer_batches: counts.batches,
    generated: counts.generated,
    samples: [...reviews.values()].filter((r) => r.source === "sample").length,
    total: bank.length,
    live: live.length,
    draft: bank.length - live.length,
    draft_reasons: reasonKinds,
    solve_verdicts: tally(bank.filter((q) => reviews.get(q.id)?.solve), (q) => reviews.get(q.id)!.solve!.verdict),
    numeric_check: tally(bank.filter((q) => reviews.get(q.id)?.cas), (q) => reviews.get(q.id)!.cas!.result),
    live_by_domain: tally(live, (q) => q.domain),
    live_by_skill: tally(live, (q) => q.skill),
    live_by_difficulty: tally(live, (q) => String(q.difficulty)),
    live_by_format: tally(live, (q) => q.format),
    live_by_figure: tally(live, (q) => q.figure?.kind ?? "none"),
    spend_usd: { total: Number(ledger.totalUsd.toFixed(4)), this_run: Number((ledger.totalUsd - startUsd).toFixed(4)), cap: SPEND_CAP_USD, by_model: ledger.snapshot.byModel },
  };
  writeFileSync(join(DATA_DIR, "report.json"), JSON.stringify(report, null, 1) + "\n");
}

if (process.argv[1]?.endsWith("pipeline.ts")) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
