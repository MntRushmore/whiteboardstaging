/**
 * POST /api/live/recognize when the recognizer reads nothing — the path behind the board's "The
 * tutor service had a hiccup" that left no server row (production, 2026-10-01..07: 12 of them, 4
 * kids, mostly iPads). With fakes for supabase-js, Mathpix, the vision model and the app events:
 *
 *  - Mathpix answering that it could not read the ink is `unreadable` on the 502 and an `info`
 *    event, never a `recognizer_failed` warn; a Mathpix timeout is `transient` and a warn;
 *  - the crop retry (`cropOnly`) goes straight to vision: Mathpix is not asked about the same
 *    strokes twice;
 *  - a vision read slower than the client's 6 s is the server's 504 (an event), not a client that
 *    silently went away.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const fake = vi.hoisted(() => ({
  GOOD_TOKEN: "aaaa.bbbb.cccc",
  USER_ID: "11111111-2222-4333-8444-555555555555",
  mathpix: null as unknown,
}));

vi.mock("@supabase/supabase-js", () => ({
  createClient: () => ({
    auth: {
      getUser: async (token: string) =>
        token === fake.GOOD_TOKEN ? { data: { user: { id: fake.USER_ID, email: "qa@example.com" } }, error: null } : { data: { user: null }, error: { message: "invalid token" } },
    },
    rpc: async () => ({ data: null, error: { message: "no database in this test" } }),
  }),
}));
vi.mock("@/lib/server/events", () => ({ recordEvent: vi.fn(), recordEventNow: vi.fn(async () => undefined) }));
vi.mock("@/lib/server/openrouter", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/server/openrouter")>();
  return { ...actual, chatJson: vi.fn() };
});
vi.mock("@/lib/server/mathpix", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/server/mathpix")>();
  return { ...actual, isMathpixConfigured: () => true, recognizeStrokes: vi.fn(async () => fake.mathpix) };
});

import { resetServerEnvCache } from "@/lib/env";
import { logger } from "@/lib/logger";
import { recordEvent } from "@/lib/server/events";
import { recognizeStrokes } from "@/lib/server/mathpix";
import { chatJson } from "@/lib/server/openrouter";
import { resetRateLimits } from "@/lib/server/rate-limit";
import { POST as recognize } from "@/app/api/live/recognize/route";

const ENV_VARS = ["BILLING_ENFORCE", "RATE_LIMIT_BACKEND", "NEXT_PUBLIC_SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_ANON_KEY", "OPENROUTER_API_KEY", "SUPABASE_SERVICE_ROLE_KEY"] as const;
const saved: Record<string, string | undefined> = {};

const IMAGE = "data:image/jpeg;base64,/9j/4AAQSkZJRgABAQ==";
const BODY = { boardId: "board-1", lineId: "ln_1", strokes: { x: [[1, 2, 3]], y: [[1, 2, 3]] }, bounds: { w: 100, h: 40 } };

function request(body: unknown, signal?: AbortSignal): Request {
  return new Request("http://localhost/api/live/recognize", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${fake.GOOD_TOKEN}` },
    body: JSON.stringify(body),
    signal,
  });
}

const events = () => vi.mocked(recordEvent).mock.calls.map(([e]) => e);

beforeEach(() => {
  for (const name of ENV_VARS) saved[name] = process.env[name];
  process.env.NEXT_PUBLIC_SUPABASE_URL = "http://127.0.0.1:54321";
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "anon-key";
  process.env.OPENROUTER_API_KEY = "sk-or-test";
  process.env.BILLING_ENFORCE = "0";
  process.env.RATE_LIMIT_BACKEND = "memory";
  delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  resetServerEnvCache();
  resetRateLimits();
  vi.mocked(recordEvent).mockReset();
  vi.mocked(recognizeStrokes).mockClear();
  vi.mocked(chatJson).mockReset();
  logger.level = "silent";
});

afterEach(() => {
  vi.useRealTimers();
  for (const name of ENV_VARS) {
    if (saved[name] === undefined) delete process.env[name];
    else process.env[name] = saved[name];
  }
  resetServerEnvCache();
  logger.level = process.env.LOG_LEVEL || "info";
});

describe("live/recognize: a read that read nothing is an event, and says why", () => {
  it("Mathpix could not read the ink: 502 with `unreadable` (+ needsCrop), an info event `unreadable`", async () => {
    fake.mathpix = { ok: false, reason: "api_error", status: 200, detail: "image_no_content" };
    const res = await recognize(request(BODY));
    expect(res.status).toBe(502);
    const body = await res.json();
    expect(body).toMatchObject({ error: "recognizer_failed", needsCrop: true, unreadable: true });
    expect(body).not.toHaveProperty("transient");
    const requestId = res.headers.get("X-Request-Id");
    expect(events()).toEqual([
      expect.objectContaining({
        source: "server",
        level: "info",
        kind: "route.live.recognize",
        code: "unreadable",
        route: "/api/live/recognize",
        userId: fake.USER_ID,
        requestId,
        meta: expect.objectContaining({ status: 502, reason: "api_error", detail: "image_no_content", hadCrop: false, needsCrop: true, unreadable: true }),
      }),
    ]);
  });

  it("Mathpix timed out: 502 with `transient`, a warn event `recognizer_failed` (the Mathpix event is its own)", async () => {
    fake.mathpix = { ok: false, reason: "timeout" };
    const res = await recognize(request(BODY));
    expect(res.status).toBe(502);
    expect(await res.json()).toMatchObject({ error: "recognizer_failed", needsCrop: true, transient: true });
    expect(events()).toEqual([expect.objectContaining({ level: "warn", kind: "route.live.recognize", code: "recognizer_failed", meta: expect.objectContaining({ reason: "timeout" }) })]);
  });

  it("a read that worked records nothing", async () => {
    fake.mathpix = { ok: true, latex: "x=4", text: "x=4", confidence: 0.97, raw: {} };
    const res = await recognize(request(BODY));
    expect(res.status).toBe(200);
    expect(events()).toEqual([]);
  });
});

describe("live/recognize: the crop retry", () => {
  it("`cropOnly` with a crop goes straight to vision: Mathpix is not asked about the same strokes again", async () => {
    fake.mathpix = { ok: false, reason: "api_error" };
    vi.mocked(chatJson).mockResolvedValue({ latex: "x=4", text: "x=4", confidence: 0.4, isMath: true } as never);
    const res = await recognize(request({ ...BODY, crop: IMAGE, cropOnly: true }));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ latex: "x=4", provider: "vision", confidence: 0.4 });
    expect(recognizeStrokes).not.toHaveBeenCalled();
    expect(chatJson).toHaveBeenCalledTimes(1);
  });

  it("a crop without `cropOnly` (the vision recognizer's first read) still tries Mathpix first", async () => {
    fake.mathpix = { ok: true, latex: "x=4", text: "x=4", confidence: 0.97, raw: {} };
    const res = await recognize(request({ ...BODY, crop: IMAGE }));
    expect(res.status).toBe(200);
    expect(recognizeStrokes).toHaveBeenCalledTimes(1);
    expect(chatJson).not.toHaveBeenCalled();
  });

  it("a vision read slower than the client waits is the server's own 504, recorded as a timeout", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
    // AbortSignal.timeout is not faked: stand in a controllable one
    const timeouts: Array<{ ms: number; ctrl: AbortController }> = [];
    const spy = vi.spyOn(AbortSignal, "timeout").mockImplementation((ms: number) => {
      const ctrl = new AbortController();
      timeouts.push({ ms, ctrl });
      return ctrl.signal;
    });
    vi.mocked(chatJson).mockImplementation(
      ({ signal }) =>
        new Promise((_resolve, reject) => {
          signal?.addEventListener("abort", () => reject(Object.assign(new Error("This operation was aborted"), { name: "AbortError" })));
        }),
    );
    const pending = recognize(request({ ...BODY, crop: IMAGE, cropOnly: true }));
    await vi.waitFor(() => expect(timeouts).toHaveLength(1));
    // 5 s from the start of the request: a second before the client's 6 s
    expect(timeouts[0].ms).toBeGreaterThan(4_000);
    expect(timeouts[0].ms).toBeLessThanOrEqual(5_000);
    timeouts[0].ctrl.abort(new DOMException("timed out", "TimeoutError"));
    const res = await pending;
    spy.mockRestore();
    expect(res.status).toBe(502);
    expect(await res.json()).toMatchObject({ error: "upstream_error" });
    expect(events()).toEqual([expect.objectContaining({ level: "error", kind: "route.live.recognize", code: "timeout", meta: expect.objectContaining({ upstreamStatus: 504 }) })]);
  });
});
