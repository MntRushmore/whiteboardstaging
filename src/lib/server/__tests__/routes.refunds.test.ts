/**
 * Route-level behaviour of credit refunds and the distributed rate limiter, with fakes for
 * everything outside the process: supabase-js (`auth.getUser` + every RPC), OpenRouter
 * (`openrouterChat` / `chatJson` / `streamWithFallback`) and Mathpix. Each paid route family
 * is driven through its real handler so the requestId that is charged is provably the one
 * that is refunded.
 *
 *  - non-streaming routes: charged then refunded on any non-2xx; not refunded on a 2xx
 *  - live/recognize: refunded on `recognizer_failed` and on a thrown upstream error
 *  - live/check + live/solve (SSE): refunded only when the stream fails before the first
 *    annotation / step; a later failure keeps the charge
 *  - a failing refund is only logged: the client still gets the mapped error response
 *  - rate limits: `rate_limit_hit` denial -> 429 with `backend: 'db'`; RPC failure -> the
 *    in-memory limiter still answers (and still limits) with `backend: 'memory'`
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type RpcReply = { data?: unknown; error?: { message: string; code?: string } | null } | Error;

const fake = vi.hoisted(() => ({
  GOOD_TOKEN: "aaaa.bbbb.cccc",
  USER_ID: "11111111-2222-4333-8444-555555555555",
  calls: [] as Array<{ fn: string; args?: Record<string, unknown> }>,
  replies: {} as Record<string, (args?: Record<string, unknown>) => RpcReply>,
}));

vi.mock("@supabase/supabase-js", () => ({
  createClient: () => ({
    auth: {
      getUser: async (token: string) =>
        token === fake.GOOD_TOKEN
          ? { data: { user: { id: fake.USER_ID, email: "qa@example.com" } }, error: null }
          : { data: { user: null }, error: { message: "invalid token" } },
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
  return { ...actual, openrouterChat: vi.fn(), chatJson: vi.fn(), streamWithFallback: vi.fn() };
});

vi.mock("@/lib/server/mathpix", () => ({ isMathpixConfigured: () => false, recognizeStrokes: vi.fn() }));

import { resetServerEnvCache } from "@/lib/env";
import { resetBillingWarnings } from "@/lib/server/billing";
import { resetRateLimitFallbackWarning, resetRateLimits } from "@/lib/server/rate-limit";
import { CreditsExhaustedError, UpstreamError, chatJson, openrouterChat, streamWithFallback, type FallbackStreamEvent } from "@/lib/server/openrouter";
import { POST as generateSolution } from "@/app/api/generate-solution/route";
import { POST as generateWorksheet } from "@/app/api/generate-worksheet/route";
import { POST as checkHelpNeeded } from "@/app/api/check-help-needed/route";
import { POST as ocr } from "@/app/api/ocr/route";
import { POST as analyzeWorkspace } from "@/app/api/voice/analyze-workspace/route";
import { POST as recognize } from "@/app/api/live/recognize/route";
import { POST as liveCheck } from "@/app/api/live/check/route";
import { POST as liveSolve } from "@/app/api/live/solve/route";
import { GET as credits } from "@/app/api/credits/route";

/* ------------------------------------------------------------------------- */
/* Fixtures                                                                   */
/* ------------------------------------------------------------------------- */

const ENV_VARS = ["BILLING_ENFORCE", "RATE_LIMIT_BACKEND", "NEXT_PUBLIC_SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_ANON_KEY", "OPENROUTER_API_KEY", "LIVE_MODEL_CHECK", "LIVE_MODEL_SOLVE", "LIVE_MODEL_VISION", "MATHPIX_APP_ID", "MATHPIX_APP_KEY"];
const savedEnv: Record<string, string | undefined> = {};

const IMAGE = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUg==";
const REGION = { x: 0, y: 0, w: 400, h: 200 };
const LINES = [
  { id: "l1", latex: "2x+3=11", bbox: [0, 0, 1, 0.5], local: { kind: "equation", verdict: "none" } },
  { id: "l2", latex: "x=5", bbox: [0, 0.5, 1, 1], local: { kind: "equation", verdict: "mismatch" } },
];
const STROKES = { x: [[1, 2, 3]], y: [[1, 2, 3]] };

