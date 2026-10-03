/**
 * POST /api/live/setup (word problem → equations) and POST /api/live/reread (the second reader),
 * driven through their real handlers with fakes for everything outside the process: supabase-js
 * (`auth.getUser` + every RPC) and OpenRouter (`chatJsonWithFallback`). The same contract as the
 * other Live routes: 401 before anything, 429 before the charge, zod 400 before the charge, the
 * price charged up front, the SAME request id refunded on any non-2xx, `X-Request-Id` on every
 * response.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type RpcReply = { data?: unknown; error?: { message: string; code?: string } | null } | Error;

const fake = vi.hoisted(() => ({
  GOOD_TOKEN: "aaaa.bbbb.cccc",
  USER_ID: "11111111-2222-4333-8444-555555555555",
  calls: [] as Array<{ fn: string; args?: Record<string, unknown>; key?: string }>,
  replies: {} as Record<string, (args?: Record<string, unknown>) => RpcReply>,
}));

vi.mock("@supabase/supabase-js", () => ({
  createClient: (_url: string, key: string) => ({
    auth: {
      getUser: async (token: string) =>
        token === fake.GOOD_TOKEN
          ? { data: { user: { id: fake.USER_ID, email: "qa@example.com" } }, error: null }
          : { data: { user: null }, error: { message: "invalid token" } },
    },
    rpc: async (fn: string, args?: Record<string, unknown>) => {
      fake.calls.push({ fn, args, key });
      const reply = fake.replies[fn]?.(args) ?? { error: { message: `no fake reply for ${fn}` } };
      if (reply instanceof Error) throw reply;
      return { data: reply.data ?? null, error: reply.error ?? null };
    },
  }),
}));

vi.mock("@/lib/server/openrouter", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/server/openrouter")>();
  return { ...actual, chatJsonWithFallback: vi.fn() };
});

import { resetServerEnvCache } from "@/lib/env";
import { LIVE_MODELS, RereadResponseSchema, SetupResponseSchema } from "@/lib/live/contracts";
import { resetBillingWarnings } from "@/lib/server/billing";
import { chatJsonWithFallback, CreditsExhaustedError, UpstreamError } from "@/lib/server/openrouter";
import { resetRateLimitFallbackWarning, resetRateLimits } from "@/lib/server/rate-limit";
import { POST as setup } from "@/app/api/live/setup/route";
import { POST as reread } from "@/app/api/live/reread/route";

const ENV_VARS = ["BILLING_ENFORCE", "SUPABASE_SERVICE_ROLE_KEY", "RATE_LIMIT_BACKEND", "NEXT_PUBLIC_SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_ANON_KEY", "OPENROUTER_API_KEY", "LIVE_MODEL_SETUP", "LIVE_MODEL_REREAD", "LIVE_MODEL_FIGURE"];
const savedEnv: Record<string, string | undefined> = {};

const CROP = "data:image/jpeg;base64,ZmFrZQ==";
const PROBLEM = ["\\text{A train travels 150 km in 2.5 hours.}", "\\text{What is its average speed in km/h?}"];
const SETUP_BODY = { boardId: "board-1", lines: PROBLEM };
const REREAD_BODY = { boardId: "board-1", lineId: "ln_1", crop: CROP, latex: "0=5", above: ["v=u+a t"], below: [] };

function request(path: string, body: unknown, token: string | null = fake.GOOD_TOKEN): Request {
  return new Request(`http://localhost${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

const callsTo = (fn: string) => fake.calls.filter((c) => c.fn === fn);

function expectChargedAndRefunded(): void {
  const charged = callsTo("consume_credits");
  const refunded = callsTo("refund_ink_for");
  expect(charged.length, "charged exactly once").toBe(1);
  expect(refunded.length, "refunded exactly once").toBe(1);
  expect(refunded[0].args?.p_request_id, "the refunded request id is the charged one").toBe(charged[0].args?.p_request_id);
}

function expectChargedNotRefunded(): void {
  expect(callsTo("consume_credits").length).toBe(1);
  expect(callsTo("refund_ink_for")).toEqual([]);
}

beforeEach(() => {
  for (const name of ENV_VARS) {
    savedEnv[name] = process.env[name];
    delete process.env[name];
  }
  process.env.NEXT_PUBLIC_SUPABASE_URL = "http://127.0.0.1:54321";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "service-role-test";
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "anon-key";
  process.env.OPENROUTER_API_KEY = "sk-or-test";
  resetServerEnvCache();
  resetBillingWarnings();
  resetRateLimits();
  resetRateLimitFallbackWarning();
  fake.calls.length = 0;
  for (const key of Object.keys(fake.replies)) delete fake.replies[key];
  fake.replies.rate_limit_hit = () => ({ data: { allowed: true, remaining: 9, retry_after_ms: 0, backend: "db" } });
  fake.replies.consume_credits = () => ({ data: { ok: true, remaining: 100, reason: null } });
  fake.replies.refund_ink_for = () => ({ data: { refunded: 2, remaining: 102 } });
  vi.mocked(chatJsonWithFallback).mockReset();
});

afterEach(() => {
  for (const name of ENV_VARS) {
    if (savedEnv[name] === undefined) delete process.env[name];
    else process.env[name] = savedEnv[name];
  }
  resetServerEnvCache();
});

/* ------------------------------------------------------------------------- */
/* Both routes: the shared Live contract                                       */
/* ------------------------------------------------------------------------- */

