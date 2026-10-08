/**
 * Where app events come from, besides the model calls (modelEvents.test.ts), with recordEvent
 * replaced by a spy:
 *  - errorResponse (request.ts): every 5xx a route answers is `route.<module>.<route>`, with the
 *    request id, user id and API path read from the route's logger; a client's abort is not one;
 *  - runChargedStream (live-route.ts): an SSE route's failure (its `error` frame) is one too;
 *  - recognizeStrokes (mathpix.ts): a failure that is Mathpix's is `mathpix`; an unreadable
 *    scribble is not;
 *  - POST /api/client-errors: each report is an event (`client.<source>` or the report's own kind).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const fake = vi.hoisted(() => ({
  GOOD_TOKEN: "aaaa.bbbb.cccc",
  USER_ID: "11111111-2222-4333-8444-555555555555",
}));

vi.mock("@/lib/server/events", () => ({ recordEvent: vi.fn(), recordEventNow: vi.fn(async () => undefined) }));
vi.mock("@supabase/supabase-js", () => ({
  createClient: () => ({
    auth: {
      getUser: async (token: string) =>
        token === fake.GOOD_TOKEN ? { data: { user: { id: fake.USER_ID, email: "qa@example.com" } }, error: null } : { data: { user: null }, error: { message: "invalid token" } },
    },
  }),
}));

import { resetServerEnvCache } from "@/lib/env";
import { logger } from "@/lib/logger";
import { recordEvent } from "@/lib/server/events";
import { runChargedStream } from "@/lib/server/live-route";
import { recognizeStrokes } from "@/lib/server/mathpix";
import { CreditsExhaustedError, UpstreamError, WatchdogTimeoutError } from "@/lib/server/openrouter";
import { resetRateLimits } from "@/lib/server/rate-limit";
import { errorResponse, eventContext, logContext, recordRouteEvent, routeEventKind } from "@/lib/server/request";
import { enforceInk, resetBillingWarnings, type RpcClient } from "@/lib/server/billing";
import { POST as clientErrors } from "@/app/api/client-errors/route";

const ENV_VARS = ["NEXT_PUBLIC_SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_ANON_KEY", "OPENROUTER_API_KEY", "MATHPIX_APP_ID", "MATHPIX_APP_KEY", "LOG_LEVEL"] as const;
const saved: Record<string, string | undefined> = {};

beforeEach(() => {
  for (const name of ENV_VARS) saved[name] = process.env[name];
  process.env.NEXT_PUBLIC_SUPABASE_URL = "http://127.0.0.1:54321";
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "anon-key";
  process.env.OPENROUTER_API_KEY = "sk-or-test";
  process.env.MATHPIX_APP_ID = "app-id";
  process.env.MATHPIX_APP_KEY = "app-key";
  resetServerEnvCache();
  resetRateLimits();
  vi.mocked(recordEvent).mockReset();
});

afterEach(() => {
  vi.unstubAllGlobals();
  for (const name of ENV_VARS) {
    if (saved[name] === undefined) delete process.env[name];
    else process.env[name] = saved[name];
  }
  resetServerEnvCache();
});

const events = () => vi.mocked(recordEvent).mock.calls.map(([e]) => e);
/** A route's logger, bound as livePreamble binds it (silent: these lines are not under test). */
const liveLog = (route: string, userId: string = fake.USER_ID) => logger.child({ module: "live" }).child({ requestId: "req-9", route, userId });