const ANNOTATION_LINE = JSON.stringify({ lineId: "l2", verdict: "warn", kind: "algebra", message: "Check the division on the last line.", confidence: 0.9 }) + "\n";
const STEP_LINE = JSON.stringify({ index: 1, latex: "2x=8", explanation: "Subtract 3 from both sides.", final: false }) + "\n";
const STEP2_LINE = JSON.stringify({ index: 2, latex: "x=4", explanation: "Divide both sides by 2.", final: false }) + "\n";

function request(path: string, body: unknown | undefined, token: string | null = fake.GOOD_TOKEN): Request {
  return new Request(`http://localhost${path}`, {
    method: body === undefined ? "GET" : "POST",
    headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

/** Default happy-path database: limiter allows, charge succeeds, refund succeeds. */
function happyDatabase(): void {
  fake.replies.rate_limit_hit = () => ({ data: { allowed: true, remaining: 9, retry_after_ms: 0, backend: "db" } });
  fake.replies.consume_credits = () => ({ data: { ok: true, remaining: 100, reason: null } });
  fake.replies.refund_credits = () => ({ data: { refunded: 3, remaining: 103 } });
}

const callsTo = (fn: string) => fake.calls.filter((c) => c.fn === fn);

function expectChargedAndRefunded(): void {
  const charged = callsTo("consume_credits");
  const refunded = callsTo("refund_credits");
  expect(charged.length, "charged exactly once").toBe(1);
  expect(refunded.length, "refunded exactly once").toBe(1);
  expect(refunded[0].args?.p_request_id, "the refunded request id is the charged one").toBe(charged[0].args?.p_request_id);
  expect(typeof charged[0].args?.p_request_id).toBe("string");
}

function expectChargedNotRefunded(): void {
  expect(callsTo("consume_credits").length).toBe(1);
  expect(callsTo("refund_credits")).toEqual([]);
}

function fakeStream(events: Array<FallbackStreamEvent | Error>): void {
  vi.mocked(streamWithFallback).mockImplementation(async function* () {
    for (const ev of events) {
      if (ev instanceof Error) throw ev;
      yield ev;
    }
  });
}

/** Read an SSE body to the end and return its frames. The stream only closes after `run` settled (refund included). */
async function readSse(res: Response): Promise<Array<{ event: string; data: unknown }>> {
  const text = await res.text();
  return text
    .split("\n\n")
    .filter((frame) => frame.trim() && !frame.startsWith(":"))
    .map((frame) => {
      let event = "message";
      let data = "";
      for (const line of frame.split("\n")) {
        if (line.startsWith("event:")) event = line.slice(6).trim();
        else if (line.startsWith("data:")) data += line.slice(5).trim();
      }
      return { event, data: JSON.parse(data) as unknown };
    });
}

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
  for (const key of Object.keys(fake.replies)) delete fake.replies[key];
  happyDatabase();
  vi.mocked(openrouterChat).mockReset();
  vi.mocked(chatJson).mockReset();
  vi.mocked(streamWithFallback).mockReset();
});

afterEach(() => {
  for (const name of ENV_VARS) {
    if (savedEnv[name] === undefined) delete process.env[name];
    else process.env[name] = savedEnv[name];
  }
  resetServerEnvCache();
  vi.unstubAllGlobals();
});

/* ------------------------------------------------------------------------- */
/* Non-streaming paid routes                                                  */
/* ------------------------------------------------------------------------- */

type Family = {
  name: string;
  handler: (req: Request) => Promise<Response>;
  path: string;
  body: unknown;
  route: string;
  cost: number;
  /** An upstream reply that yields a 2xx. */
  okReply: unknown;
};

const IMAGE_REPLY = { choices: [{ message: { content: "", images: [{ image_url: { url: IMAGE } }] } }], usage: { total_tokens: 10 } };
const TEXT_REPLY = { choices: [{ message: { content: '{"needsHelp":true,"confidence":0.7,"reason":"stuck"}' } }], usage: { total_tokens: 5 } };

const FAMILIES: Family[] = [
  { name: "generate-solution", handler: generateSolution, path: "/api/generate-solution", body: { image: IMAGE }, route: "generate-solution", cost: 25, okReply: IMAGE_REPLY },
  { name: "generate-worksheet", handler: generateWorksheet, path: "/api/generate-worksheet", body: { topic: "fractions" }, route: "generate-worksheet", cost: 20, okReply: IMAGE_REPLY },
  { name: "check-help-needed", handler: checkHelpNeeded, path: "/api/check-help-needed", body: { text: "2x+3=11" }, route: "check-help-needed", cost: 2, okReply: TEXT_REPLY },
  { name: "ocr", handler: ocr, path: "/api/ocr", body: { image: IMAGE }, route: "ocr", cost: 2, okReply: TEXT_REPLY },
  { name: "voice/analyze-workspace", handler: analyzeWorkspace, path: "/api/voice/analyze-workspace", body: { image: IMAGE }, route: "voice/analyze-workspace", cost: 3, okReply: TEXT_REPLY },
];

describe.each(FAMILIES)("$name: charge + refund", (family) => {
  it("charges the route cost and does not refund on success", async () => {
    vi.mocked(openrouterChat).mockResolvedValue(family.okReply as never);
    const res = await family.handler(request(family.path, family.body));
    expect(res.status).toBe(200);
    expectChargedNotRefunded();
    expect(callsTo("consume_credits")[0].args).toMatchObject({ p_route: family.route, p_units: family.cost });
  });

  it("refunds the same request id when the upstream call throws an UpstreamError (502)", async () => {
    vi.mocked(openrouterChat).mockRejectedValue(new UpstreamError(500, "OpenRouter 500"));
    const res = await family.handler(request(family.path, family.body));
    expect(res.status).toBe(502);
    expect(await res.json()).toMatchObject({ error: "upstream_error" });
    expectChargedAndRefunded();
  });

  it("refunds when the provider reports its own credits exhausted (402) and on a timeout/abort (500)", async () => {
    vi.mocked(openrouterChat).mockRejectedValue(new CreditsExhaustedError());
    expect((await family.handler(request(family.path, family.body))).status).toBe(402);
    expectChargedAndRefunded();

    fake.calls.length = 0;
    const abort = new Error("The operation was aborted");
    abort.name = "AbortError";
    vi.mocked(openrouterChat).mockRejectedValue(abort);
    expect((await family.handler(request(family.path, family.body))).status).toBe(500);
    expectChargedAndRefunded();
  });

  it("does not call the provider or refund when the charge is refused (402 before upstream)", async () => {
    fake.replies.consume_credits = () => ({ data: { ok: false, remaining: 1, reason: "insufficient_credits" } });
    const res = await family.handler(request(family.path, family.body));
    expect(res.status).toBe(402);
    expect(openrouterChat).not.toHaveBeenCalled();
    expect(callsTo("refund_credits")).toEqual([]);
  });

  it("still answers the mapped error when the refund RPC itself fails (only logged)", async () => {
    fake.replies.refund_credits = () => new Error("refund db down");
    vi.mocked(openrouterChat).mockRejectedValue(new UpstreamError(503, "unavailable"));
    const res = await family.handler(request(family.path, family.body));
    expect(res.status).toBe(502);
    expect(callsTo("refund_credits").length).toBe(1);
  });

  it("does not touch the database at all with BILLING_ENFORCE=0", async () => {
    process.env.BILLING_ENFORCE = "0";
    resetServerEnvCache();
    vi.mocked(openrouterChat).mockRejectedValue(new UpstreamError(500, "boom"));
    expect((await family.handler(request(family.path, family.body))).status).toBe(502);
    expect(callsTo("consume_credits")).toEqual([]);
    expect(callsTo("refund_credits")).toEqual([]);
  });
});

describe("2xx edge cases are never refunded", () => {
  it("generate-solution: a text-only model answer is a 200 `success: false` and keeps the charge", async () => {
    vi.mocked(openrouterChat).mockResolvedValue({ choices: [{ message: { content: "No help needed." } }] } as never);
    const res = await generateSolution(request("/api/generate-solution", { image: IMAGE }));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ success: false, imageUrl: null });
    expectChargedNotRefunded();
  });

  it("generate-worksheet: a no-image answer is a 502 and IS refunded", async () => {
    vi.mocked(openrouterChat).mockResolvedValue({ choices: [{ message: { content: "Here is a worksheet." } }] } as never);
    const res = await generateWorksheet(request("/api/generate-worksheet", { topic: "fractions" }));
    expect(res.status).toBe(502);
    expect(await res.json()).toMatchObject({ error: "upstream_error", reason: "no_image" });
    expectChargedAndRefunded();
  });
});

