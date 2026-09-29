/**
 * POST /api/live/lecture/sketch (lecture mode's illustrator), driven through its real handler with
 * fakes for supabase-js (auth, the rate-limit and credit RPCs, the user's own `usage_events` rows
 * that `consume_credits` writes and `refund_credits` deletes) and OpenRouter (`openrouterChat`).
 * The Live contract: 401 before anything, 429 before the charge, zod 400 before the charge. Billed
 * PER PANEL: `live/sketch` (4 credits) under the request's own id, the one `X-Request-Id` carries;
 * a drawing that arrives keeps the charge, and no usable drawing at all (after the retry and the
 * fallback) is a 502 with the charge refunded under the same id.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type RpcReply = { data?: unknown; error?: { message: string; code?: string } | null } | Error;

const fake = vi.hoisted(() => ({
  GOOD_TOKEN: "aaaa.bbbb.cccc",
  USER_ID: "11111111-2222-4333-8444-555555555555",
  calls: [] as Array<{ fn: string; args?: Record<string, unknown> }>,
  replies: {} as Record<string, (args?: Record<string, unknown>) => RpcReply>,
  rows: [] as Array<{ user_id: string; request_id: string; units: number }>,
}));

vi.mock("@supabase/supabase-js", () => ({
  createClient: () => ({
    auth: {
      getUser: async (token: string) =>
        token === fake.GOOD_TOKEN ? { data: { user: { id: fake.USER_ID, email: "qa@example.com" } }, error: null } : { data: { user: null }, error: { message: "invalid token" } },
    },
    rpc: async (fn: string, args?: Record<string, unknown>) => {
      fake.calls.push({ fn, args });
      const reply = fake.replies[fn]?.(args) ?? { error: { message: `no fake reply for ${fn}` } };
      if (reply instanceof Error) throw reply;
      return { data: reply.data ?? null, error: reply.error ?? null };
    },
  }),
}));

vi.mock("@/lib/server/openrouter", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/server/openrouter")>();
  return { ...actual, openrouterChat: vi.fn() };
});

import { resetServerEnvCache } from "@/lib/env";
import { LIVE_MODELS } from "@/lib/live/contracts";
import { LECTURE_SKETCH_LIMITS, SketchResponseSchema } from "@/lib/live/lecture/contracts";
import { resetBillingWarnings, ROUTE_COSTS } from "@/lib/server/billing";
import { openrouterChat, UpstreamError } from "@/lib/server/openrouter";
import { resetRateLimitFallbackWarning, resetRateLimits } from "@/lib/server/rate-limit";
import { SKETCH_BUDGET_MS, SKETCH_MAX_TOKENS } from "@/lib/server/sketch/illustrate";
import { SKETCH_SYSTEM_PROMPT } from "@/lib/server/sketch/prompt";
import { maxDuration, POST as sketch } from "@/app/api/live/lecture/sketch/route";

const ENV_VARS = ["BILLING_ENFORCE", "RATE_LIMIT_BACKEND", "NEXT_PUBLIC_SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_ANON_KEY", "OPENROUTER_API_KEY", "LIVE_MODEL_SKETCH"];
const savedEnv: Record<string, string | undefined> = {};
const BODY = {
  boardId: "board-1",
  session: "sess_abc12345",
  prompt: "Officer Vega leaps the gap between two rooftops, chasing a masked thief",
  cast: "Officer Vega: tall, white helmet with a dark visor, long blue coat with a star badge",
  panel: { index: 1, of: 4 },
  aspect: 0.81,
};
const SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1000 1235"><g fill="none" stroke-width="5">
<path d="M380 400 C 380 300, 620 300, 620 400 L 640 900 L 360 900 Z" stroke="#4465e9" fill="#4465e9"/>
<ellipse cx="500" cy="280" rx="90" ry="100" stroke="#9fa8b2"/><path d="M430 270 L 570 270" stroke="#1d1d1d"/>
<path d="M400 900 L 380 1100 M 600 900 L 620 1100" stroke="#9fa8b2"/></g></svg>`;

function request(body: unknown, token: string | null = fake.GOOD_TOKEN): Request {
  return new Request("http://localhost/api/live/lecture/sketch", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}
const callsTo = (fn: string) => fake.calls.filter((c) => c.fn === fn);
const reply = (content: string, finish = "stop") => ({ choices: [{ message: { content }, finish_reason: finish }] });
const modelReplies = (...replies: Array<string | Error>) => {
  for (const r of replies) {
    if (r instanceof Error) vi.mocked(openrouterChat).mockRejectedValueOnce(r);
    else vi.mocked(openrouterChat).mockResolvedValueOnce(reply(r) as never);
  }
};
const modelsAsked = () => vi.mocked(openrouterChat).mock.calls.map(([body]) => body.model);

beforeEach(() => {
  for (const name of ENV_VARS) {
    savedEnv[name] = process.env[name];
    delete process.env[name];
  }
  process.env.NEXT_PUBLIC_SUPABASE_URL = "http://127.0.0.1:54321";
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "anon-key";
  process.env.OPENROUTER_API_KEY = "sk-or-test";
  resetServerEnvCache();
  resetBillingWarnings();
  resetRateLimits();
  resetRateLimitFallbackWarning();
  fake.calls.length = 0;
  fake.rows.length = 0;
  for (const key of Object.keys(fake.replies)) delete fake.replies[key];
  fake.replies.rate_limit_hit = () => ({ data: { allowed: true, remaining: 11, retry_after_ms: 0, backend: "db" } });
  fake.replies.consume_credits = (args) => {
    fake.rows.push({ user_id: fake.USER_ID, request_id: String(args?.p_request_id), units: Number(args?.p_units) });
    return { data: { ok: true, remaining: 100, reason: null } };
  };
  fake.replies.refund_credits = (args) => {
    const before = fake.rows.length;
    fake.rows.splice(0, fake.rows.length, ...fake.rows.filter((r) => r.request_id !== args?.p_request_id));
    return { data: { refunded: before - fake.rows.length, remaining: 104 } };
  };
  vi.mocked(openrouterChat).mockReset();
});

afterEach(() => {
  for (const name of ENV_VARS) {
    if (savedEnv[name] === undefined) delete process.env[name];
    else process.env[name] = savedEnv[name];
  }
  resetServerEnvCache();
});

describe("live/lecture/sketch", () => {
  it("401 without a token; 429 from liveSketch before the charge; 400 on a bad body", async () => {
    expect((await sketch(request(BODY, null))).status).toBe(401);
    expect(fake.calls).toEqual([]);
    fake.replies.rate_limit_hit = () => ({ data: { allowed: false, remaining: 0, retry_after_ms: 900 } });
    expect((await sketch(request(BODY))).status).toBe(429);
    expect(callsTo("rate_limit_hit")[0].args).toMatchObject({ p_bucket: "liveSketch" });
    fake.replies.rate_limit_hit = () => ({ data: { allowed: true, remaining: 11, retry_after_ms: 0, backend: "db" } });
    for (const bad of [
      { ...BODY, prompt: "  " },
      { ...BODY, prompt: "x".repeat(LECTURE_SKETCH_LIMITS.prompt + 1) },
      { ...BODY, cast: "x".repeat(LECTURE_SKETCH_LIMITS.cast + 1) },
      { ...BODY, aspect: 3 },
      { ...BODY, aspect: 0.1 },
      { ...BODY, panel: { index: 4, of: 4 } },
      { ...BODY, session: "short" },
      { ...BODY, aspect: undefined },
    ])
      expect((await sketch(request(bad))).status, JSON.stringify(bad).slice(0, 80)).toBe(400);
    expect((await sketch(request("{not json"))).status).toBe(400);
    expect(callsTo("consume_credits")).toEqual([]);
    expect(openrouterChat).not.toHaveBeenCalled();
  });

  it("a panel drawn: charged 4 credits under the request's own id, the drawing in the contract's box", async () => {
    modelReplies(SVG);
    const res = await sketch(request(BODY));
    expect(res.status).toBe(200);
    const body = SketchResponseSchema.parse(await res.json());
    expect(body).toMatchObject({ model: LIVE_MODELS.sketch, charged: true, drawing: { w: 1000, h: 1235 } });
    expect(body.drawing.strokes.length).toBeGreaterThanOrEqual(4);
    expect(body.drawing.strokes[0]).toMatchObject({ color: "blue", closed: true, fill: true });
    const [charge] = callsTo("consume_credits");
    expect(charge.args).toMatchObject({ p_route: "live/sketch", p_units: ROUTE_COSTS["live/sketch"], p_model: LIVE_MODELS.sketch });
    expect(ROUTE_COSTS["live/sketch"]).toBe(4);
    expect(res.headers.get("X-Request-Id")).toBe(charge.args?.p_request_id);
    expect(callsTo("refund_credits")).toEqual([]);
  });

  it("the model is asked as the illustrator asks: the house prompt, the panel and the cast, the frame's viewBox, no JSON mode", async () => {
    modelReplies(SVG);
    await sketch(request(BODY));
    const [body, opts] = vi.mocked(openrouterChat).mock.calls[0];
    expect(body).toMatchObject({ model: LIVE_MODELS.sketch, max_tokens: SKETCH_MAX_TOKENS, reasoning: { effort: "low" }, provider: { sort: "latency" } });
    expect(body.response_format).toBeUndefined();
    const messages = body.messages as Array<{ content: string }>;
    expect(messages[0].content).toBe(SKETCH_SYSTEM_PROMPT);
    expect(messages[1].content).toContain("PANEL 2 OF 4 of a comic strip.");
    expect(messages[1].content).toContain(`<cast>${BODY.cast}</cast>`);
    expect(messages[1].content).toContain(`<request>${BODY.prompt}</request>`);
    expect(messages[1].content).toContain('viewBox="0 0 1000 1235"');
    expect(opts?.title).toBe("Agathon Live - sketch");
    // the route's own budget covers the illustrator's
    expect(maxDuration * 1000).toBeGreaterThan(SKETCH_BUDGET_MS);
  });

  it("an unusable SVG is retried on the primary; then the fallback; a drawing from either keeps the charge", async () => {
    modelReplies("Sorry, here is a description instead.", SVG);
    let res = await sketch(request(BODY));
    expect(res.status).toBe(200);
    expect(modelsAsked()).toEqual([LIVE_MODELS.sketch, LIVE_MODELS.sketch]);

    vi.mocked(openrouterChat).mockReset();
    modelReplies(new UpstreamError(503, "provider down"), SVG);
    res = await sketch(request(BODY));
    expect(SketchResponseSchema.parse(await res.json()).model).toBe(LIVE_MODELS.sketchFallback);
    expect(modelsAsked()).toEqual([LIVE_MODELS.sketch, LIVE_MODELS.sketchFallback]);
    expect(callsTo("refund_credits")).toEqual([]);
    expect(fake.rows).toHaveLength(2);
  });

  it("no usable drawing at all: 502, and the charge refunded under the same id", async () => {
    modelReplies("<svg viewBox='0 0 10 10'></svg>", "I cannot draw that.", "<p>not a drawing</p>");
    const res = await sketch(request(BODY));
    expect(res.status).toBe(502);
    expect(await res.json()).toMatchObject({ error: "upstream_error" });
    expect(modelsAsked()).toEqual([LIVE_MODELS.sketch, LIVE_MODELS.sketch, LIVE_MODELS.sketchFallback]);
    const charged = callsTo("consume_credits")[0].args?.p_request_id;
    expect(callsTo("refund_credits").map((c) => c.args)).toEqual([{ p_request_id: charged }]);
    expect(res.headers.get("X-Request-Id")).toBe(charged);
    expect(fake.rows).toEqual([]);
  });

  it("402 when out of credits, before any model call", async () => {
    fake.replies.consume_credits = () => ({ data: { ok: false, remaining: 2, reason: "insufficient_credits" } });
    const res = await sketch(request(BODY));
    expect(res.status).toBe(402);
    expect(await res.json()).toMatchObject({ error: "credits_exhausted" });
    expect(openrouterChat).not.toHaveBeenCalled();
  });

  it("BILLING_ENFORCE=0: nothing charged, charged: false", async () => {
    process.env.BILLING_ENFORCE = "0";
    resetServerEnvCache();
    modelReplies(SVG);
    const res = await sketch(request(BODY));
    expect(SketchResponseSchema.parse(await res.json()).charged).toBe(false);
    expect(callsTo("consume_credits")).toEqual([]);
  });

  it("LIVE_MODEL_SKETCH overrides the primary", async () => {
    process.env.LIVE_MODEL_SKETCH = "openai/gpt-5.4-mini";
    resetServerEnvCache();
    modelReplies("nothing", "nothing", SVG);
    await sketch(request(BODY));
    expect(modelsAsked()).toEqual(["openai/gpt-5.4-mini", "openai/gpt-5.4-mini", LIVE_MODELS.sketchFallback]);
  });
});
