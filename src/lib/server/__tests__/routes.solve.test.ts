/**
 * POST /api/live/solve when the model answers and the board can draw none of it (production,
 * 2026-10-07 06:06: GPT-5.4 mini thought past the 8 s watchdog, DeepSeek answered, every step was
 * refused by the board's interlock, and the student saw "Couldn't solve this one"). The route runs
 * the board's own judge on the steps it sends:
 *  - none usable: the primary is asked ONCE more, with the refused steps and why, and its steps
 *    follow in the same stream;
 *  - still none: an event `unusable_steps` (with the first refusal's reason) and the ink back;
 *  - usable at once: no retry, nothing recorded, the charge kept.
 * And the first call's watchdogs: reasoning is life, the fallback has its own, a deadline in budget.
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const fake = vi.hoisted(() => ({
  GOOD_TOKEN: "aaaa.bbbb.cccc",
  USER_ID: "11111111-2222-4333-8444-555555555555",
  calls: [] as Array<{ fn: string; args?: Record<string, unknown> }>,
}));

vi.mock("@supabase/supabase-js", () => ({
  createClient: () => ({
    auth: {
      getUser: async (token: string) =>
        token === fake.GOOD_TOKEN ? { data: { user: { id: fake.USER_ID, email: "qa@example.com" } }, error: null } : { data: { user: null }, error: { message: "invalid token" } },
    },
    rpc: async (fn: string, args?: Record<string, unknown>) => {
      fake.calls.push({ fn, args });
      if (fn === "rate_limit_hit") return { data: { allowed: true, remaining: 9, retry_after_ms: 0, backend: "db" }, error: null };
      if (fn === "consume_credits") return { data: { ok: true, remaining: 100, reason: null }, error: null };
      if (fn === "refund_ink_for") return { data: { refunded: 10, remaining: 110 }, error: null };
      return { data: null, error: { message: `no fake reply for ${fn}` } };
    },
  }),
}));
vi.mock("@/lib/server/events", () => ({ recordEvent: vi.fn(), recordEventNow: vi.fn(async () => undefined) }));
vi.mock("@/lib/server/openrouter", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/server/openrouter")>();
  return { ...actual, streamWithFallback: vi.fn() };
});

import { resetServerEnvCache } from "@/lib/env";
import { LIVE_MODELS } from "@/lib/live/contracts";
import { logger } from "@/lib/logger";
import { resetBillingWarnings } from "@/lib/server/billing";
import { recordEvent } from "@/lib/server/events";
import { streamWithFallback, type ChatMessage, type FallbackStreamEvent } from "@/lib/server/openrouter";
import { resetRateLimits } from "@/lib/server/rate-limit";
import { POST as solve } from "@/app/api/live/solve/route";

const ENV_VARS = ["BILLING_ENFORCE", "SUPABASE_SERVICE_ROLE_KEY", "RATE_LIMIT_BACKEND", "NEXT_PUBLIC_SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_ANON_KEY", "OPENROUTER_API_KEY", "LIVE_MODEL_SOLVE"] as const;
const saved: Record<string, string | undefined> = {};

const BODY = {
  boardId: "board-1",
  region: { x: 0, y: 0, w: 400, h: 200 },
  lines: [{ id: "l1", latex: "3(x+2)=21", bbox: [0, 0, 1, 1], local: { kind: "equation", verdict: "none" } }],
};
const step = (index: number, latex: string, final = false) => JSON.stringify({ index, latex, explanation: "", final }) + "\n";

/** Each call to streamWithFallback answers with the next script: a model, then these JSON lines. */
let scripts: Array<{ model: string; lines: string[] }>;

