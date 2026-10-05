/**
 * src/lib/server/events.ts: app events written to `app_events` with the service role, over a fake
 * fetch. The contract: a no-op without the service role; one PostgREST insert per event, in
 * snake_case, with the release filled in; invalid events dropped and over-long strings cut; `meta`
 * capped at ~2 KB; the same event for the same user collapsed within 30 s; at most 60 a minute per
 * instance (health events exempt); never a throw, whatever fetch does.
 *
 * The module keeps its guards per instance, so each test imports a fresh copy.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AppEventInput } from "@/lib/admin/contracts";

const ENV_VARS = ["NEXT_PUBLIC_SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_ANON_KEY", "OPENROUTER_API_KEY", "SUPABASE_SERVICE_ROLE_KEY"] as const;
const saved: Record<string, string | undefined> = {};

const USER = "11111111-2222-4333-8444-555555555555";
const OTHER = "99999999-2222-4333-8444-555555555555";
const BOARD = "0b6f8a52-3c1d-4e2f-9a7b-1c2d3e4f5a6b";

type Call = { url: string; init: RequestInit; body: Record<string, unknown> };

let calls: Call[];
let reply: () => Promise<Response>;
let events: typeof import("@/lib/server/events");

const EVENT: AppEventInput = { source: "server", kind: "route.live.solve", code: "upstream", message: "OpenRouter API error (500)", userId: USER };

beforeEach(async () => {
  for (const name of ENV_VARS) saved[name] = process.env[name];
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://example.supabase.co/";
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "anon-key";
  process.env.OPENROUTER_API_KEY = "sk-or-test";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "service-role-test";
  calls = [];
  reply = async () => new Response(null, { status: 201 });
  vi.stubGlobal(
    "fetch",
    vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      calls.push({ url: String(input), init: init ?? {}, body: JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown> });
      return reply();
    }),
  );
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-10-05T12:00:00Z"));
  vi.resetModules();
  const env = await import("@/lib/env");
  env.resetServerEnvCache();
  events = await import("@/lib/server/events");
});

afterEach(async () => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  for (const name of ENV_VARS) {
    if (saved[name] === undefined) delete process.env[name];
    else process.env[name] = saved[name];
  }
  (await import("@/lib/env")).resetServerEnvCache();
});

const advance = (ms: number) => vi.setSystemTime(new Date(Date.now() + ms));

describe("recordEventNow", () => {
  it("inserts one row into app_events with the service role, in snake_case, the release filled in", async () => {
    await events.recordEventNow({ ...EVENT, route: "/api/live/solve", boardId: BOARD, requestId: "req-1", meta: { status: 502, ms: 812 } });
    expect(calls).toHaveLength(1);
    const [call] = calls;
    expect(call.url).toBe("https://example.supabase.co/rest/v1/app_events");
    expect(call.init.method).toBe("POST");
    const headers = new Headers(call.init.headers);
    expect(headers.get("apikey")).toBe("service-role-test");
    expect(headers.get("authorization")).toBe("Bearer service-role-test");
    expect(headers.get("prefer")).toBe("return=minimal");
    expect(call.body).toEqual({
      source: "server",
      level: "error",
      kind: "route.live.solve",
      code: "upstream",
      message: "OpenRouter API error (500)",
      route: "/api/live/solve",
      user_id: USER,
      board_id: BOARD,
      request_id: "req-1",
      meta: { status: 502, ms: 812 },
      release: "dev",
    });
  });

  it("does nothing without SUPABASE_SERVICE_ROLE_KEY", async () => {
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    (await import("@/lib/env")).resetServerEnvCache();
    await events.recordEventNow(EVENT);
    events.recordEvent(EVENT);
    expect(calls).toEqual([]);
  });

  it("drops an invalid event (a kind outside EVENT_KIND, a user id that is not a uuid)", async () => {
    await events.recordEventNow({ ...EVENT, kind: "Route Solve" });
    await events.recordEventNow({ ...EVENT, userId: "not-a-uuid" });
    await events.recordEventNow({ ...EVENT, source: "elsewhere" as never });
    expect(calls).toEqual([]);
  });

  it("cuts over-long strings to the schema's lengths instead of dropping the event", async () => {
    await events.recordEventNow({ ...EVENT, message: "m".repeat(900), code: "c".repeat(60), route: `/${"r".repeat(300)}`, requestId: "q".repeat(80), release: "v".repeat(80) });
    expect(calls).toHaveLength(1);
    const body = calls[0].body;
    expect((body.message as string).length).toBe(500);
    expect((body.code as string).length).toBe(40);
    expect((body.route as string).length).toBe(200);
    expect((body.request_id as string).length).toBe(64);
    expect((body.release as string).length).toBe(64);
  });

  it("stores only text Postgres takes: no NUL, no half of an emoji", async () => {
    await events.recordEventNow({ ...EVENT, message: `a\u0000b${"x".repeat(498)}😀`, meta: { note: "lone \uD83D here" } });
    const body = calls[0].body;
    expect(body.message).toBe(`ab${"x".repeat(498)}`);
    expect(JSON.stringify(body)).not.toMatch(/\\u0000|\\ud83d(?!\\ude00)/i);
    expect((body.meta as { note: string }).note).toBe("lone � here");
  });

  it("caps meta at ~2 KB: the keys that fit are kept and `truncated` says so", async () => {
    await events.recordEventNow({ ...EVENT, meta: { model: "google/gemini-3.5-flash", long: "z".repeat(700), list: Array.from({ length: 800 }, (_, i) => i), ms: 900 } });
    const meta = calls[0].body.meta as Record<string, unknown>;
    expect(new TextEncoder().encode(JSON.stringify(meta)).length).toBeLessThanOrEqual(2048);
    // the big value is skipped, the smaller keys after it still go in
    expect(meta).toMatchObject({ truncated: true, model: "google/gemini-3.5-flash", ms: 900 });
    expect(meta.list).toBeUndefined();
    // a long string is shortened to 500 characters, not dropped
    expect(meta.long).toBe("z".repeat(500));
  });

  it("keeps meta that cannot be serialized out of the way (a cycle) and still records the event", async () => {
    const cyclic: Record<string, unknown> = { a: 1 };
    cyclic.self = cyclic;
    await events.recordEventNow({ ...EVENT, meta: cyclic });
    expect(calls[0].body.meta).toEqual({ truncated: true });
  });

  it("never rejects: a network failure, an error status, a fetch that answers nothing", async () => {
    reply = async () => {
      throw new TypeError("fetch failed");
    };
    await expect(events.recordEventNow(EVENT)).resolves.toBeUndefined();
    reply = async () => new Response(JSON.stringify({ code: "42P01", message: 'relation "public.app_events" does not exist' }), { status: 404 });
    await expect(events.recordEventNow({ ...EVENT, userId: OTHER })).resolves.toBeUndefined();
    reply = async () => undefined as unknown as Response;
    await expect(events.recordEventNow({ ...EVENT, code: "timeout" })).resolves.toBeUndefined();
    expect(calls).toHaveLength(3);
  });
});

describe("recordEvent", () => {
  it("returns at once and never throws, with the insert already on its way", () => {
    let resolveFetch: (r: Response) => void = () => {};
    reply = () => new Promise<Response>((resolve) => (resolveFetch = resolve));
    expect(events.recordEvent(EVENT)).toBeUndefined();
    expect(calls).toHaveLength(1);
    resolveFetch(new Response(null, { status: 201 }));
  });

  it("does not throw when fetch throws synchronously", () => {
    vi.stubGlobal("fetch", () => {
      throw new Error("boom");
    });
    expect(() => events.recordEvent(EVENT)).not.toThrow();
  });
});

describe("repeats collapse", () => {
  it("the same kind, code and message for the same user within 30 s is written once", async () => {
    await events.recordEventNow(EVENT);
    advance(10_000);
    await events.recordEventNow(EVENT);
    expect(calls).toHaveLength(1);
    advance(20_001);
    await events.recordEventNow(EVENT);
    expect(calls).toHaveLength(2);
  });

  it("another user, code or message is another event", async () => {
    await events.recordEventNow(EVENT);
    await events.recordEventNow({ ...EVENT, userId: OTHER });
    await events.recordEventNow({ ...EVENT, code: "timeout" });
    await events.recordEventNow({ ...EVENT, message: "something else" });
    expect(calls).toHaveLength(4);
  });

  it("without a user, the request tells repeats apart (two requests failing alike are two events)", async () => {
    const noUser = { ...EVENT, userId: undefined };
    await events.recordEventNow({ ...noUser, requestId: "r1" });
    await events.recordEventNow({ ...noUser, requestId: "r2" });
    await events.recordEventNow({ ...noUser, requestId: "r2" });
    expect(calls).toHaveLength(2);
  });
});

describe("the per-instance budget", () => {
  it("writes at most 60 events a minute, then drops; the next minute writes again", async () => {
    for (let i = 0; i < 70; i++) await events.recordEventNow({ ...EVENT, message: `failure ${i}` });
    expect(calls).toHaveLength(60);
    advance(60_000);
    await events.recordEventNow({ ...EVENT, message: "after the minute" });
    expect(calls).toHaveLength(61);
  });

  it("health events are not counted against it", async () => {
    for (let i = 0; i < 60; i++) await events.recordEventNow({ ...EVENT, message: `failure ${i}` });
    await events.recordEventNow({ ...EVENT, message: "dropped" });
    await events.recordEventNow({ source: "health", kind: "health.openrouter", code: "upstream", message: "OpenRouter answered 503" });
    expect(calls).toHaveLength(61);
    expect(calls[60].body).toMatchObject({ source: "health", kind: "health.openrouter" });
  });

  it("a collapsed repeat does not spend it", async () => {
    for (let i = 0; i < 100; i++) await events.recordEventNow(EVENT);
    for (let i = 0; i < 59; i++) await events.recordEventNow({ ...EVENT, message: `failure ${i}` });
    expect(calls).toHaveLength(60);
  });
});
