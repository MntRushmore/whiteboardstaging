/**
 * The two crop readers the eval compares, each cached on disk and held under a hard call cap that
 * survives reruns (`.cache/mpx-text/ledger.json`):
 *
 *  - Mathpix `v3/text` (SuperNet-201): `recognizeImage`, the server's own call (src/lib/server/mathpix.ts:
 *    `improve_mathpix: false`, auto-rotation off, `include_line_data`), timed from here;
 *  - the vision fallback of /api/live/recognize: the route's model (`getLiveModels().vision`), its prompt
 *    (`buildVisionMessages`) and the body `chatJson` sends (`response_format: json_object`,
 *    `temperature: 0`, `max_tokens: 400`), through `openrouterChat` so the privacy preferences
 *    (`zdr`, `data_collection: deny`) are the production ones. One addition: `usage: {include: true}`,
 *    so OpenRouter reports what the call cost (it changes nothing the model sees).
 *
 * A cached answer is keyed by the sha-1 of the exact request (the image included), so a rerun is
 * free and reports the latency measured the first time. Keys are never logged.
 */
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { getLiveModels } from "@/lib/env";
import { buildTextBody, latexFromMathpixText, recognizeImage, unwrapMathText, type MathpixTextConfidences } from "@/lib/server/mathpix";
import { extractJsonObject, openrouterChat } from "@/lib/server/openrouter";
import { buildVisionMessages, VisionTranscriptionSchema } from "@/lib/server/prompts/recognizeVision";
import { repairJsonEscapes } from "@/lib/server/sse";

export const MPX_CACHE_DIR = resolve(__dirname, "..", ".cache", "mpx-text");

/** Every Mathpix call this eval may ever make (v3/text lines + worksheets + v3/pdf pages), across reruns. */
export const MAX_MATHPIX_CALLS = 400;
/** Every vision-model call this eval may ever make, across reruns. */
export const MAX_VISION_CALLS = 100;

/** Mathpix's list price, 2026-10 (mathpix.com/pricing/api): v3/text and v3/strokes $0.002 a call to 1M a month, v3/pdf $0.005 a page. */
export const MATHPIX_PRICE = { text: 0.002, strokes: 0.002, pdfPage: 0.005 } as const;

export interface Ledger {
  mathpixCalls: number;
  pdfPages: number;
  visionCalls: number;
  visionUsd: number;
}

export class CallLedger {
  readonly state: Ledger;
  constructor(private readonly file = join(MPX_CACHE_DIR, "ledger.json")) {
    this.state = existsSync(file) ? (JSON.parse(readFileSync(file, "utf8")) as Ledger) : { mathpixCalls: 0, pdfPages: 0, visionCalls: 0, visionUsd: 0 };
  }
  /** Takes one call of `kind`; false (nothing taken) when the cap is reached. */
  take(kind: "mathpix" | "vision"): boolean {
    if (kind === "mathpix" && this.state.mathpixCalls >= MAX_MATHPIX_CALLS) return false;
    if (kind === "vision" && this.state.visionCalls >= MAX_VISION_CALLS) return false;
    if (kind === "mathpix") this.state.mathpixCalls++;
    else this.state.visionCalls++;
    this.save();
    return true;
  }
  addVisionCost(usd: number): void {
    this.state.visionUsd += usd;
    this.save();
  }
  addPdfPages(n: number): void {
    this.state.pdfPages += n;
    this.save();
  }
  private save(): void {
    mkdirSync(dirname(this.file), { recursive: true });
    writeFileSync(this.file, JSON.stringify(this.state, null, 1) + "\n");
  }
}

const sha1 = (s: string) => createHash("sha1").update(s).digest("hex");
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

function readCache<T>(file: string): T | null {
  return existsSync(file) ? (JSON.parse(readFileSync(file, "utf8")) as T) : null;
}
function writeCache(file: string, value: unknown): void {
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify(value) + "\n");
}

// ---------------------------------------------------------------- Mathpix v3/text

export interface TextRead {
  ok: boolean;
  /** the LaTeX `recognizeImage` hands the route (`\\text{…}` round maths unwrapped) */
  latex: string;
  /** Mathpix's own LaTeX, before `unwrapMathText` */
  rawLatex: string;
  /** what `recognizeImage` reports (top-level `confidence`, else the lowest region's, else `confidence_rate`) */
  confidence: number;
  confidences: MathpixTextConfidences | null;
  /** how many `line_data` regions, and their types */
  regions: Array<{ type?: string; subtype?: string; conversion_output?: boolean; is_handwritten?: boolean; text?: string; confidence?: number | null; text_confidence?: number | null; layout_confidence?: number | null; confidence_rate?: number | null; cnt?: number[][] }>;
  isHandwritten?: boolean;
  version?: string;
  reason?: string;
  detail?: string;
  ms: number;
  at: string;
  cached?: boolean;
}

/** Least ms between two Mathpix request starts (Mathpix answers `http_max_requests` past ~200 a minute). */
let nextMathpixAt = 0;
async function mathpixTurn(minIntervalMs = 350): Promise<void> {
  const now = Date.now();
  const at = Math.max(now, nextMathpixAt);
  nextMathpixAt = at + minIntervalMs;
  if (at > now) await sleep(at - now);
}

