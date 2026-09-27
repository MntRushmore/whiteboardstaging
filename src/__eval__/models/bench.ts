/**
 * The model bench: three jobs × the candidate models, run under one spend cap.
 *
 *   1. word    word problem → equations; the local engine solves the setup   (wordProblems.ts)
 *   2. fallback  the product's solve prompt on maths the engine cannot do     (fallback.ts)
 *   3. repair  image + Mathpix's LaTeX → corrected LaTeX (vision)             (misreads.ts)
 *
 * Order of work: every model is PILOTED on the first 5 items of each job; a model whose pilot
 * calls all fail (it rejects the request, times out, returns nothing) is dropped from that job.
 * The pilot's real cost per call then projects the rest of the run; when the projection does not
 * fit the budget left, the incumbents run on fewer items first, then everyone is scaled down.
 * At most `CONCURRENCY` calls are in flight; every response is cached (client.ts).
 */
import type { LiveEngine } from "@/lib/live/contracts";
import { callModel, cachedCall, pool, worstCaseUsd, type BenchMessage, type CallContext, type CallRecord, type CallSpec, type ModelInfo } from "./client";
import { fallbackMessages, scoreFallbackReply, selectFallbackProblems, type FallbackProblem, type FallbackScore } from "./fallback";
import { buildReadItems, inkPng, repairMessages, scoreRepairReply, type ReadItem, type ReadScore } from "./misreads";
import { scoreWordReply, WORD_PROBLEMS, wordSetupMessages, type WordProblem, type WordScore } from "./wordProblems";

export const TEXT_MODELS = [
  "deepseek/deepseek-v4.1-flash",
  "qwen/qwen3.8-flash",
  "openai/gpt-5.4-nano",
  "google/gemini-3.5-flash-lite",
  "google/gemini-3.1-flash-lite",
  "openai/gpt-5.4-mini",
  "anthropic/claude-haiku-4.5",
  "google/gemini-3.5-flash",
  "anthropic/claude-sonnet-5",
] as const;

export const VISION_MODELS = [
  "google/gemini-3.1-flash-lite",
  "google/gemini-3.5-flash-lite",
  "qwen/qwen3.8-flash",
  "openai/gpt-5.4-nano",
  "deepseek/deepseek-v4.1-flash",
  "anthropic/claude-haiku-4.5",
] as const;

/** Today's production picks (LIVE_MODELS): run on fewer items first when the budget is tight. */
export const INCUMBENTS: ReadonlySet<string> = new Set(["google/gemini-3.5-flash", "anthropic/claude-sonnet-5"]);
export const INCUMBENT_ITEMS = 15;
export const PILOT_ITEMS = 5;
export const CONCURRENCY = 4;
/** the owner's approval is $5.00; every call stops before $4.50 */
export const SPEND_CAP_USD = 4.5;

export type JobId = "word" | "fallback" | "repair";
export const JOB_TITLE: Record<JobId, string> = {
  word: "Word problems → equations (engine solves)",
  fallback: "Solve fallback (maths the engine cannot do)",
  repair: "Misread repair (vision)",
};

export interface JobSettings {
  maxTokens: number;
  json: boolean;
  reasoning: (model: string) => CallSpec["reasoning"];
  timeoutMs: number;
}

/**
 * Word and fallback mirror /api/live/solve (`reasoning: low`, 1500 tokens). Repair mirrors the
 * recognizer's vision call (JSON mode) with the least reasoning the model offers; Anthropic
 * models get none at all (their thinking is off by default, and a thinking budget is ≥ 1024).
 */
export const JOB_SETTINGS: Record<JobId, JobSettings> = {
  word: { maxTokens: 1500, json: true, reasoning: () => "low", timeoutMs: 60_000 },
  fallback: { maxTokens: 1500, json: false, reasoning: () => "low", timeoutMs: 60_000 },
  repair: { maxTokens: 800, json: true, reasoning: (m) => (m.startsWith("anthropic/") ? null : "minimal"), timeoutMs: 45_000 },
};

export type ItemScore = { kind: "word"; score: WordScore } | { kind: "fallback"; score: FallbackScore } | { kind: "repair"; score: ReadScore };