describe.each([
  { name: "live/setup", handler: setup, path: "/api/live/setup", body: SETUP_BODY, bucket: "liveSetup", cost: 2, ok: { data: { unknown: "v", lines: ["v = \\frac{150}{2.5}"] }, model: LIVE_MODELS.setup } },
  { name: "live/reread", handler: reread, path: "/api/live/reread", body: REREAD_BODY, bucket: "liveReread", cost: 1, ok: { data: { latex: "a=5", changed: true }, model: LIVE_MODELS.reread } },
])("$name", (route) => {
  it("401 without a token, before any RPC or model call", async () => {
    const res = await route.handler(request(route.path, route.body, null));
    expect(res.status).toBe(401);
    expect(res.headers.get("X-Request-Id")).toBeTruthy();
    expect(fake.calls).toEqual([]);
    expect(chatJsonWithFallback).not.toHaveBeenCalled();
  });

  it("429 from its own bucket before the charge", async () => {
    fake.replies.rate_limit_hit = () => ({ data: { allowed: false, remaining: 0, retry_after_ms: 900 } });
    const res = await route.handler(request(route.path, route.body));
    expect(res.status).toBe(429);
    expect(callsTo("rate_limit_hit")[0].args).toMatchObject({ p_bucket: route.bucket });
    expect(callsTo("consume_credits")).toEqual([]);
  });

  it("400 invalid_request on a bad body, before the charge", async () => {
    const res = await route.handler(request(route.path, { boardId: "b" }));
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: "invalid_request" });
    expect(callsTo("consume_credits")).toEqual([]);
    const notJson = await route.handler(request(route.path, "{nope"));
    expect(notJson.status).toBe(400);
  });

  it(`charges ${route.cost} credit(s) up front and keeps them on success`, async () => {
    vi.mocked(chatJsonWithFallback).mockResolvedValue(route.ok as never);
    const res = await route.handler(request(route.path, route.body));
    expect(res.status).toBe(200);
    expect(res.headers.get("X-Request-Id")).toBe(callsTo("consume_credits")[0].args?.p_request_id);
    expect(callsTo("consume_credits")[0].args).toMatchObject({ p_route: route.name, p_units: route.cost });
    expectChargedNotRefunded();
  });

  it("refunds the same request id when both models fail (502 upstream_error)", async () => {
    vi.mocked(chatJsonWithFallback).mockRejectedValue(new UpstreamError(504, "timed out"));
    const res = await route.handler(request(route.path, route.body));
    expect(res.status).toBe(502);
    expect(await res.json()).toMatchObject({ error: "upstream_error" });
    expectChargedAndRefunded();
  });

  it("refunds when the provider account runs dry (503 upstream_error, not a 402)", async () => {
    vi.mocked(chatJsonWithFallback).mockRejectedValue(new CreditsExhaustedError());
    expect((await route.handler(request(route.path, route.body))).status).toBe(503);
    expectChargedAndRefunded();
  });

  it("402 ink_empty before any model call when the user is out of ink", async () => {
    fake.replies.consume_credits = () => ({ data: { ok: false, remaining: 0, reason: "insufficient_credits" } });
    const res = await route.handler(request(route.path, route.body));
    expect(res.status).toBe(402);
    expect(await res.json()).toMatchObject({ error: "ink_empty" });
    expect(chatJsonWithFallback).not.toHaveBeenCalled();
    expect(callsTo("refund_ink_for")).toEqual([]);
  });
});

