import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { resetServerEnvCache } from "@/lib/env";
import { LIVE_MODELS } from "@/lib/live/contracts";
import { PROVIDER_PRIVACY, TEXT_MODELS, UpstreamError, openrouterChat, streamChatText } from "@/lib/server/openrouter";
import { loadEnvLocal } from "../handwriting";

/**
 * PROVIDER PRIVACY probe: does every model the server uses still answer when OpenRouter may only
 * route to providers that neither train on nor keep what we send (PROVIDER_PRIVACY in
 * src/lib/server/openrouter.ts)? One tiny real request per model through the production
 * `openrouterChat` (so the exact body the routes send, privacy preferences merged in the same
 * place), a picture for every model a picture-reading route uses, the stream path for the check
 * and solve pairs, and a control: a model with no Zero Data Retention endpoint must be REFUSED,
 * which proves the preference is enforced rather than ignored.
 *
 *   npm run eval:privacy        RUN_PRIVACY_EVAL=1 EVAL_WRITE=1 (writes docs/eval/privacy.md)
 *
 * Costs well under a cent. Offline (every `vitest run`) it only checks that the probe covers every
 * model id the server can use by default.
 */
const RUN = process.env.RUN_PRIVACY_EVAL === "1";
const WRITE = process.env.EVAL_WRITE === "1";
const ROOT = resolve(__dirname, "..", "..", "..");

/** Every model id the server uses by default (LIVE_MODELS and TEXT_MODELS), once each. */
export function serverModels(): string[] {
  return [...new Set([...Object.values(LIVE_MODELS), ...Object.values(TEXT_MODELS)])].sort();
}

/** The models a picture-reading route sends images to (check, recognize, reread, figure, proof, setup). */
const IMAGE_MODELS = new Set<string>([
  LIVE_MODELS.check,
  LIVE_MODELS.checkFallback,
  LIVE_MODELS.vision,
  LIVE_MODELS.reread,
  LIVE_MODELS.rereadFallback,
  LIVE_MODELS.figure,
  LIVE_MODELS.figureFallback,
  LIVE_MODELS.proof,
  LIVE_MODELS.proofFallback,
  LIVE_MODELS.setup,
  LIVE_MODELS.setupFallback,
]);

/** Streamed (POST /api/live/check, /api/live/solve). */
const STREAM_MODELS = new Set<string>([LIVE_MODELS.check, LIVE_MODELS.checkFallback, LIVE_MODELS.solve, LIVE_MODELS.solveFallback]);

/** A model with no ZDR endpoint on OpenRouter (2026-10-03): the request must fail, not be served. */
const NO_ZDR_CONTROL = "qwen/qwen3.7-flash";

/** A 24×24 red square (PNG), so a picture-reading endpoint has something real to read. */
const RED_SQUARE_PNG =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABgAAAAYCAIAAABvFaqvAAAAH0lEQVR42mO4o6ZGFcQwatCoQaMGjRo0atCoQQNvEAAd/5ofg/DAowAAAABJRU5ErkJggg==";

/** Reasoning as the routes set it: none for Anthropic's (their budget starts at 1024 tokens). */
function reasoningFor(model: string): Record<string, unknown> {
  return model.startsWith("anthropic/") ? {} : { reasoning: { effort: "minimal" } };
}

/** Room for the reply (and, for the models that always reason, their thinking). */
function maxTokensFor(model: string): number {
  return model === LIVE_MODELS.sketchFallback ? 2048 : 256;
}

type Probe = { ok: boolean; provider: string | null; ms: number; detail: string };

async function probe(body: Record<string, unknown>): Promise<Probe> {
  const started = Date.now();
  try {
    const data = await openrouterChat(body, { title: "Agathon privacy probe", signal: AbortSignal.timeout(60_000) });
    const content = data.choices?.[0]?.message?.content;
    const text = typeof content === "string" ? content : JSON.stringify(content ?? "");
    return { ok: text.trim().length > 0, provider: data.provider ?? null, ms: Date.now() - started, detail: text.trim().slice(0, 40) };
  } catch (err) {
    const status = err instanceof UpstreamError ? err.status : null;
    return { ok: false, provider: null, ms: Date.now() - started, detail: `${status ?? ""} ${err instanceof Error ? err.message : String(err)}`.trim().slice(0, 160) };
  }
}

