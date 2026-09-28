/**
 * The model bench's OpenRouter client: one non-streaming chat completion per call, cached on disk,
 * timed, priced, and held under a hard spend cap that survives reruns.
 *
 *  - the catalog (`/api/v1/models`: ids, prices, supported parameters, input modalities) is
 *    fetched once per run and kept in `.cache/models/catalog.json` as a fallback;
 *  - every response is cached under `.cache/models/<model>/<sha1 of the request body>.json`, so a
 *    rerun costs nothing and reports the latency measured the first time;
 *  - `SpendLedger` keeps the running total in `.cache/models/spend.json`. Before a call it
 *    RESERVES the call's worst case (prompt estimate + `max_tokens` at the completion price) and
 *    refuses when the total would pass the cap; afterwards it settles to the real cost
 *    (`usage.cost` from OpenRouter, else tokens × catalog price). A call that timed out keeps its
 *    worst-case reservation: it may still have been billed.
 *
 * The API key is read from `process.env.OPENROUTER_API_KEY` at call time and never logged.
 */
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

export const MODELS_CACHE_DIR = resolve(__dirname, "..", ".cache", "models");
const CATALOG_URL = "https://openrouter.ai/api/v1/models";
const CHAT_URL = "https://openrouter.ai/api/v1/chat/completions";

// ---------------------------------------------------------------- catalog

export interface ModelInfo {
  id: string;
  /** USD per token */
  promptPrice: number;
  completionPrice: number;
  /** USD per image, when the catalog prices images separately (0 otherwise) */
  imagePrice: number;
  temperature: boolean;
  responseFormat: boolean;
  reasoning: boolean;
  images: boolean;
}

interface RawModel {
  id: string;
  pricing?: Record<string, string>;
  supported_parameters?: string[];
  architecture?: { input_modalities?: string[] };
}

function toInfo(m: RawModel): ModelInfo {
  const price = (k: string) => {
    const n = Number(m.pricing?.[k] ?? 0);
    return Number.isFinite(n) && n > 0 ? n : 0;
  };
  const params = new Set(m.supported_parameters ?? []);
  return {
    id: m.id,
    promptPrice: price("prompt"),
    completionPrice: price("completion"),
    imagePrice: price("image"),
    temperature: params.has("temperature"),
    responseFormat: params.has("response_format"),
    reasoning: params.has("reasoning"),
    images: (m.architecture?.input_modalities ?? []).includes("image"),
  };
}

/** The OpenRouter catalog, fetched now (and saved), or the last saved copy when offline. */
export async function loadCatalog(cacheDir = MODELS_CACHE_DIR): Promise<{ models: Map<string, ModelInfo>; fetchedAt: string; live: boolean }> {
  const file = join(cacheDir, "catalog.json");
  try {
    const res = await fetch(CATALOG_URL, { signal: AbortSignal.timeout(20_000) });
    if (!res.ok) throw new Error(`catalog ${res.status}`);
    const body = (await res.json()) as { data: RawModel[] };
    const fetchedAt = new Date().toISOString();
    mkdirSync(cacheDir, { recursive: true });
    writeFileSync(file, JSON.stringify({ fetchedAt, data: body.data.map(toInfo) }) + "\n");
    return { models: new Map(body.data.map((m) => [m.id, toInfo(m)])), fetchedAt, live: true };
  } catch (err) {
    if (!existsSync(file)) throw err;
    const saved = JSON.parse(readFileSync(file, "utf8")) as { fetchedAt: string; data: ModelInfo[] };
    return { models: new Map(saved.data.map((m) => [m.id, m])), fetchedAt: saved.fetchedAt, live: false };
  }
}

// ---------------------------------------------------------------- spend

export interface SpendState {
  totalUsd: number;
  calls: number;
  byModel: Record<string, { usd: number; calls: number }>;
}

/** Running OpenRouter spend on disk, with reservations so concurrent calls cannot overshoot. */
export class SpendLedger {
  private state: SpendState;
  private reserved = 0;
  constructor(
    readonly capUsd: number,
    private readonly file = join(MODELS_CACHE_DIR, "spend.json"),
  ) {
    this.state = existsSync(file) ? (JSON.parse(readFileSync(file, "utf8")) as SpendState) : { totalUsd: 0, calls: 0, byModel: {} };
  }
  get totalUsd(): number {
    return this.state.totalUsd;
  }
  get snapshot(): SpendState {
    return JSON.parse(JSON.stringify(this.state)) as SpendState;
  }
  /** Reserve a call's worst case; false (and nothing reserved) when it could pass the cap. */
  reserve(usd: number): boolean {
    if (this.state.totalUsd + this.reserved + usd > this.capUsd) return false;
    this.reserved += usd;
    return true;
  }
  /** Replace a reservation with what the call really cost. */
  settle(model: string, reservedUsd: number, actualUsd: number): void {
    this.reserved = Math.max(0, this.reserved - reservedUsd);
    this.state.totalUsd += actualUsd;
    this.state.calls += 1;
    const m = (this.state.byModel[model] ??= { usd: 0, calls: 0 });
    m.usd += actualUsd;
    m.calls += 1;
    mkdirSync(dirname(this.file), { recursive: true });
    writeFileSync(this.file, JSON.stringify(this.state, null, 1) + "\n");
  }
}

