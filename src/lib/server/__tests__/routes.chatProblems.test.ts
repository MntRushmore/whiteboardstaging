/**
 * POST /api/live/chat's `write_problems`, checked on the server before the board ever sees it
 * (production 2026-10: "I couldn't check that problem, so I didn't write it." 6 times, 2 kids — the
 * board's own check, `verifyProblem`, ran only after the reply, when nothing could be done):
 *  - every problem verifies: the action goes on unchanged, nothing recorded;
 *  - some do not: ONE repair round-trip (told why); a replacement that verifies takes the place,
 *    one that does not is left out with a note and an event `problems_dropped_<reason>`;
 *  - none left: the action is dropped, the reply says so, the ink comes back;
 *  - the route's time budget: every call gets a deadline, and a repair the time does not allow is
 *    not started (an event `budget`).
 * With fakes for supabase-js, OpenRouter (`chatJsonWithFallback`) and the app events; the engine is real.
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
      if (fn === "rate_limit_hit") return { data: { allowed: true, remaining: 11, retry_after_ms: 0, backend: "db" }, error: null };
      if (fn === "consume_credits") return { data: { ok: true, remaining: 100, reason: null }, error: null };
      if (fn === "refund_ink_for") return { data: { refunded: 3, remaining: 103 }, error: null };
      return { data: null, error: { message: `no fake reply for ${fn}` } };
    },
  }),
}));
vi.mock("@/lib/server/events", () => ({ recordEvent: vi.fn(), recordEventNow: vi.fn(async () => undefined) }));
vi.mock("@/lib/server/openrouter", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/server/openrouter")>();
  return { ...actual, chatJsonWithFallback: vi.fn() };
});

import { resetServerEnvCache } from "@/lib/env";
import { ChatResponseSchema } from "@/lib/live/chat/contracts";
import { LIVE_MODELS } from "@/lib/live/contracts";
import { logger } from "@/lib/logger";
import { resetBillingWarnings } from "@/lib/server/billing";
import { recordEvent } from "@/lib/server/events";
import { chatJsonWithFallback, type ChatMessage } from "@/lib/server/openrouter";
import { resetRateLimits } from "@/lib/server/rate-limit";
import { POST as chat } from "@/app/api/live/chat/route";

const ENV_VARS = ["BILLING_ENFORCE", "SUPABASE_SERVICE_ROLE_KEY", "RATE_LIMIT_BACKEND", "NEXT_PUBLIC_SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_ANON_KEY", "OPENROUTER_API_KEY", "LIVE_MODEL_CHAT"] as const;
const saved: Record<string, string | undefined> = {};
const BODY = { boardId: "board-1", message: "4 practice problems", history: [], screen: { empty: true, student: [], tutor: [], problems: [] } };

function request(): Request {
  return new Request("http://localhost/api/live/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${fake.GOOD_TOKEN}` },
    body: JSON.stringify(BODY),
  });
}
const replies = (...rs: unknown[]) => {
  for (const r of rs) vi.mocked(chatJsonWithFallback).mockResolvedValueOnce({ data: r, model: LIVE_MODELS.chat } as never);
};
const events = () => vi.mocked(recordEvent).mock.calls.map(([e]) => e);
const calls = (fn: string) => fake.calls.filter((c) => c.fn === fn);

beforeAll(async () => {
  // the route loads the board's engine on its first check: once, before any test's clock
  await import("@/lib/live/engine").then((m) => m.getEngine());
}, 60_000);

beforeEach(() => {
  for (const name of ENV_VARS) saved[name] = process.env[name];
  process.env.NEXT_PUBLIC_SUPABASE_URL = "http://127.0.0.1:54321";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "service-role-test";
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "anon-key";
  process.env.OPENROUTER_API_KEY = "sk-or-test";
  delete process.env.BILLING_ENFORCE;
  delete process.env.RATE_LIMIT_BACKEND;
  delete process.env.LIVE_MODEL_CHAT;
  resetServerEnvCache();
  resetBillingWarnings();
  resetRateLimits();
  fake.calls.length = 0;
  vi.mocked(recordEvent).mockReset();
  vi.mocked(chatJsonWithFallback).mockReset();
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

describe("live/chat: write_problems checked by the engine before the board sees them", () => {
  it("every problem verifies: unchanged, no repair, nothing recorded; the call carries the route's deadline", async () => {
    replies({ reply: "Here are 2.", actions: [{ type: "write_problems", problems: ["2x + 3 = 11", ["x + y = 10", "x - y = 2"]] }] });
    const res = await chat(request());
    expect(res.status).toBe(200);
    const body = ChatResponseSchema.parse(await res.json());
    expect(body.actions).toEqual([{ type: "write_problems", problems: [["2x + 3 = 11"], ["x + y = 10", "x - y = 2"]] }]);
    expect(body.notes).toEqual([]);
    expect(chatJsonWithFallback).toHaveBeenCalledTimes(1);
    const opts = vi.mocked(chatJsonWithFallback).mock.calls[0][2];
    expect(opts.deadline).toBeGreaterThan(Date.now());
    expect(opts.deadline! - Date.now()).toBeLessThanOrEqual(40_000);
    expect(events()).toEqual([]);
  });

  it("one the engine cannot work out: ONE repair, told why; a replacement that verifies takes its place", async () => {
    replies(
      { reply: "Here are 3.", actions: [{ type: "write_problems", problems: ["2x + 3 = 11", "y = 2x - 5", "3x = 12"] }] },
      { problems: ["5x - 2 = 13"] },
    );
    const body = ChatResponseSchema.parse(await (await chat(request())).json());
    expect(body.actions).toEqual([{ type: "write_problems", problems: [["2x + 3 = 11"], ["5x - 2 = 13"], ["3x = 12"]] }]);
    expect(body.notes).toEqual([]);
    expect(chatJsonWithFallback).toHaveBeenCalledTimes(2);
    const [, , repair] = vi.mocked(chatJsonWithFallback).mock.calls[1];
    expect(repair.title).toBe("Agathon Live - chat problems");
    const told = String((repair.messages as ChatMessage[])[1].content);
    expect(told).toContain('"y = 2x - 5"');
    expect(told).toContain("two letters");
    expect(events()).toEqual([]);
  });

  it("a replacement that does not verify either: left out with a note, and an event with the engine's reason", async () => {
    replies(
      { reply: "Here are 3.", actions: [{ type: "write_problems", problems: ["2x + 3 = 11", "\\binom{5}{2}", "3x = 12"] }] },
      { problems: ["\\binom{6}{3}"] },
    );
    const res = await chat(request());
    const body = ChatResponseSchema.parse(await res.json());
    expect(body.actions).toEqual([{ type: "write_problems", problems: [["2x + 3 = 11"], ["3x = 12"]] }]);
    expect(body.notes).toEqual(["1 of 3 problems couldn't be checked, so I left it out."]);
    expect(events()).toEqual([
      expect.objectContaining({
        level: "warn",
        kind: "route.live.chat",
        code: "problems_dropped_unreadable",
        requestId: res.headers.get("X-Request-Id"),
        meta: expect.objectContaining({ dropped: 1, proposed: 3, reasons: "unreadable", repaired: true }),
      }),
    ]);
    expect(calls("refund_ink_for")).toEqual([]);
  });

  it("none left after the repair: the set is dropped, the reply says so, and the ink comes back", async () => {
    replies({ reply: "Here are 2.", actions: [{ type: "write_problems", problems: ["y = 2x + 3", "x^{2} + y^{2} = 25"] }] }, { problems: ["y = 3x", "2x + y = 7"] });
    const body = ChatResponseSchema.parse(await (await chat(request())).json());
    expect(body.actions).toEqual([]);
    expect(body.reply).toMatch(/couldn't check those problems/);
    expect(body.refunded).toBe(true);
    expect(calls("refund_ink_for")).toHaveLength(1);
    expect(events()).toEqual([expect.objectContaining({ code: "problems_dropped_unsolved", meta: expect.objectContaining({ dropped: 2, setsDropped: 1 }) })]);
  });

  it("a repair the route's time does not allow is not started: left out as it was, and an event `budget`", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.mocked(chatJsonWithFallback).mockImplementationOnce(async () => {
      // the main call took 36 s of the 40 s budget
      vi.setSystemTime(Date.now() + 36_000);
      return { data: { reply: "Here are 2.", actions: [{ type: "write_problems", problems: ["2x + 3 = 11", "y = 2x - 5"] }] }, model: LIVE_MODELS.chat } as never;
    });
    const body = ChatResponseSchema.parse(await (await chat(request())).json());
    expect(chatJsonWithFallback).toHaveBeenCalledTimes(1);
    expect(body.actions).toEqual([{ type: "write_problems", problems: [["2x + 3 = 11"]] }]);
    expect(events().map((e) => e.code).sort()).toEqual(["budget", "problems_dropped_unsolved"]);
  });
});