function request(): Request {
  return new Request("http://localhost/api/live/solve", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${fake.GOOD_TOKEN}` },
    body: JSON.stringify(BODY),
  });
}

async function frames(res: Response): Promise<Array<{ event: string; data: Record<string, unknown> }>> {
  const text = await res.text();
  return text
    .split("\n\n")
    .filter((f) => f.trim() && !f.startsWith(":"))
    .map((f) => {
      let event = "message";
      let data = "";
      for (const line of f.split("\n")) {
        if (line.startsWith("event:")) event = line.slice(6).trim();
        else if (line.startsWith("data:")) data += line.slice(5).trim();
      }
      return { event, data: JSON.parse(data) as Record<string, unknown> };
    });
}

const events = () => vi.mocked(recordEvent).mock.calls.map(([e]) => e);
const calls = (fn: string) => fake.calls.filter((c) => c.fn === fn);

// the route loads the board's engine (mathjs) on its first solve: load it once, before the clock starts
beforeAll(async () => {
  await import("@/lib/live/engine").then((m) => m.getEngine());
}, 60_000);

beforeEach(() => {
  for (const name of ENV_VARS) saved[name] = process.env[name];
  process.env.NEXT_PUBLIC_SUPABASE_URL = "http://127.0.0.1:54321";
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "anon-key";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "service-role-test";
  process.env.OPENROUTER_API_KEY = "sk-or-test";
  delete process.env.BILLING_ENFORCE;
  delete process.env.RATE_LIMIT_BACKEND;
  delete process.env.LIVE_MODEL_SOLVE;
  resetServerEnvCache();
  resetBillingWarnings();
  resetRateLimits();
  fake.calls.length = 0;
  vi.mocked(recordEvent).mockReset();
  scripts = [];
  vi.mocked(streamWithFallback).mockReset();
  vi.mocked(streamWithFallback).mockImplementation(async function* (): AsyncGenerator<FallbackStreamEvent, void, undefined> {
    const next = scripts.shift();
    if (!next) throw new Error("no script left");
    yield { type: "model", model: next.model };
    for (const line of next.lines) yield { type: "text", text: line };
  });
  logger.level = "silent";
});

afterEach(() => {
  for (const name of ENV_VARS) {
    if (saved[name] === undefined) delete process.env[name];
    else process.env[name] = saved[name];
  }
  resetServerEnvCache();
  logger.level = process.env.LOG_LEVEL || "info";
});

describe("live/solve: steps the board can use", () => {
  it("usable at once: no retry, nothing recorded, the charge kept; the first call's watchdogs", async () => {
    scripts = [{ model: LIVE_MODELS.solve, lines: [step(1, "3x+6=21"), step(2, "3x=15"), step(3, "x=5", true)] }];
    const out = await frames(await solve(request()));
    expect(out.filter((f) => f.event === "step").map((f) => f.data.latex)).toEqual(["3x+6=21", "3x=15", "\\boxed{x=5}"]);
    expect(out.at(-1)).toMatchObject({ event: "done", data: { count: 3 } });
    expect(streamWithFallback).toHaveBeenCalledTimes(1);
    const [primary, fallback, , watchdogMs, limits] = vi.mocked(streamWithFallback).mock.calls[0];
    expect([primary, fallback]).toEqual([LIVE_MODELS.solve, LIVE_MODELS.solveFallback]);
    // reasoning is a sign of life now, and the first wait is longer than the old 8 s
    expect(watchdogMs).toBeGreaterThan(8_000);
    expect(limits).toMatchObject({ primaryThinkingMs: expect.any(Number), fallbackWatchdogMs: expect.any(Number), deadline: expect.any(Number) });
    expect(limits!.deadline! - Date.now()).toBeLessThan(60_000);
    expect(events()).toEqual([]);
    expect(calls("refund_ink_for")).toEqual([]);
  });

  it("none usable: the primary is asked once more with why, and its steps follow in the same stream", async () => {
    scripts = [
      { model: LIVE_MODELS.solveFallback, lines: [step(1, "3u=21"), step(2, "3x=21-y"), step(3, "x=7-y", true)] },
      { model: LIVE_MODELS.solve, lines: [step(1, "x+2=7"), step(2, "x=5", true)] },
    ];
    const out = await frames(await solve(request()));
    const steps = out.filter((f) => f.event === "step").map((f) => f.data);
    expect(steps.map((s) => s.latex)).toEqual(["3u=21", "3x=21-y", "\\boxed{x=7-y}", "x+2=7", "\\boxed{x=5}"]);
    // each answer numbers its own steps (the contract caps an index at 8)
    expect(steps.map((s) => s.index)).toEqual([1, 2, 3, 1, 2]);
    expect(streamWithFallback).toHaveBeenCalledTimes(2);
    const [primary, fallback, opts] = vi.mocked(streamWithFallback).mock.calls[1];
    expect(primary).toBe(LIVE_MODELS.solve);
    expect(fallback).toBe("");
    const last = (opts.messages as ChatMessage[]).at(-1)!;
    expect(last.role).toBe("user");
    expect(String(last.content)).toContain('"u"');
    expect(String(last.content)).toContain("never use");
    expect((opts.messages as ChatMessage[]).at(-2)).toMatchObject({ role: "assistant" });
    expect(out.at(-1)).toMatchObject({ event: "done", data: { count: 5 } });
    expect(events()).toEqual([]);
    expect(calls("refund_ink_for")).toEqual([]);
  });

  it("still none after the retry: an event `unusable_steps` with the first refusal's reason, and the ink back", async () => {
    scripts = [
      { model: LIVE_MODELS.solve, lines: [step(1, "3u=21", true)] },
      { model: LIVE_MODELS.solve, lines: [step(1, "x=5+w", true)] },
    ];
    const res = await solve(request());
    const requestId = res.headers.get("X-Request-Id");
    const out = await frames(res);
    expect(out.at(-1)).toMatchObject({ event: "done" });
    expect(events()).toEqual([
      expect.objectContaining({
        level: "warn",
        kind: "route.live.solve",
        code: "unusable_steps",
        requestId,
        meta: expect.objectContaining({ reason: "unknown-symbol", introduced: "u", retried: true, steps: 2 }),
      }),
    ]);
    expect(calls("refund_ink_for")).toHaveLength(1);
    expect(calls("refund_ink_for")[0].args?.p_request_id).toBe(calls("consume_credits")[0].args?.p_request_id);
  });

  it("a retry that fails leaves the first answer standing: the stream still ends with `done`", async () => {
    scripts = [{ model: LIVE_MODELS.solve, lines: [step(1, "3u=21", true)] }];
    // no second script: the retry throws
    const out = await frames(await solve(request()));
    expect(out.at(-1)).toMatchObject({ event: "done", data: { count: 1 } });
    expect(events()).toEqual([expect.objectContaining({ code: "unusable_steps", meta: expect.objectContaining({ retried: true }) })]);
  });
});