// ---------------------------------------------------------------- calls

export type ContentPart = { type: "text"; text: string } | { type: "image_url"; image_url: { url: string } };
export interface BenchMessage {
  role: "system" | "user" | "assistant";
  content: string | ContentPart[];
}

export interface CallSpec {
  model: string;
  messages: BenchMessage[];
  maxTokens: number;
  /** ask for `response_format: json_object` (only where the model supports it) */
  json: boolean;
  /** OpenRouter unified reasoning effort; null leaves the model's default */
  reasoning: "minimal" | "low" | "medium" | null;
  timeoutMs: number;
}

export type CallFailure = "http" | "timeout" | "network" | "budget" | "empty";

export interface CallRecord {
  model: string;
  key: string;
  ok: boolean;
  failure?: CallFailure;
  error?: string;
  status?: number;
  content: string;
  latencyMs: number;
  promptTokens: number;
  completionTokens: number;
  reasoningTokens: number;
  costUsd: number;
  costSource: "usage" | "estimate" | "reserved" | "none";
  provider?: string;
  finishReason?: string;
  attempts: number;
  at: string;
  cached: boolean;
}

export interface CallContext {
  catalog: Map<string, ModelInfo>;
  ledger: SpendLedger;
  cacheDir?: string;
  /** injectable for tests */
  fetchImpl?: typeof fetch;
}

/** What the request body looks like for this model (parameters it does not support are left out). */
export function buildBody(spec: CallSpec, info: ModelInfo | undefined): Record<string, unknown> {
  const body: Record<string, unknown> = {
    model: spec.model,
    messages: spec.messages,
    max_tokens: spec.maxTokens,
    usage: { include: true },
    provider: { sort: "latency" },
  };
  if (!info || info.temperature) body.temperature = 0;
  if (spec.json && (!info || info.responseFormat)) body.response_format = { type: "json_object" };
  if (spec.reasoning && (!info || info.reasoning)) body.reasoning = { effort: spec.reasoning };
  return body;
}

export function requestKey(body: Record<string, unknown>): string {
  return createHash("sha1").update(JSON.stringify(body)).digest("hex");
}

function cacheFile(cacheDir: string, model: string, key: string): string {
  return join(cacheDir, model.replace(/[^a-zA-Z0-9._-]+/g, "_"), `${key}.json`);
}

function chars(messages: BenchMessage[]): { text: number; images: number } {
  let text = 0;
  let images = 0;
  for (const m of messages) {
    if (typeof m.content === "string") text += m.content.length;
    else
      for (const p of m.content) {
        if (p.type === "text") text += p.text.length;
        else images++;
      }
  }
  return { text, images };
}

/** Worst case of one call: the prompt (≈ 3 chars a token, 1600 tokens an image) + every allowed output token. */
export function worstCaseUsd(spec: CallSpec, info: ModelInfo): number {
  const c = chars(spec.messages);
  const promptTokens = c.text / 3 + c.images * 1600;
  return promptTokens * info.promptPrice + c.images * info.imagePrice + spec.maxTokens * info.completionPrice;
}

interface ChatResponse {
  choices?: Array<{ message?: { content?: unknown }; finish_reason?: string }>;
  usage?: { prompt_tokens?: number; completion_tokens?: number; cost?: number; completion_tokens_details?: { reasoning_tokens?: number } };
  provider?: string;
  error?: { message?: string; code?: number | string };
}

function textOf(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) return content.map((p) => (typeof p === "string" ? p : typeof p?.text === "string" ? p.text : "")).join("");
  return "";
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** The cached answer to exactly this request, or null (no network, no spend). */
export function cachedCall(spec: CallSpec, ctx: Pick<CallContext, "catalog" | "cacheDir">): CallRecord | null {
  const body = buildBody(spec, ctx.catalog.get(spec.model));
  const file = cacheFile(ctx.cacheDir ?? MODELS_CACHE_DIR, spec.model, requestKey(body));
  return existsSync(file) ? { ...(JSON.parse(readFileSync(file, "utf8")) as CallRecord), cached: true } : null;
}

