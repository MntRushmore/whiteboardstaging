/**
 * POST /api/live/chat (the board chat), driven through its real handler with fakes for supabase-js
 * (auth + RPCs), OpenRouter (`chatJsonWithFallback`) and the figure drawer's check. The Live contract: 401
 * before anything, 429 before the charge, zod 400 before the charge, 3 credits up front, the SAME
 * request id refunded on any non-2xx — and on a 200 whose every proposed action had to be dropped.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type RpcReply = { data?: unknown; error?: { message: string; code?: string } | null } | Error;

const fake = vi.hoisted(() => ({
  GOOD_TOKEN: "aaaa.bbbb.cccc",
  USER_ID: "11111111-2222-4333-8444-555555555555",
  calls: [] as Array<{ fn: string; args?: Record<string, unknown> }>,
  replies: {} as Record<string, (args?: Record<string, unknown>) => RpcReply>,
  /** the figure drawer's check: [] is a clean figure */
  drawer: { check: (() => []) as (spec: unknown) => string[] },
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
  return { ...actual, chatJsonWithFallback: vi.fn() };
});

vi.mock("@/lib/live/figureDraw/check", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/live/figureDraw/check")>();
  return { ...actual, checkFigure: (spec: unknown) => fake.drawer.check(spec) };
});

import { resetServerEnvCache } from "@/lib/env";
import { ChatResponseSchema } from "@/lib/live/chat/contracts";
import { LIVE_MODELS } from "@/lib/live/contracts";
import { resetBillingWarnings } from "@/lib/server/billing";
import { chatJsonWithFallback, UpstreamError } from "@/lib/server/openrouter";
import { resetRateLimitFallbackWarning, resetRateLimits } from "@/lib/server/rate-limit";
import { POST as chat } from "@/app/api/live/chat/route";

const ENV_VARS = ["BILLING_ENFORCE", "RATE_LIMIT_BACKEND", "NEXT_PUBLIC_SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_ANON_KEY", "OPENROUTER_API_KEY", "LIVE_MODEL_CHAT"];
const savedEnv: Record<string, string | undefined> = {};
const BODY = {
  boardId: "board-1",
  message: "3 more like these",
  history: [
    { role: "user", text: "3 two-step equations" },
    { role: "tutor", text: "Here are 3 two-step equations." },
  ],
  screen: { empty: false, student: ["2x = 8"], tutor: [], problems: ["2x + 3 = 11", "5x - 2 = 13"] },
};
const TRIANGLE = {
  points: { A: { x: 0, y: 0 }, B: { x: 4, y: 0 }, C: { x: 0, y: 3 } },
  segments: [{ from: "A", to: "B", label: "4" }],
};

function request(body: unknown, token: string | null = fake.GOOD_TOKEN): Request {
  return new Request("http://localhost/api/live/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}
const callsTo = (fn: string) => fake.calls.filter((c) => c.fn === fn);
const modelReplies = (...replies: unknown[]) => {
  for (const r of replies) vi.mocked(chatJsonWithFallback).mockResolvedValueOnce({ data: r, model: LIVE_MODELS.chat } as never);
};

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
  fake.replies.rate_limit_hit = () => ({ data: { allowed: true, remaining: 11, retry_after_ms: 0, backend: "db" } });
  fake.replies.consume_credits = () => ({ data: { ok: true, remaining: 100, reason: null } });
  fake.replies.refund_credits = () => ({ data: { refunded: 3, remaining: 103 } });
  fake.drawer.check = () => [];
  vi.mocked(chatJsonWithFallback).mockReset();
});

afterEach(() => {
  for (const name of ENV_VARS) {
    if (savedEnv[name] === undefined) delete process.env[name];
    else process.env[name] = savedEnv[name];
  }
  resetServerEnvCache();
});