export interface ItemResult {
  job: JobId;
  model: string;
  itemId: string;
  call: Omit<CallRecord, "content">;
  content: string;
  /** null when the call itself failed (no reply to score) */
  score: ItemScore | null;
}

interface JobItem {
  id: string;
  messages: BenchMessage[];
  score: (content: string) => Promise<ItemScore>;
}

export interface BenchPlan {
  job: JobId;
  model: string;
  /** items planned (after the budget projection) */
  items: number;
  /** why it is fewer than the job has, or why the model is out */
  note?: string;
  excluded?: boolean;
}

export interface BenchRun {
  results: ItemResult[];
  plans: BenchPlan[];
  missing: string[];
  jobs: { word: WordProblem[]; fallback: FallbackProblem[]; repair: ReadItem[] };
  imageBytes: { min: number; max: number; mean: number };
}

export interface BenchOptions {
  catalog: Map<string, ModelInfo>;
  ctx: CallContext;
  engine: LiveEngine;
  /** at most this many items per job (a manual pilot) */
  limit?: number;
  /** only these models */
  models?: readonly string[];
  jobs?: readonly JobId[];
  log?: (line: string) => void;
}

function buildJobs(engine: LiveEngine, limit: number | undefined) {
  const cap = <T>(xs: T[]) => (limit ? xs.slice(0, limit) : xs);
  const word = cap([...WORD_PROBLEMS]);
  const fallback = cap(selectFallbackProblems(engine));
  const repair = cap(buildReadItems());
  const images = new Map(repair.map((it) => [it.id, inkPng(it)]));
  const items: Record<JobId, JobItem[]> = {
    word: word.map((p) => ({ id: p.id, messages: wordSetupMessages(p), score: async (c) => ({ kind: "word", score: scoreWordReply(engine, p, c) }) })),
    fallback: fallback.map((p) => ({ id: p.id, messages: fallbackMessages(engine, p), score: async (c) => ({ kind: "fallback", score: await scoreFallbackReply(engine, p, c) }) })),
    repair: repair.map((it) => ({ id: it.id, messages: repairMessages(it, images.get(it.id)!.dataUrl), score: async (c) => ({ kind: "repair", score: scoreRepairReply(it, c) }) })),
  };
  const sizes = [...images.values()].map((i) => i.bytes);
  const imageBytes = sizes.length > 0 ? { min: Math.min(...sizes), max: Math.max(...sizes), mean: Math.round(sizes.reduce((a, b) => a + b, 0) / sizes.length) } : { min: 0, max: 0, mean: 0 };
  return { items, data: { word, fallback, repair }, imageBytes };
}

function specFor(job: JobId, model: string, messages: BenchMessage[]): CallSpec {
  const s = JOB_SETTINGS[job];
  return { model, messages, maxTokens: s.maxTokens, json: s.json, reasoning: s.reasoning(model), timeoutMs: s.timeoutMs };
}

const API_FAILURES = new Set(["http", "timeout", "network", "empty"]);