/* ------------------------------------------------------------------------- */
/* live/recognize                                                             */
/* ------------------------------------------------------------------------- */

describe("live/recognize: charge + refund", () => {
  const body = { boardId: "board-1", lineId: "ln_1", strokes: STROKES, bounds: { w: 100, h: 40 }, hint: "math" };

  it("charges 1 credit and keeps it on a successful vision transcription", async () => {
    vi.mocked(chatJson).mockResolvedValue({ latex: "2x+3=11", text: "2x+3=11", isMath: true, confidence: 0.8 } as never);
    const res = await recognize(request("/api/live/recognize", { ...body, crop: IMAGE }));
    expect(res.status).toBe(200);
    expect(res.headers.get("X-Request-Id")).toBeTruthy();
    expectChargedNotRefunded();
    expect(callsTo("consume_credits")[0].args).toMatchObject({ p_route: "live/recognize", p_units: 1 });
  });

  it("refunds on recognizer_failed (no Mathpix, no crop -> 502)", async () => {
    const res = await recognize(request("/api/live/recognize", body));
    expect(res.status).toBe(502);
    expect(await res.json()).toMatchObject({ error: "recognizer_failed" });
    expect(res.headers.get("X-Request-Id")).toBe(callsTo("consume_credits")[0].args?.p_request_id);
    expectChargedAndRefunded();
  });

  it("refunds when the vision model throws", async () => {
    vi.mocked(chatJson).mockRejectedValue(new UpstreamError(500, "vision down"));
    const res = await recognize(request("/api/live/recognize", { ...body, crop: IMAGE }));
    expect(res.status).toBe(502);
    expectChargedAndRefunded();
  });
});