describe("live/chat", () => {
  it("401 without a token; 429 from liveChat before the charge; 400 on a bad body", async () => {
    expect((await chat(request(BODY, null))).status).toBe(401);
    expect(fake.calls).toEqual([]);
    fake.replies.rate_limit_hit = () => ({ data: { allowed: false, remaining: 0, retry_after_ms: 900 } });
    expect((await chat(request(BODY))).status).toBe(429);
    expect(callsTo("rate_limit_hit")[0].args).toMatchObject({ p_bucket: "liveChat" });
    fake.replies.rate_limit_hit = () => ({ data: { allowed: true, remaining: 11, retry_after_ms: 0, backend: "db" } });
    expect((await chat(request({ ...BODY, message: "  " }))).status).toBe(400);
    expect((await chat(request({ ...BODY, screen: undefined }))).status).toBe(400);
    expect((await chat(request({ ...BODY, message: "x".repeat(501) }))).status).toBe(400);
    expect(callsTo("consume_credits")).toEqual([]);
    expect(chatJsonWithFallback).not.toHaveBeenCalled();
  });

  it("a problem set: 3 credits kept, the screen and the chat so far go to the model, problems come back as lines", async () => {
    modelReplies({ reply: "Here are 3 more.", actions: [{ type: "write_problems", problems: ["$4x + 1 = 9$", "6x - 5 = 13", ["x + y = 7", "x - y = 1"]] }] });
    const res = await chat(request(BODY));
    expect(res.status).toBe(200);
    const body = ChatResponseSchema.parse(await res.json());
    expect(body.reply).toBe("Here are 3 more.");
    expect(body.actions).toEqual([{ type: "write_problems", problems: [["4x + 1 = 9"], ["6x - 5 = 13"], ["x + y = 7", "x - y = 1"]] }]);
    expect(body.notes).toEqual([]);
    expect(callsTo("consume_credits")[0].args).toMatchObject({ p_route: "live/chat", p_units: 3 });
    expect(callsTo("refund_credits")).toEqual([]);
    const [primary, fallback, opts] = vi.mocked(chatJsonWithFallback).mock.calls[0];
    expect([primary, fallback]).toEqual([LIVE_MODELS.chat, LIVE_MODELS.chatFallback]);
    const user = String(opts.messages.find((m) => m.role === "user")?.content);
    expect(user).toContain("1. 2x + 3 = 11");
    expect(user).toContain("- 2x = 8");
    expect(user).toContain("student: 3 two-step equations");
    expect(user).toContain("REQUEST: 3 more like these");
  });

  it("invalid actions are dropped, not guessed at; the valid ones stay", async () => {
    modelReplies({
      reply: "Done.",
      actions: [
        { type: "paint", what: "a cat" },
        { type: "graph", relations: ["y = x^{2}"], window: { xMin: 3, xMax: -3 } },
        { type: "write_problems", problems: ["\\text{Solve } 2x = 4", "3x = 12"] },
        { type: "new_screen" },
      ],
    });
    const body = ChatResponseSchema.parse(await (await chat(request(BODY))).json());
    expect(body.actions).toEqual([{ type: "write_problems", problems: [["3x = 12"]] }, { type: "new_screen" }]);
    expect(callsTo("refund_credits")).toEqual([]);
  });

  it("a figure the drawer's check passes goes to the board as it is: no repair call", async () => {
    modelReplies({ reply: "Here is the triangle.", actions: [{ type: "draw_figure", figure: TRIANGLE }] });
    const body = ChatResponseSchema.parse(await (await chat(request({ ...BODY, message: "draw a right triangle with legs 3 and 4" }))).json());
    expect(body.actions).toEqual([{ type: "draw_figure", figure: TRIANGLE }]);
    expect(body.notes).toEqual([]);
    expect(chatJsonWithFallback).toHaveBeenCalledTimes(1);
  });

  it("a figure it has problems with gets ONE repair round-trip with the problems", async () => {
    fake.drawer.check = (spec) => ((spec as { segments?: unknown[] }).segments?.length === 3 ? [] : ["AB is labelled 4 but side BC is not drawn"]);
    const fixed = { ...TRIANGLE, segments: [...TRIANGLE.segments, { from: "A", to: "C", label: "3" }, { from: "B", to: "C", label: "x" }] };
    modelReplies({ reply: "Here is the triangle.", actions: [{ type: "draw_figure", figure: TRIANGLE }] }, { figure: fixed });
    const body = ChatResponseSchema.parse(await (await chat(request(BODY))).json());
    expect(body.actions).toEqual([{ type: "draw_figure", figure: fixed }]);
    expect(chatJsonWithFallback).toHaveBeenCalledTimes(2);
    const repair = String(vi.mocked(chatJsonWithFallback).mock.calls[1][2].messages[1].content);
    expect(repair).toContain("- AB is labelled 4 but side BC is not drawn");
    expect(repair).toContain(JSON.stringify(TRIANGLE));
  });

  it("a repair that still has problems drops the figure: the panel says so and the credits come back", async () => {
    fake.drawer.check = () => ["point D is used but not defined"];
    modelReplies({ reply: "Here is your triangle.", actions: [{ type: "draw_figure", figure: TRIANGLE }] }, { figure: TRIANGLE });
    const res = await chat(request(BODY));
    expect(res.status).toBe(200);
    const body = ChatResponseSchema.parse(await res.json());
    expect(body.actions).toEqual([]);
    expect(body.reply).toBe("Sorry, I couldn't draw that figure.");
    expect(body.refunded).toBe(true);
    expect(chatJsonWithFallback).toHaveBeenCalledTimes(2);
    expect(callsTo("refund_credits")[0].args).toEqual({ p_request_id: callsTo("consume_credits")[0].args?.p_request_id });
  });

  it("at most one repair per request: a second bad figure is dropped without one", async () => {
    fake.drawer.check = () => ["the angle labelled 70° is drawn 52°"];
    modelReplies({ reply: "Two figures.", actions: [{ type: "draw_figure", figure: TRIANGLE }, { type: "draw_figure", figure: TRIANGLE }] }, { figure: TRIANGLE });
    const body = ChatResponseSchema.parse(await (await chat(request(BODY))).json());
    expect(body.actions).toEqual([]);
    expect(chatJsonWithFallback).toHaveBeenCalledTimes(2);
  });

  it("a repair call that fails drops the figure (the request still answers)", async () => {
    fake.drawer.check = () => ["zero-length side"];
    modelReplies({ reply: "Two problems and the triangle.", actions: [{ type: "write_problems", problems: ["2x = 8", "3x = 9"] }, { type: "draw_figure", figure: TRIANGLE }] });
    vi.mocked(chatJsonWithFallback).mockRejectedValueOnce(new UpstreamError(504, "slow"));
    const body = ChatResponseSchema.parse(await (await chat(request(BODY))).json());
    expect(body.actions).toEqual([{ type: "write_problems", problems: [["2x = 8"], ["3x = 9"]] }]);
    expect(body.notes).toEqual(["The figure couldn't be drawn."]);
    expect(body.refunded).toBeUndefined();
    expect(callsTo("refund_credits")).toEqual([]);
  });

  it("a new screen made only for a figure that could not be drawn is not made", async () => {
    fake.drawer.check = () => ["point D is used but not defined"];
    modelReplies({ reply: "Here is the triangle.", actions: [{ type: "new_screen" }, { type: "draw_figure", figure: TRIANGLE }] }, { figure: TRIANGLE });
    const body = ChatResponseSchema.parse(await (await chat(request(BODY))).json());
    expect(body.actions).toEqual([]);
    expect(body.reply).toBe("Sorry, I couldn't draw that figure.");
    expect(body.refunded).toBe(true);
  });

  it("a polite no: no actions proposed, the charge is kept", async () => {
    modelReplies({ reply: "I can only help with maths on this board.", actions: [] });
    const body = ChatResponseSchema.parse(await (await chat(request({ ...BODY, message: "write me an essay" }))).json());
    expect(body.actions).toEqual([]);
    expect(body.reply).toBe("I can only help with maths on this board.");
    expect(callsTo("refund_credits")).toEqual([]);
  });

  it("a provider failure is a 502, refunded with the same request id", async () => {
    vi.mocked(chatJsonWithFallback).mockRejectedValue(new UpstreamError(502, "Model output failed validation"));
    const res = await chat(request(BODY));
    expect(res.status).toBe(502);
    expect(res.headers.get("X-Request-Id")).toBeTruthy();
    const charged = callsTo("consume_credits")[0].args?.p_request_id;
    expect(callsTo("refund_credits")[0].args).toEqual({ p_request_id: charged });
  });

  it("402 when out of credits, before any model call", async () => {
    fake.replies.consume_credits = () => ({ data: { ok: false, remaining: 1, reason: "insufficient_credits" } });
    const res = await chat(request(BODY));
    expect(res.status).toBe(402);
    expect(await res.json()).toMatchObject({ error: "credits_exhausted" });
    expect(chatJsonWithFallback).not.toHaveBeenCalled();
  });
});