describe("errorResponse: a 5xx is a route event", () => {
  beforeEach(() => {
    logger.level = "silent";
  });
  afterEach(() => {
    logger.level = process.env.LOG_LEVEL || "info";
  });

  it("an upstream failure: route.live.<route>, code upstream, with the request, the user and the API path", () => {
    const res = errorResponse(new UpstreamError(500, "OpenRouter API error (500)"), liveLog("proof"), { ms: 812, charged: true, note: "not a number" });
    expect(res.status).toBe(502);
    expect(events()).toEqual([
      {
        source: "server",
        level: "error",
        kind: "route.live.proof",
        code: "upstream",
        message: "OpenRouter API error (500)",
        route: "/api/live/proof",
        userId: fake.USER_ID,
        requestId: "req-9",
        meta: { status: 502, upstreamStatus: 500, ms: 812, charged: true },
      },
    ]);
  });

  it("a provider that did not answer in time is `timeout`; out of credits is `credits` (503)", () => {
    errorResponse(new UpstreamError(504, "openai/gpt-5.4-mini did not answer within 12000 ms"), liveLog("setup"));
    expect(errorResponse(new CreditsExhaustedError(), liveLog("chat")).status).toBe(503);
    errorResponse(new WatchdogTimeoutError("m", 40), liveLog("solve"));
    expect(events().map((e) => [e.kind, e.code])).toEqual([
      ["route.live.setup", "timeout"],
      ["route.live.chat", "credits"],
      ["route.live.solve", "timeout"],
    ]);
  });

  it("an unexpected error is `internal`, its name and message kept short", () => {
    const res = errorResponse(new TypeError(`x is not a function ${"y".repeat(400)}`), liveLog("lecture/token"));
    expect(res.status).toBe(500);
    const [e] = events();
    expect(e).toMatchObject({ kind: "route.live.lecture.token", code: "internal", route: "/api/live/lecture/token" });
    expect(e.message?.startsWith("TypeError: x is not a function")).toBe(true);
    expect(e.message?.length).toBeLessThanOrEqual(200);
  });

  it("a client that went away is not an event", () => {
    errorResponse(Object.assign(new Error("aborted"), { name: "AbortError" }), liveLog("solve"));
    expect(events()).toEqual([]);
  });

  it("a logger without the live bindings still names what it can", () => {
    errorResponse(new UpstreamError(500, "OpenRouter credits request failed (500)"), logger.child({ module: "credits" }).child({ requestId: "r", userId: fake.USER_ID }));
    errorResponse(new Error("boom"), liveLog("recognize.GET", "not-a-uuid"));
    expect(events().map((e) => [e.kind, e.route, e.userId])).toEqual([
      ["route.credits", "/api/credits", fake.USER_ID],
      ["route.live.recognize.get", "/api/live/recognize", undefined],
    ]);
  });
});

describe("runChargedStream: an SSE route's error frame is a route event too", () => {
  const rpc = { rpc: vi.fn(async () => ({ data: { refunded: 10, remaining: 100 }, error: null })) };
  beforeEach(() => {
    logger.level = "silent";
  });
  afterEach(() => {
    logger.level = process.env.LOG_LEVEL || "info";
  });

  it("before or after the first step, with `delivered` in meta; never for a client's abort", async () => {
    const fail = (err: unknown, delivered: boolean) =>
      runChargedStream({ userId: fake.USER_ID, requestId: "req-9" }, liveLog("solve"), () => delivered, async () => Promise.reject(err), rpc);
    await expect(fail(new UpstreamError(502, "OpenRouter stream error"), false)).rejects.toThrow();
    await expect(fail(new WatchdogTimeoutError("m", 40), true)).rejects.toThrow();
    await expect(fail(Object.assign(new Error("aborted"), { name: "AbortError" }), false)).rejects.toThrow();
    expect(events()).toEqual([
      expect.objectContaining({ kind: "route.live.solve", code: "upstream", route: "/api/live/solve", userId: fake.USER_ID, requestId: "req-9", meta: { status: 502, upstreamStatus: 502, stream: true, delivered: false } }),
      expect.objectContaining({ kind: "route.live.solve", code: "timeout", meta: { status: 500, stream: true, delivered: true } }),
    ]);
  });

  it("a stream that completes records nothing", async () => {
    await runChargedStream({ userId: fake.USER_ID, requestId: "req-9" }, liveLog("check"), () => true, async () => undefined, rpc);
    expect(events()).toEqual([]);
  });
});

describe("recordRouteEvent: an answer that is not a thrown error, but that a student meets", () => {
  it("route.live.<route> at the caller's level and code, with the route, request and user; only short scalars in meta", () => {
    recordRouteEvent(liveLog("recognize"), {
      level: "info",
      code: "unreadable",
      message: "Mathpix could not read the ink",
      meta: { status: 502, hadCrop: false, reason: "api_error", nested: { no: 1 }, long: "x".repeat(300) },
    });
    expect(events()).toEqual([
      {
        source: "server",
        level: "info",
        kind: "route.live.recognize",
        code: "unreadable",
        message: "Mathpix could not read the ink",
        route: "/api/live/recognize",
        userId: fake.USER_ID,
        requestId: "req-9",
        meta: { status: 502, hadCrop: false, reason: "api_error" },
      },
    ]);
  });
});