/* ------------------------------------------------------------------------- */
/* SSE routes                                                                 */
/* ------------------------------------------------------------------------- */

describe.each([
  {
    name: "live/check",
    handler: liveCheck,
    path: "/api/live/check",
    body: { boardId: "board-1", mode: "suggest", region: REGION, lines: LINES, focusLineId: "l2", userAsked: true },
    route: "live/check",
    cost: 3,
    item: "annotation",
    line: ANNOTATION_LINE,
    /** Text after which the client has provably received one item. */
    delivered: ANNOTATION_LINE,
  },
  {
    name: "live/solve",
    handler: liveSolve,
    path: "/api/live/solve",
    body: { boardId: "board-1", region: REGION, lines: LINES, goal: "solve for x" },
    route: "live/solve",
    cost: 10,
    item: "step",
    line: STEP_LINE,
    // solve holds one step back so the last can be marked final: only the SECOND step flushes the first.
    delivered: STEP_LINE + STEP2_LINE,
  },
])("$name (SSE): refund only before the first $item", (family) => {
  it("charges and keeps the charge on a completed stream", async () => {
    fakeStream([{ type: "model", model: "m1" }, { type: "text", text: family.line }]);
    const res = await family.handler(request(family.path, family.body));
    expect(res.status).toBe(200);
    const events = await readSse(res);
    expect(events.map((e) => e.event)).toEqual(["meta", family.item, "done"]);
    expectChargedNotRefunded();
    expect(callsTo("consume_credits")[0].args).toMatchObject({ p_route: family.route, p_units: family.cost });
  });

  it("refunds the same request id when the stream fails before the first item and still emits the error frame", async () => {
    fakeStream([{ type: "model", model: "m1" }, new UpstreamError(500, "both models failed")]);
    const res = await family.handler(request(family.path, family.body));
    expect(res.status).toBe(200); // SSE opened; the failure is a frame
    const events = await readSse(res);
    expect(events.map((e) => e.event)).toEqual(["meta", "error"]);
    expect(events[1].data).toMatchObject({ error: "upstream_error" });
    expectChargedAndRefunded();
  });

  it("does NOT refund when the stream fails after the first item was delivered", async () => {
    fakeStream([{ type: "model", model: "m1" }, { type: "text", text: family.delivered }, new UpstreamError(500, "cut off")]);
    const events = await readSse(await family.handler(request(family.path, family.body)));
    expect(events.map((e) => e.event)).toEqual(["meta", family.item, "error"]);
    expectChargedNotRefunded();
  });

  it("refunds when the model produced text but nothing valid reached the client before the failure", async () => {
    // For solve this is also the held-back step: one parsed step that was never flushed is not "delivered".
    fakeStream([{ type: "model", model: "m1" }, { type: "text", text: family.item === "step" ? STEP_LINE : "not json\n" }, new UpstreamError(500, "cut off")]);
    const events = await readSse(await family.handler(request(family.path, family.body)));
    expect(events.map((e) => e.event)).toEqual(["meta", "error"]);
    expectChargedAndRefunded();
  });

  it("refunds on a watchdog/timeout style failure with no output at all", async () => {
    fakeStream([new Error("watchdog: no first byte")]);
    const events = await readSse(await family.handler(request(family.path, family.body)));
    expect(events.map((e) => e.event)).toEqual(["meta", "error"]);
    expect(events[1].data).toMatchObject({ error: "internal_error" });
    expectChargedAndRefunded();
  });

  it("a failing refund is only logged; the error frame still reaches the client", async () => {
    fake.replies.refund_credits = () => ({ error: { message: "refund failed" } });
    fakeStream([new UpstreamError(500, "boom")]);
    const events = await readSse(await family.handler(request(family.path, family.body)));
    expect(events.map((e) => e.event)).toEqual(["meta", "error"]);
    expect(callsTo("refund_credits").length).toBe(1);
  });
});