export async function runBench(opts: BenchOptions): Promise<BenchRun> {
  const log = opts.log ?? (() => {});
  const { items, data, imageBytes } = buildJobs(opts.engine, opts.limit);
  const jobs = (opts.jobs ?? (["word", "fallback", "repair"] as const)).filter((j) => items[j].length > 0);
  const wanted = (list: readonly string[]) => list.filter((m) => !opts.models || opts.models.includes(m));
  const missing = [...new Set([...TEXT_MODELS, ...VISION_MODELS])].filter((m) => !opts.catalog.has(m));

  const plans: BenchPlan[] = [];
  for (const job of jobs) {
    const list = job === "repair" ? wanted(VISION_MODELS) : wanted(TEXT_MODELS);
    for (const model of list) {
      const info = opts.catalog.get(model);
      if (!info) plans.push({ job, model, items: 0, excluded: true, note: "not on OpenRouter" });
      else if (job === "repair" && !info.images) plans.push({ job, model, items: 0, excluded: true, note: "no image input" });
      else plans.push({ job, model, items: items[job].length });
    }
  }

  const results = new Map<string, ItemResult>();
  const runCalls = async (tasks: Array<{ plan: BenchPlan; item: JobItem }>) => {
    let done = 0;
    await pool(tasks, CONCURRENCY, async ({ plan, item }) => {
      const key = `${plan.job}|${plan.model}|${item.id}`;
      if (results.has(key)) return;
      const call = await callModel(specFor(plan.job, plan.model, item.messages), opts.ctx);
      const score = call.ok ? await item.score(call.content) : null;
      const { content, ...rest } = call;
      results.set(key, { job: plan.job, model: plan.model, itemId: item.id, call: rest, content, score });
      done++;
      if (!call.cached) log(`[${done}/${tasks.length}] ${plan.job} ${plan.model} ${item.id}: ${call.ok ? "ok" : call.failure} ${call.latencyMs} ms $${call.costUsd.toFixed(5)} (spent $${opts.ctx.ledger.totalUsd.toFixed(4)})`);
    });
  };

  // 1. pilot
  const active = plans.filter((p) => !p.excluded);
  await runCalls(active.flatMap((plan) => items[plan.job].slice(0, PILOT_ITEMS).map((item) => ({ plan, item }))));
  for (const plan of active) {
    const pilot = items[plan.job].slice(0, PILOT_ITEMS).map((it) => results.get(`${plan.job}|${plan.model}|${it.id}`)).filter((r): r is ItemResult => Boolean(r));
    const failed = pilot.filter((r) => r.call.failure && API_FAILURES.has(r.call.failure));
    if (pilot.length > 0 && failed.length === pilot.length) {
      plan.excluded = true;
      plan.items = pilot.length;
      plan.note = `pilot failed: ${failed[0].call.error ?? failed[0].call.failure}`;
    }
  }

  // 2. project the rest from the pilot's real cost; shrink incumbents, then everyone, to fit
  const remaining = () => opts.ctx.ledger.capUsd - opts.ctx.ledger.totalUsd;
  const perCall = (plan: BenchPlan) => {
    const pilot = items[plan.job].slice(0, PILOT_ITEMS).map((it) => results.get(`${plan.job}|${plan.model}|${it.id}`)?.call.costUsd ?? 0);
    const mean = pilot.reduce((a, b) => a + b, 0) / Math.max(1, pilot.length);
    const info = opts.catalog.get(plan.model)!;
    // never trust a pilot of cached zeros: at least a third of the worst case
    return Math.max(mean, worstCaseUsd(specFor(plan.job, plan.model, items[plan.job][0].messages), info) / 3);
  };
  const uncached = (plan: BenchPlan, upto: number) =>
    items[plan.job].slice(PILOT_ITEMS, upto).filter((it) => !cachedCall(specFor(plan.job, plan.model, it.messages), opts.ctx)).length;
  const projected = () => active.filter((p) => !p.excluded).reduce((sum, p) => sum + uncached(p, p.items) * perCall(p), 0);
  const budget = remaining() * 0.9;
  if (projected() > budget) {
    for (const p of active) {
      if (!p.excluded && INCUMBENTS.has(p.model) && p.items > INCUMBENT_ITEMS) {
        p.items = INCUMBENT_ITEMS;
        p.note = `incumbent: ${INCUMBENT_ITEMS} items to fit the budget`;
      }
    }
  }
  const after = projected();
  if (after > budget) {
    const f = budget / after;
    for (const p of active) {
      if (p.excluded) continue;
      const n = Math.max(PILOT_ITEMS, Math.floor(PILOT_ITEMS + (p.items - PILOT_ITEMS) * f));
      if (n < p.items) {
        p.items = n;
        p.note = `${n} items to fit the budget`;
      }
    }
  }
  log(`pilot done: spent $${opts.ctx.ledger.totalUsd.toFixed(4)}, projected rest $${projected().toFixed(4)}, left $${remaining().toFixed(4)}`);

  // 3. the rest
  await runCalls(active.filter((p) => !p.excluded).flatMap((plan) => items[plan.job].slice(PILOT_ITEMS, plan.items).map((item) => ({ plan, item }))));

  const ordered: ItemResult[] = [];
  for (const plan of plans) for (const item of items[plan.job]) {
    const r = results.get(`${plan.job}|${plan.model}|${item.id}`);
    if (r) ordered.push(r);
  }
  return { results: ordered, plans, missing, jobs: data, imageBytes };
}