describe("enforceInk failing closed: the 503 a student meets as a hiccup is an event", () => {
  beforeEach(() => {
    logger.level = "silent";
    resetBillingWarnings();
  });
  afterEach(() => {
    logger.level = process.env.LOG_LEVEL || "info";
  });

  const rpc = (reply: { data?: unknown; error?: { message: string; code?: string } | null }): RpcClient => ({
    rpc: async () => ({ data: reply.data ?? null, error: reply.error ?? null }),
  });

  it("billing unavailable: an error `billing_unavailable` on the route; out of ink and fair use are not events", async () => {
    const input = { token: "jwt", route: "live/recognize" as const, requestId: "req-9", model: "mathpix" };
    const down = await enforceInk(input, liveLog("recognize"), rpc({ error: { message: "schema cache", code: "PGRST202" } }));
    expect((down as { response: Response }).response.status).toBe(503);
    expect(events()).toEqual([
      expect.objectContaining({ level: "error", kind: "route.live.recognize", code: "billing_unavailable", route: "/api/live/recognize", requestId: "req-9", meta: expect.objectContaining({ status: 503, inkRoute: "live/recognize" }) }),
    ]);
    await enforceInk(input, liveLog("recognize"), rpc({ data: { ok: false, remaining: 0, reason: "insufficient_credits" } }));
    await enforceInk(input, liveLog("recognize"), rpc({ data: { ok: false, remaining: 0, reason: "fair_use", retry_after_ms: 60_000 } }));
    expect(events()).toHaveLength(1);
  });
});

describe("logContext / eventContext / routeEventKind", () => {
  it("read a pino logger's bindings and nothing from anything else", () => {
    expect(logContext(liveLog("solve"))).toEqual({ module: "live", route: "solve", requestId: "req-9", userId: fake.USER_ID });
    expect(logContext({ warn() {} })).toEqual({});
    expect(logContext(null)).toEqual({});
    expect(logContext({ bindings: () => { throw new Error("no"); } })).toEqual({});
    expect(eventContext(undefined)).toEqual({ route: undefined, userId: undefined, requestId: undefined });
    expect(routeEventKind({})).toBe("route.unknown");
    expect(routeEventKind({ module: "Live", route: "Weird Name/Here" })).toBe("route.live.weird_name.here");
  });
});

const PAYLOAD = { x: [[0, 10, 20]], y: [[0, 5, 0]], w: 20, h: 5 };
const mathpixReplies = (reply: () => Promise<Response>) => vi.stubGlobal("fetch", vi.fn(reply));

describe("recognizeStrokes: Mathpix's failures are `mathpix` events", () => {
  const quiet = { warn: () => {} };

  it("rejected credentials: an error `unauthorized`, with the route and user of the route's logger", async () => {
    mathpixReplies(async () => Response.json({ error: "Invalid credentials", error_info: { id: "invalid_credentials" } }, { status: 401 }));
    const log = Object.assign(liveLog("recognize"), { warn: () => {} });
    const out = await recognizeStrokes(PAYLOAD, undefined, { requestId: "req-1", log });
    expect(out).toMatchObject({ ok: false, reason: "auth" });
    expect(events()).toEqual([
      {
        source: "server",
        kind: "mathpix",
        level: "error",
        code: "unauthorized",
        message: "Mathpix rejected our credentials",
        route: "/api/live/recognize",
        userId: fake.USER_ID,
        requestId: "req-1",
        meta: { reason: "auth", status: 401, detail: "Invalid credentials | invalid_credentials" },
      },
    ]);
  });

  it("an error status, a rate limit and an unreachable Mathpix are errors; a timeout is a warn", async () => {
    mathpixReplies(async () => Response.json({}, { status: 500 }));
    await recognizeStrokes(PAYLOAD, undefined, { log: quiet });
    mathpixReplies(async () => Response.json({}, { status: 429 }));
    await recognizeStrokes(PAYLOAD, undefined, { log: quiet });
    mathpixReplies(async () => {
      throw new TypeError("fetch failed");
    });
    await recognizeStrokes(PAYLOAD, undefined, { log: quiet });
    vi.stubGlobal(
      "fetch",
      vi.fn(
        (_u: unknown, init?: RequestInit) =>
          new Promise((_, reject) => init?.signal?.addEventListener("abort", () => reject(Object.assign(new Error("aborted"), { name: "AbortError" })))),
      ),
    );
    await recognizeStrokes(PAYLOAD, undefined, { log: quiet, timeoutMs: 20 });
    expect(events().map((e) => [e.level, e.code, e.message])).toEqual([
      ["error", "upstream", "Mathpix answered HTTP 500"],
      ["error", "rate_limited", "Mathpix answered HTTP 429"],
      ["error", "network", "Mathpix could not be reached"],
      ["warn", "timeout", "Mathpix did not answer in time"],
    ]);
    // no route logger: no route and no user, never this module's own name as a path
    expect(events()[0]).not.toHaveProperty("route", "/api/mathpix");
    expect(events()[3].meta).toEqual({ reason: "timeout", timeoutMs: 20 });
  });

  it("ink Mathpix could not read, and a caller that left, are not events", async () => {
    mathpixReplies(async () => Response.json({ error: "Content not found", error_info: { id: "image_no_content" } }));
    expect(await recognizeStrokes(PAYLOAD, undefined, { log: quiet })).toMatchObject({ ok: false, reason: "api_error" });
    const caller = new AbortController();
    caller.abort();
    vi.stubGlobal("fetch", vi.fn(async () => Promise.reject(Object.assign(new Error("aborted"), { name: "AbortError" }))));
    expect(await recognizeStrokes(PAYLOAD, caller.signal, { log: quiet })).toMatchObject({ ok: false, reason: "aborted" });
    expect(events()).toEqual([]);
  });
});