async function probeStream(model: string): Promise<Probe> {
  const started = Date.now();
  try {
    let text = "";
    for await (const part of streamChatText({
      model,
      messages: [{ role: "user", content: "Reply with the single word: ok" }],
      maxTokens: maxTokensFor(model),
      reasoningEffort: model.startsWith("anthropic/") ? undefined : "minimal",
      signal: AbortSignal.timeout(60_000),
      title: "Agathon privacy probe",
    })) text += part;
    return { ok: text.trim().length > 0, provider: null, ms: Date.now() - started, detail: text.trim().slice(0, 40) };
  } catch (err) {
    return { ok: false, provider: null, ms: Date.now() - started, detail: err instanceof Error ? err.message.slice(0, 160) : String(err) };
  }
}

describe("eval: provider privacy (offline)", () => {
  it("the probe covers every model the server uses, and the pictures and streams the routes send", () => {
    const models = serverModels();
    expect(models.length).toBeGreaterThanOrEqual(8);
    for (const m of IMAGE_MODELS) expect(models).toContain(m);
    for (const m of STREAM_MODELS) expect(models).toContain(m);
    expect(models).not.toContain(NO_ZDR_CONTROL);
  });
});

describe.skipIf(!RUN)("eval: provider privacy (real OpenRouter calls)", () => {
  it("every server model answers with data_collection deny + zdr; a model without a ZDR endpoint is refused", { timeout: 600_000 }, async () => {
    loadEnvLocal();
    resetServerEnvCache();
    const rows: string[] = [];
    const failures: string[] = [];
    for (const model of serverModels()) {
      const text = await probe({
        model,
        messages: [{ role: "user", content: 'Reply with this JSON and nothing else: {"ok":true}' }],
        response_format: { type: "json_object" },
        max_tokens: maxTokensFor(model),
        ...reasoningFor(model),
      });
      const image = IMAGE_MODELS.has(model)
        ? await probe({
            model,
            messages: [
              {
                role: "user",
                content: [
                  { type: "text", text: "What colour is this square? One word." },
                  { type: "image_url", image_url: { url: RED_SQUARE_PNG } },
                ],
              },
            ],
            max_tokens: maxTokensFor(model),
            ...reasoningFor(model),
          })
        : null;
      const stream = STREAM_MODELS.has(model) ? await probeStream(model) : null;
      const cell = (p: Probe | null) => (p ? `${p.ok ? "ok" : "FAILED"} (${p.provider ?? "-"}, ${p.ms} ms${p.ok ? "" : `: ${p.detail}`})` : "not used");
      rows.push(`| \`${model}\` | ${cell(text)} | ${cell(image)} | ${stream ? (stream.ok ? `ok (${stream.ms} ms)` : `FAILED: ${stream.detail}`) : "not used"} |`);
      if (!text.ok) failures.push(`${model} text: ${text.detail}`);
      if (image && !image.ok) failures.push(`${model} image: ${image.detail}`);
      if (stream && !stream.ok) failures.push(`${model} stream: ${stream.detail}`);
    }
    const control = await probe({ model: NO_ZDR_CONTROL, messages: [{ role: "user", content: "Reply ok" }], max_tokens: 16 });

    const report = [
      "# Provider privacy probe",
      "",
      `Run ${new Date().toISOString()} by \`npm run eval:privacy\` (src/__eval__/privacy/providers.test.ts). Every request carried`,
      `\`provider: ${JSON.stringify(PROVIDER_PRIVACY)}\` (PROVIDER_PRIVACY in src/lib/server/openrouter.ts), so OpenRouter could only`,
      "route it to an endpoint that does not train on prompts and keeps no data (Zero Data Retention).",
      "Each cell: the result, the provider OpenRouter reports serving it, and the time.",
      "",
      "| Model | Text (JSON mode) | Picture | Stream |",
      "| --- | --- | --- | --- |",
      ...rows,
      "",
      `Control: \`${NO_ZDR_CONTROL}\` has no ZDR endpoint. ${control.ok ? `It was SERVED (${control.provider}): the preference is not enforced.` : `Refused as expected: ${control.detail}`}`,
      "",
    ].join("\n");
    console.log(report);
    if (WRITE) {
      const out = resolve(ROOT, "docs", "eval", "privacy.md");
      mkdirSync(dirname(out), { recursive: true });
      writeFileSync(out, report);
    }
    expect(control.ok, "a model without a ZDR endpoint must be refused").toBe(false);
    expect(failures).toEqual([]);
  });
});