/** v3/text on one image, from the cache when this exact request was made before. */
export async function readWithMathpixText(dataUrl: string, ledger: CallLedger, cacheDir = MPX_CACHE_DIR): Promise<TextRead> {
  const file = join(cacheDir, "text", `${sha1(JSON.stringify(buildTextBody(dataUrl)))}.json`);
  const hit = readCache<TextRead>(file);
  // answers cached before `unwrapMathText` existed hold Mathpix's own LaTeX in `latex`
  if (hit) return { ...hit, rawLatex: hit.rawLatex ?? hit.latex, latex: unwrapMathText(hit.latex), cached: true };
  let out: TextRead | null = null;
  for (let attempt = 0; attempt < 2; attempt++) {
    if (!ledger.take("mathpix")) return { ok: false, latex: "", rawLatex: "", confidence: 0, confidences: null, regions: [], reason: "budget", ms: 0, at: new Date().toISOString() };
    await mathpixTurn();
    const started = performance.now();
    const res = await recognizeImage(dataUrl, undefined, { timeoutMs: 20_000, log: { warn: () => {} } });
    const ms = Math.round(performance.now() - started);
    if (res.ok) {
      out = {
        ok: true,
        latex: res.latex,
        rawLatex: latexFromMathpixText(res.raw, { unwrap: false }),
        confidence: res.confidence,
        confidences: res.confidences,
        regions: (res.raw.line_data ?? []).map((l) => ({ type: l.type, subtype: l.subtype, conversion_output: l.conversion_output ?? l.included, is_handwritten: l.is_handwritten, text: l.text, confidence: l.confidence, text_confidence: l.text_confidence, layout_confidence: l.layout_confidence, confidence_rate: l.confidence_rate, cnt: l.cnt })),
        isHandwritten: res.raw.is_handwritten,
        version: res.raw.version,
        ms,
        at: new Date().toISOString(),
      };
      break;
    }
    out = { ok: false, latex: "", rawLatex: "", confidence: 0, confidences: null, regions: [], reason: res.reason, detail: res.detail, ms, at: new Date().toISOString() };
    // a transport blip or a rate limit is retried once; Mathpix saying it cannot read it is an answer
    if (res.reason === "api_error" || res.reason === "auth" || res.reason === "unconfigured" || res.reason === "invalid_payload") break;
    await sleep(res.status === 429 || /max_requests|limit/i.test(res.detail ?? "") ? 61_000 : 2_000);
  }
  if (out && (out.ok || out.reason === "api_error")) writeCache(file, out);
  return out!;
}

// ---------------------------------------------------------------- the vision fallback

export interface VisionRead {
  ok: boolean;
  latex: string;
  confidence: number;
  isMath?: boolean;
  model: string;
  provider?: string;
  reason?: string;
  ms: number;
  costUsd: number;
  promptTokens?: number;
  completionTokens?: number;
  at: string;
  cached?: boolean;
}

/** The body `chatJson` sends for the recognize route's vision read, plus `usage: {include: true}`. */
export function visionBody(dataUrl: string, model = getLiveModels().vision): Record<string, unknown> {
  return {
    model,
    messages: buildVisionMessages(dataUrl),
    response_format: { type: "json_object" },
    temperature: 0,
    max_tokens: 400,
    usage: { include: true },
  };
}

/** The route's vision read of one crop, from the cache when this exact request was made before. */
export async function readWithVision(dataUrl: string, ledger: CallLedger, cacheDir = MPX_CACHE_DIR): Promise<VisionRead> {
  const body = visionBody(dataUrl);
  const model = String(body.model);
  const file = join(cacheDir, "vision", `${sha1(JSON.stringify(body))}.json`);
  const hit = readCache<VisionRead>(file);
  if (hit) return { ...hit, cached: true };
  let out: VisionRead | null = null;
  for (let attempt = 0; attempt < 2; attempt++) {
    if (!ledger.take("vision")) return { ok: false, latex: "", confidence: 0, model, reason: "budget", ms: 0, costUsd: 0, at: new Date().toISOString() };
    const started = performance.now();
    try {
      const data = (await openrouterChat(body, { signal: AbortSignal.timeout(20_000), title: "Agathon eval - mpx-text vision" })) as Awaited<ReturnType<typeof openrouterChat>> & { usage?: { cost?: number } };
      const ms = Math.round(performance.now() - started);
      const cost = typeof data.usage?.cost === "number" ? data.usage.cost : 0;
      ledger.addVisionCost(cost);
      const raw = data.choices?.[0]?.message?.content;
      const text = typeof raw === "string" ? raw : "";
      let parsed: unknown = null;
      try {
        parsed = JSON.parse(repairJsonEscapes(extractJsonObject(text)));
      } catch {
        parsed = null;
      }
      const v = VisionTranscriptionSchema.safeParse(parsed);
      out = v.success
        ? { ok: true, latex: v.data.latex.replace(/^\$+|\$+$/g, "").trim(), confidence: v.data.confidence, isMath: v.data.isMath, model, provider: data.provider, ms, costUsd: cost, promptTokens: data.usage?.prompt_tokens, completionTokens: data.usage?.completion_tokens, at: new Date().toISOString() }
        : { ok: false, latex: "", confidence: 0, model, provider: data.provider, reason: "invalid_json", ms, costUsd: cost, at: new Date().toISOString() };
      break;
    } catch (err) {
      const ms = Math.round(performance.now() - started);
      out = { ok: false, latex: "", confidence: 0, model, reason: err instanceof Error ? `${err.name}: ${err.message.slice(0, 120)}` : "error", ms, costUsd: 0, at: new Date().toISOString() };
      await sleep(2_000);
    }
  }
  // only answers are cached (a reply, or a reply that was not JSON), never a transport failure
  if (out && (out.ok || out.reason === "invalid_json")) writeCache(file, out);
  return out!;
}

/** Runs `work` over `items` with at most `limit` in flight, results in input order. */
export async function pool<T, R>(items: readonly T[], limit: number, work: (item: T, i: number) => Promise<R>): Promise<R[]> {
  const out = new Array<R>(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (next < items.length) {
        const i = next++;
        out[i] = await work(items[i], i);
      }
    }),
  );
  return out;
}