/* ------------------------------------------------------------------------- */
/* Distributed rate limits through the routes                                 */
/* ------------------------------------------------------------------------- */

describe("distributed rate limits through the routes", () => {
  beforeEach(() => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json({ data: { total_credits: 10, total_usage: 1 } })),
    );
  });

  it("GET /api/credits: a rate_limit_hit denial is a 429 rate_limited with Retry-After and backend 'db'", async () => {
    fake.replies.rate_limit_hit = () => ({ data: { allowed: false, remaining: 0, retry_after_ms: 4_200, backend: "db" } });
    const res = await credits(request("/api/credits", undefined));
    expect(res.status).toBe(429);
    expect(res.headers.get("Retry-After")).toBe("5");
    expect(await res.json()).toEqual({ error: "rate_limited", message: expect.any(String), retryAfterMs: 4_200, backend: "db" });
    expect(callsTo("rate_limit_hit")[0].args).toEqual({ p_bucket: "credits", p_limit: 30, p_window_ms: 60_000 });
  });

  it("the rate limit runs before the charge: a denied hit never calls consume_credits", async () => {
    fake.replies.rate_limit_hit = () => ({ data: { allowed: false, remaining: 0, retry_after_ms: 1_000 } });
    const res = await generateWorksheet(request("/api/generate-worksheet", { topic: "fractions" }));
    expect(res.status).toBe(429);
    expect(callsTo("consume_credits")).toEqual([]);
    expect(openrouterChat).not.toHaveBeenCalled();
  });

  it("live routes: the 429 carries X-Request-Id and backend", async () => {
    fake.replies.rate_limit_hit = () => ({ data: { allowed: false, remaining: 0, retry_after_ms: 900 } });
    const res = await recognize(request("/api/live/recognize", { boardId: "b", lineId: "l", strokes: STROKES, bounds: { w: 1, h: 1 } }));
    expect(res.status).toBe(429);
    expect(res.headers.get("X-Request-Id")).toBeTruthy();
    expect(await res.json()).toMatchObject({ error: "rate_limited", backend: "db" });
  });

  it("when rate_limit_hit errors the in-memory limiter answers instead and still enforces the bucket (backend 'memory')", async () => {
    fake.replies.rate_limit_hit = () => ({ error: { message: "Could not find the function public.rate_limit_hit in the schema cache", code: "PGRST202" } });
    vi.mocked(openrouterChat).mockResolvedValue(IMAGE_REPLY as never);
    // generateWorksheet is 4/min: four succeed, the fifth is limited by the fallback.
    for (let i = 0; i < 4; i++) {
      expect((await generateWorksheet(request("/api/generate-worksheet", { topic: "fractions" }))).status).toBe(200);
    }
    const limited = await generateWorksheet(request("/api/generate-worksheet", { topic: "fractions" }));
    expect(limited.status).toBe(429);
    expect(await limited.json()).toMatchObject({ error: "rate_limited", backend: "memory" });
    expect(callsTo("rate_limit_hit").length, "the RPC is retried on every request").toBe(5);
  });

  it("RATE_LIMIT_BACKEND=memory never calls the RPC and reports backend 'memory' on the 429", async () => {
    process.env.RATE_LIMIT_BACKEND = "memory";
    resetServerEnvCache();
    fake.replies.rate_limit_hit = () => new Error("must not be called");
    for (let i = 0; i < 30; i++) expect((await credits(request("/api/credits", undefined))).status).toBe(200);
    const limited = await credits(request("/api/credits", undefined));
    expect(limited.status).toBe(429);
    expect(await limited.json()).toMatchObject({ backend: "memory" });
    expect(callsTo("rate_limit_hit")).toEqual([]);
  });

  it("401 without a valid token happens before any RPC", async () => {
    const res = await credits(request("/api/credits", undefined, "bad.token.here"));
    expect(res.status).toBe(401);
    expect(fake.calls).toEqual([]);
  });
});