/**
 * One chat completion: from the cache when this exact request was made before, otherwise over
 * the network (one retry on a 429 / 5xx / network error / timeout), under the spend cap.
 */
export async function callModel(spec: CallSpec, ctx: CallContext): Promise<CallRecord> {
  const cacheDir = ctx.cacheDir ?? MODELS_CACHE_DIR;
  const info = ctx.catalog.get(spec.model);
  const body = buildBody(spec, info);
  const key = requestKey(body);
  const file = cacheFile(cacheDir, spec.model, key);
  if (existsSync(file)) return { ...(JSON.parse(readFileSync(file, "utf8")) as CallRecord), cached: true };

  const base = { model: spec.model, key, content: "", latencyMs: 0, promptTokens: 0, completionTokens: 0, reasoningTokens: 0, attempts: 0, cached: false };
  if (!info) return { ...base, ok: false, failure: "http", error: "model not in the OpenRouter catalog", costUsd: 0, costSource: "none", at: new Date().toISOString() };
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) throw new Error("OPENROUTER_API_KEY is not set");

  const doFetch = ctx.fetchImpl ?? fetch;
  let record: CallRecord | null = null;
  for (let attempt = 1; attempt <= 2; attempt++) {
    const worst = worstCaseUsd(spec, info);
    if (!ctx.ledger.reserve(worst)) {
      // not cached: a later run with budget left may make this call
      return { ...base, attempts: attempt - 1, ok: false, failure: "budget", error: `spend cap $${ctx.ledger.capUsd.toFixed(2)} reached`, costUsd: 0, costSource: "none", at: new Date().toISOString() };
    }
    const started = performance.now();
    let res: Response | null = null;
    let data: ChatResponse | null = null;
    let failure: CallFailure | null = null;
    let error = "";
    try {
      res = await doFetch(CHAT_URL, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
          "HTTP-Referer": "http://localhost:3000",
          "X-Title": "Agathon model bench",
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(spec.timeoutMs),
      });
      data = (await res.json().catch(() => ({}))) as ChatResponse;
      if (!res.ok || data.error) {
        failure = "http";
        error = (data.error?.message ?? `HTTP ${res.status}`).slice(0, 300);
      }
    } catch (err) {
      const name = err instanceof Error ? err.name : "";
      failure = name === "TimeoutError" || name === "AbortError" ? "timeout" : "network";
      error = err instanceof Error ? err.message.slice(0, 300) : String(err);
    }
    const latencyMs = Math.round(performance.now() - started);
    const usage = data?.usage;
    const promptTokens = usage?.prompt_tokens ?? 0;
    const completionTokens = usage?.completion_tokens ?? 0;
    let costUsd: number;
    let costSource: CallRecord["costSource"];
    if (typeof usage?.cost === "number") {
      costUsd = usage.cost;
      costSource = "usage";
    } else if (usage) {
      costUsd = promptTokens * info.promptPrice + completionTokens * info.completionPrice;
      costSource = "estimate";
    } else if (failure === "timeout" || failure === "network") {
      costUsd = worst; // may have been billed: keep the worst case on the books
      costSource = "reserved";
    } else {
      costUsd = 0;
      costSource = "none";
    }
    ctx.ledger.settle(spec.model, worst, costUsd);
    const content = textOf(data?.choices?.[0]?.message?.content);
    if (!failure && !content.trim()) {
      failure = "empty";
      error = `empty content (finish ${data?.choices?.[0]?.finish_reason ?? "?"})`;
    }
    record = {
      ...base,
      ok: failure === null,
      failure: failure ?? undefined,
      error: failure ? error : undefined,
      status: res?.status,
      content,
      latencyMs,
      promptTokens,
      completionTokens,
      reasoningTokens: usage?.completion_tokens_details?.reasoning_tokens ?? 0,
      costUsd,
      costSource,
      provider: data?.provider,
      finishReason: data?.choices?.[0]?.finish_reason,
      attempts: attempt,
      at: new Date().toISOString(),
    };
    const transient = failure === "timeout" || failure === "network" || (failure === "http" && (res?.status === 429 || (res?.status ?? 0) >= 500));
    if (!transient || attempt === 2) break;
    await sleep(2_000);
  }
  // Answers and model-side failures are cached (a rerun is free and stable); a cap refusal is not.
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify(record) + "\n");
  return record!;
}

/** Runs `work` over `items` with at most `limit` in flight, results in input order. */
export async function pool<T, R>(items: readonly T[], limit: number, work: (item: T, index: number) => Promise<R>): Promise<R[]> {
  const out = new Array<R>(items.length);
  let next = 0;
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await work(items[i], i);
    }
  });
  await Promise.all(runners);
  return out;
}