/* ------------------------------------------------------------------------- */
/* live/setup                                                                 */
/* ------------------------------------------------------------------------- */

describe("live/setup", () => {
  it("answers the setup lines only: $ stripped, empties dropped, at most 4, with the model that wrote them", async () => {
    vi.mocked(chatJsonWithFallback).mockResolvedValue({
      data: { unknown: "\\(d\\)", lines: ["$n + d = 25$", "", 7, "5n + 10d = 185", "a", "b", "c"] },
      model: LIVE_MODELS.setupFallback,
    } as never);
    const res = await setup(request("/api/live/setup", SETUP_BODY));
    expect(res.status).toBe(200);
    const body = SetupResponseSchema.parse(await res.json());
    expect(body.lines).toEqual(["n + d = 25", "5n + 10d = 185", "a", "b"]);
    expect(body.model).toBe(LIVE_MODELS.setupFallback);
  });

  it("sends the problem lines to the setup model with the fallback, low reasoning, JSON", async () => {
    vi.mocked(chatJsonWithFallback).mockResolvedValue({ data: { unknown: "v", lines: ["v = \\frac{150}{2.5}"] }, model: LIVE_MODELS.setup } as never);
    await setup(request("/api/live/setup", SETUP_BODY));
    const [primary, fallback, opts] = vi.mocked(chatJsonWithFallback).mock.calls[0];
    expect(primary).toBe(LIVE_MODELS.setup);
    expect(fallback).toBe(LIVE_MODELS.setupFallback);
    expect(opts.reasoningFor?.(primary)).toBe("low");
    const user = opts.messages.find((m) => m.role === "user");
    expect(user?.content).toBe(["Problem lines:", ...PROBLEM, "", "JSON only."].join("\n"));
  });

  it("LIVE_MODEL_SETUP overrides the primary", async () => {
    process.env.LIVE_MODEL_SETUP = "google/gemini-3.5-flash-lite";
    resetServerEnvCache();
    vi.mocked(chatJsonWithFallback).mockResolvedValue({ data: { unknown: "x", lines: ["x = 1"] }, model: "google/gemini-3.5-flash-lite" } as never);
    await setup(request("/api/live/setup", SETUP_BODY));
    expect(vi.mocked(chatJsonWithFallback).mock.calls[0][0]).toBe("google/gemini-3.5-flash-lite");
    expect(callsTo("consume_credits")[0].args).toMatchObject({ p_model: "google/gemini-3.5-flash-lite" });
  });

  it("a reply with no setup lines is a failed call: 502 and refunded (the board falls back to solve)", async () => {
    vi.mocked(chatJsonWithFallback).mockResolvedValue({ data: { unknown: "", lines: [] }, model: LIVE_MODELS.setup } as never);
    const res = await setup(request("/api/live/setup", SETUP_BODY));
    expect(res.status).toBe(502);
    expectChargedAndRefunded();
  });

  it("refuses an empty problem and more than 40 lines", async () => {
    expect((await setup(request("/api/live/setup", { boardId: "b", lines: [] }))).status).toBe(400);
    expect((await setup(request("/api/live/setup", { boardId: "b", lines: Array.from({ length: 41 }, () => "x") }))).status).toBe(400);
  });
});

/* ------------------------------------------------------------------------- */
/* live/setup with a figure: "the tutor reads the figure"                     */
/* ------------------------------------------------------------------------- */