/* ------------------------------------------------------------------------- */
/* Static invariant: every charged route refunds through the shared wrappers   */
/* ------------------------------------------------------------------------- */

describe("static: every route that charges credits refunds through runCharged / runChargedStream", () => {
  const REPO_ROOT = join(__dirname, "..", "..", "..", "..");
  const API_DIR = join(REPO_ROOT, "src", "app", "api");

  function routeFiles(dir = API_DIR): string[] {
    const out: string[] = [];
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) out.push(...routeFiles(full));
      else if (entry === "route.ts") out.push(relative(REPO_ROOT, full).split(sep).join("/"));
    }
    return out.sort();
  }

  const charged = routeFiles().filter((f) => /\benforceCredits\s*\(/.test(readFileSync(join(REPO_ROOT, f), "utf8")));

  it("finds the charged routes", () => {
    expect(charged).toEqual([
      "src/app/api/check-help-needed/route.ts",
      "src/app/api/generate-solution/route.ts",
      "src/app/api/generate-worksheet/route.ts",
      "src/app/api/live/check/route.ts",
      "src/app/api/live/recognize/route.ts",
      "src/app/api/live/solve/route.ts",
      "src/app/api/ocr/route.ts",
      "src/app/api/voice/analyze-workspace/route.ts",
    ]);
  });

  for (const file of charged) {
    it(`${file} charges and refunds the same { token, requestId }`, () => {
      const src = readFileSync(join(REPO_ROOT, file), "utf8");
      expect(src).toMatch(/enforceCredits\(\s*\{\s*token,\s*route:\s*"[^"]+",\s*requestId\b/);
      expect(/\brunCharged\(\s*\{\s*token,\s*requestId\s*\}/.test(src) || /\brunChargedStream\(\s*\{\s*token,\s*requestId\s*\}/.test(src), `${file} must wrap its paid work in runCharged or runChargedStream`).toBe(true);
    });
  }

  it("every user-keyed route uses the distributed limiter (the public IP buckets keep checkRateLimit)", () => {
    const userRoutes = [...charged, "src/app/api/credits/route.ts", "src/app/api/voice/token/route.ts"];
    for (const file of userRoutes) {
      const src = readFileSync(join(REPO_ROOT, file), "utf8");
      expect(/\bcheckRateLimitDistributed\s*\(/.test(src) || /\blivePreamble\s*\(/.test(src), `${file} should use checkRateLimitDistributed (or livePreamble)`).toBe(true);
      expect(/\bcheckRateLimit\s*\(/.test(src), `${file} must not use the per-instance limiter for a user bucket`).toBe(false);
    }
    for (const file of ["src/app/api/config/status/route.ts", "src/app/api/billing/webhook/route.ts"]) {
      const src = readFileSync(join(REPO_ROOT, file), "utf8");
      expect(/\bcheckRateLimit\(`ip:/.test(src), `${file} keys the in-memory limiter on the client IP`).toBe(true);
      expect(/\bcheckRateLimitDistributed\s*\(/.test(src), `${file} has no user to key a database row on`).toBe(false);
    }
  });
});