const BOARD = "0b6f8a52-3c1d-4e2f-9a7b-1c2d3e4f5a6b";
const REPORT = {
  source: "error",
  message: "TypeError: x is not a function at https://app.test/board?token=secret",
  stack: "TypeError: x is not a function\n    at h (https://app.test/_next/static/chunks/c.js?v=1:3:4)\n    at g (c.js:1:1)\n    at f (c.js:1:1)\n    at e (c.js:1:1)\n    at d (c.js:1:1)",
  path: `/board/${BOARD}?q=1`,
  boardId: BOARD,
  userAgent: "Mozilla/5.0 (Macintosh) UA",
  release: "abc1234",
};
const post = (body: unknown, token?: string) =>
  new Request("http://localhost/api/client-errors", {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "x-forwarded-for": "203.0.113.7", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
  });

describe("POST /api/client-errors: each report is an event", () => {
  beforeEach(() => {
    logger.level = "silent";
  });
  afterEach(() => {
    logger.level = process.env.LOG_LEVEL || "info";
  });

  it("a crash: client.<source>, the path as route (no query), the user, the board, the release, the top of the stack", async () => {
    expect((await clientErrors(post({ ...REPORT, digest: "123" }, fake.GOOD_TOKEN))).status).toBe(204);
    const [e] = events();
    expect(e).toMatchObject({
      source: "client",
      level: "error",
      kind: "client.error",
      message: "TypeError: x is not a function at https://app.test/board",
      route: `/board/${BOARD}`,
      userId: fake.USER_ID,
      boardId: BOARD,
      release: "abc1234",
      meta: { digest: "123", userAgent: "Mozilla/5.0 (Macintosh) UA" },
    });
    const stack = (e.meta as { stack: string }).stack;
    expect(stack.split("\n")).toHaveLength(4);
    expect(stack).not.toContain("?v=1");
  });

  it("an error a student saw: source live, the report's own kind and code; signed out, no user", async () => {
    await clientErrors(post({ ...REPORT, source: "live", kind: "live.solve", code: "timeout", message: "The tutor took too long" }));
    expect(events()[0]).toMatchObject({ source: "live", kind: "live.solve", code: "timeout", userId: undefined });
    await clientErrors(post({ ...REPORT, source: "live", message: "Something else" }));
    // no kind: a crash the board's error boundary caught, not an error the student was shown
    expect(events()[1]).toMatchObject({ source: "client", kind: "client.live", level: "error" });
    // out of ink is a state, not an outage: info, from its code (or the level the page sent)
    await clientErrors(post({ ...REPORT, source: "live", kind: "live.check", code: "ink", message: "Out of ink" }));
    expect(events()[2]).toMatchObject({ source: "live", kind: "live.check", level: "info" });
    await clientErrors(post({ ...REPORT, source: "live", kind: "live.chat", code: "note_graph", level: "warn", message: "I couldn't graph that" }));
    expect(events()[3]).toMatchObject({ level: "warn" });
  });

  it("a board id app_events could not store is left out; a refused report is no event", async () => {
    await clientErrors(post({ ...REPORT, boardId: "------------------------------------" }));
    expect(events()[0].boardId).toBeUndefined();
    expect((await clientErrors(post({ ...REPORT, kind: "Not A Kind" }))).status).toBe(400);
    expect(events()).toHaveLength(1);
  });
});