describe("live/setup with a figure crop", () => {
  const FIGURE_BODY = { boardId: "board-1", lines: ["x = ?"], labels: ["3", "4", "x"], crop: CROP };

  it("reads the crop with the figure model: image first, then the labels and the lines beside it", async () => {
    vi.mocked(chatJsonWithFallback).mockResolvedValue({
      data: { unknown: "x", lines: ["x^{2} = 3^{2} + 4^{2}", "x = \\sqrt{3^{2} + 4^{2}}"] },
      model: LIVE_MODELS.figure,
    } as never);
    const res = await setup(request("/api/live/setup", FIGURE_BODY));
    expect(res.status).toBe(200);
    expect(SetupResponseSchema.parse(await res.json())).toMatchObject({ lines: ["x^{2} = 3^{2} + 4^{2}", "x = \\sqrt{3^{2} + 4^{2}}"], unknown: "x", model: LIVE_MODELS.figure });

    const [primary, fallback, opts] = vi.mocked(chatJsonWithFallback).mock.calls[0];
    expect(primary).toBe(LIVE_MODELS.figure);
    expect(fallback).toBe(LIVE_MODELS.figureFallback);
    expect(opts.reasoningFor?.(LIVE_MODELS.figure)).toBe("low");
    expect(opts.reasoningFor?.(LIVE_MODELS.figureFallback)).toBe("low");
    // Anthropic's thinking starts at 1024 tokens: an Anthropic figure model (LIVE_MODEL_FIGURE) gets none
    expect(opts.reasoningFor?.("anthropic/claude-haiku-4.5")).toBeUndefined();
    const system = opts.messages.find((m) => m.role === "system");
    expect(system?.content).toContain("hand-drawn geometry figure");
    expect(system?.content).toContain("You never calculate");
    const user = opts.messages.find((m) => m.role === "user");
    expect(user?.content).toEqual([
      { type: "image_url", image_url: { url: CROP } },
      { type: "text", text: ["Labels read on the figure: 3, 4, x", "The student's lines beside it, top to bottom:\n1. x = ?", "JSON only."].join("\n") },
    ]);
    // same price and bucket as a word problem's setup, charged against the figure model
    expect(callsTo("consume_credits")[0].args).toMatchObject({ p_route: "live/setup", p_units: 2, p_model: LIVE_MODELS.figure });
    expect(callsTo("rate_limit_hit")[0].args).toMatchObject({ p_bucket: "liveSetup" });
    expectChargedNotRefunded();
  });

  it("a figure needs no lines beside it", async () => {
    vi.mocked(chatJsonWithFallback).mockResolvedValue({ data: { unknown: "x", lines: ["x + 40 + 65 = 180"] }, model: LIVE_MODELS.figure } as never);
    const res = await setup(request("/api/live/setup", { boardId: "b", crop: CROP, labels: ["40^{\\circ}", "x", "65^{\\circ}"] }));
    expect(res.status).toBe(200);
    const text = ((vi.mocked(chatJsonWithFallback).mock.calls[0][2].messages[1].content as Array<{ text?: string }>)[1].text ?? "");
    expect(text).toContain("No lines beside it.");
  });

  it("the model describes the figure; the planner writes the equation (the model's own lines unused)", async () => {
    vi.mocked(chatJsonWithFallback).mockResolvedValue({
      data: {
        unknown: "x",
        quantities: [
          { id: "a", what: "angle", label: "40°" },
          { id: "b", what: "angle", label: "x" },
          { id: "c", what: "angle", label: "65°" },
        ],
        facts: [{ type: "triangle", items: ["a", "b", "c"] }],
        lines: ["x = 180 - 40 - 65"],
      },
      model: LIVE_MODELS.figure,
    } as never);
    const res = await setup(request("/api/live/setup", { boardId: "b", crop: CROP, labels: ["40^{\\circ}", "x", "65^{\\circ}"] }));
    expect(res.status).toBe(200);
    expect(SetupResponseSchema.parse(await res.json())).toMatchObject({
      lines: ["x + 40 + 65 = 180"],
      unknown: "x",
      figure: { source: "facts", stages: [{ letter: "x", lines: ["x + 40 + 65 = 180"], value: 75, kind: "angle" }] },
    });
    expectChargedNotRefunded();
  });

  it("a description that does not hold up: the model's own lines, with why", async () => {
    vi.mocked(chatJsonWithFallback).mockResolvedValue({
      data: {
        unknown: "x",
        // a label the reader read as 65° is 76° here: a misread, so the read is not used
        quantities: [
          { id: "a", what: "angle", label: "40°" },
          { id: "b", what: "angle", label: "x" },
          { id: "c", what: "angle", label: "76°" },
        ],
        facts: [{ type: "triangle", items: ["a", "b", "c"] }],
        lines: ["x + 40 + 65 = 180"],
      },
      model: LIVE_MODELS.figure,
    } as never);
    const res = await setup(request("/api/live/setup", { boardId: "b", crop: CROP, labels: ["40^{\\circ}", "x", "65^{\\circ}"] }));
    expect(res.status).toBe(200);
    const body = SetupResponseSchema.parse(await res.json());
    expect(body).toMatchObject({ lines: ["x + 40 + 65 = 180"], figure: { source: "lines", kind: "angle" } });
    expect(body.figure?.reason).toMatch(/not in the read|not on the figure/);
  });

  it("a figure that asks nothing is a failed call: 502 and refunded", async () => {
    vi.mocked(chatJsonWithFallback).mockResolvedValue({ data: { unknown: "", lines: [] }, model: LIVE_MODELS.figure } as never);
    expect((await setup(request("/api/live/setup", FIGURE_BODY))).status).toBe(502);
    expectChargedAndRefunded();
  });

  it("LIVE_MODEL_FIGURE overrides the figure model, not the word-problem one", async () => {
    process.env.LIVE_MODEL_FIGURE = "openai/gpt-5.4-mini";
    resetServerEnvCache();
    vi.mocked(chatJsonWithFallback).mockResolvedValue({ data: { unknown: "x", lines: ["x = 1"] }, model: "openai/gpt-5.4-mini" } as never);
    await setup(request("/api/live/setup", FIGURE_BODY));
    expect(vi.mocked(chatJsonWithFallback).mock.calls[0][0]).toBe("openai/gpt-5.4-mini");
    await setup(request("/api/live/setup", SETUP_BODY));
    expect(vi.mocked(chatJsonWithFallback).mock.calls[1][0]).toBe(LIVE_MODELS.setup);
  });

  it("refuses labels without a crop, and a crop that is not an image", async () => {
    expect((await setup(request("/api/live/setup", { ...SETUP_BODY, labels: ["3"] }))).status).toBe(400);
    expect((await setup(request("/api/live/setup", { ...FIGURE_BODY, crop: "https://example.com/x.png" }))).status).toBe(400);
    expect((await setup(request("/api/live/setup", { ...FIGURE_BODY, crop: `data:image/jpeg;base64,${"A".repeat(280_001)}` }))).status).toBe(400);
    expect(callsTo("consume_credits")).toEqual([]);
  });
});

/* ------------------------------------------------------------------------- */
/* live/reread                                                                */
/* ------------------------------------------------------------------------- */

describe("live/reread", () => {
  it("hands the crop to the reread model as an image part with Mathpix's LaTeX and the column", async () => {
    vi.mocked(chatJsonWithFallback).mockResolvedValue({ data: { latex: "$a=5$", changed: true }, model: LIVE_MODELS.reread } as never);
    const res = await reread(request("/api/live/reread", { ...REREAD_BODY, below: ["b = 2a - 3"] }));
    expect(res.status).toBe(200);
    const body = RereadResponseSchema.parse(await res.json());
    expect(body).toMatchObject({ latex: "a=5", changed: true, model: LIVE_MODELS.reread });

    const [primary, fallback, opts] = vi.mocked(chatJsonWithFallback).mock.calls[0];
    expect(primary).toBe(LIVE_MODELS.reread);
    expect(fallback).toBe(LIVE_MODELS.rereadFallback);
    // minimal reasoning where the model takes it; none for Anthropic
    expect(opts.reasoningFor?.(LIVE_MODELS.reread)).toBe("minimal");
    expect(opts.reasoningFor?.(LIVE_MODELS.rereadFallback)).toBeUndefined();
    const user = opts.messages.find((m) => m.role === "user");
    expect(user?.content).toEqual([
      { type: "image_url", image_url: { url: CROP } },
      { type: "text", text: expect.stringContaining("Recognizer's LaTeX for the line in the image: 0=5") },
    ]);
    const text = (user?.content as Array<{ text?: string }>)[1].text ?? "";
    expect(text).toContain("Lines above, top to bottom:\n1. v=u+a t");
    expect(text).toContain("Lines below, top to bottom:\n1. b = 2a - 3");
  });

  it("an unchanged read is a success like any other (charged, not refunded)", async () => {
    vi.mocked(chatJsonWithFallback).mockResolvedValue({ data: { latex: "0=5", changed: false }, model: LIVE_MODELS.reread } as never);
    const res = await reread(request("/api/live/reread", REREAD_BODY));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ latex: "0=5", changed: false });
    expectChargedNotRefunded();
  });

  it("refuses a request without a crop, a crop that is not an image, or an empty read", async () => {
    const { crop: _c, ...noCrop } = REREAD_BODY;
    void _c;
    expect((await reread(request("/api/live/reread", noCrop))).status).toBe(400);
    expect((await reread(request("/api/live/reread", { ...REREAD_BODY, crop: "https://example.com/x.png" }))).status).toBe(400);
    expect((await reread(request("/api/live/reread", { ...REREAD_BODY, latex: "" }))).status).toBe(400);
    expect((await reread(request("/api/live/reread", { ...REREAD_BODY, crop: `data:image/jpeg;base64,${"A".repeat(280_001)}` }))).status).toBe(400);
    expect(callsTo("consume_credits")).toEqual([]);
  });
});
