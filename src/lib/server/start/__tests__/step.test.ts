/**
 * POST /api/start/step through its real handler (src/app/api/start/step/route.ts) and its helpers
 * (src/lib/server/start/{http,step}.ts): the same-origin check, the per-visitor limit keyed on
 * Cloudflare's address, the body cap and schema, start_account refused, the day's cap (and its
 * failing open), the details kept, the service role's one call, and that no log line names the
 * journey or the visitor. The service role's client and the logger are fakes; no network.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const fake = vi.hoisted(() => ({
  client: null as null | { rpc: (fn: string, args: Record<string, unknown>) => Promise<{ data: unknown; error: { message: string; code?: string } | null }> },
  calls: [] as Array<{ fn: string; args: Record<string, unknown> }>,
  budget: { allowed: true, remaining: 19_999, retry_after_ms: 0, backend: "db" } as unknown,
  budgetError: null as null | { message: string },
  recordError: null as null | { message: string; code?: string },
  lines: [] as Array<{ level: string; fields: Record<string, unknown>; msg: string }>,
}));

vi.mock("@/lib/server/billing", () => ({
  serviceClient: () => fake.client,
  userClient: () => {
    throw new Error("no user client here");
  },
}));

vi.mock("@/lib/logger", () => {
  const make = () => ({
    child: () => make(),
    error: (fields: Record<string, unknown>, msg: string) => fake.lines.push({ level: "error", fields, msg }),
    warn: (fields: Record<string, unknown>, msg: string) => fake.lines.push({ level: "warn", fields, msg }),
    info: (fields: Record<string, unknown>, msg: string) => fake.lines.push({ level: "info", fields, msg }),
    debug: (fields: Record<string, unknown>, msg: string) => fake.lines.push({ level: "debug", fields, msg }),
  });
  return { logger: make() };
});

import { POST } from "@/app/api/start/step/route";
import { resetServerEnvCache, startDailySteps } from "@/lib/env";
import { resetRateLimits } from "@/lib/server/rate-limit";
import { isSameOrigin, visitorIp } from "@/lib/server/start/http";
import { cleanStartMeta, DAY_MS, resetStartCapWarning, START_STEP_LIMITS, START_STEP_MAX_BYTES, START_STEPS_BUCKET } from "@/lib/server/start/step";
import { START_STEP_API } from "@/lib/start/contracts";

const JOURNEY = "3f2b8c1e-5d4a-4b6c-9e8f-7a1b2c3d4e5f";
const IP = "198.51.100.23";

function post(body: unknown, headers: Record<string, string> = { "sec-fetch-site": "same-origin" }, ip = IP): Request {
  return new Request(`http://localhost:3093${START_STEP_API}`, {
    method: "POST",
    body: typeof body === "string" ? body : JSON.stringify(body),
    headers: { "content-type": "application/json", "cf-connecting-ip": ip, "x-forwarded-for": "172.70.1.1", ...headers },
  });
}

const step = (over: Record<string, unknown> = {}) => ({ journeyId: JOURNEY, event: "start_who", meta: { role: "parent" }, ...over });

async function errorOf(res: Response) {
  return (await res.json()) as { error: string; retryAfterMs?: number };
}

const ENV = ["NEXT_PUBLIC_SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_ANON_KEY", "OPENROUTER_API_KEY", "START_DAILY_STEPS", "NEXT_PUBLIC_SITE_URL"];
const saved: Record<string, string | undefined> = {};

beforeEach(() => {
  for (const name of ENV) saved[name] = process.env[name];
  process.env.NEXT_PUBLIC_SUPABASE_URL = "http://127.0.0.1:54321";
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "anon-key";
  process.env.OPENROUTER_API_KEY = "sk-or-test";
  delete process.env.START_DAILY_STEPS;
  delete process.env.NEXT_PUBLIC_SITE_URL;
  resetServerEnvCache();
  resetRateLimits();
  resetStartCapWarning();
  fake.calls.length = 0;
  fake.lines.length = 0;
  fake.budget = { allowed: true, remaining: 19_999, retry_after_ms: 0, backend: "db" };
  fake.budgetError = null;
  fake.recordError = null;
  fake.client = {
    rpc: async (fn, args) => {
      fake.calls.push({ fn, args });
      if (fn === "global_budget_spend") return fake.budgetError ? { data: null, error: fake.budgetError } : { data: fake.budget, error: null };
      return { data: null, error: fake.recordError };
    },
  };
});

afterEach(() => {
  for (const name of ENV) {
    if (saved[name] === undefined) delete process.env[name];
    else process.env[name] = saved[name];
  }
  resetServerEnvCache();
  vi.unstubAllEnvs();
});

const records = () => fake.calls.filter((c) => c.fn === "record_start_step").map((c) => c.args);

describe("a step", () => {
  it("is spent from the day's cap, then recorded with the service role: 204, no body, not cached", async () => {
    const res = await POST(post(step()));
    expect(res.status).toBe(204);
    expect(await res.text()).toBe("");
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(res.headers.get("x-request-id")).toMatch(/^[0-9a-f-]{36}$/);
    expect(fake.calls).toEqual([
      { fn: "global_budget_spend", args: { p_bucket: START_STEPS_BUCKET, p_amount: 1, p_limit: START_STEP_LIMITS.perDay, p_window_ms: DAY_MS } },
      { fn: "record_start_step", args: { p_journey: JOURNEY, p_event: "start_who", p_meta: { role: "parent" } } },
    ]);
  });

  it("keeps only the details its event may keep: never a name or free text", async () => {
    await POST(post(step({ meta: { role: "kid", name: "Sam" } })));
    await POST(post(step({ event: "start_grade", meta: { grade: 3, course: "basket weaving" } })));
    await POST(post(step({ event: "start_grade", meta: { course: "algebra1" } })));
    await POST(post(step({ event: "start_focus", meta: { count: 2, skills: "fractions" } })));
    await POST(post(step({ event: "start_try_checked", meta: { solved: true } })));
    await POST(post(step({ event: "start_shown", meta: { from: "tiktok" } })));
    await POST(post(step({ event: "start_plan", meta: undefined })));
    expect(records().map((r) => [r.p_event, r.p_meta])).toEqual([
      ["start_who", { role: "kid" }],
      ["start_grade", { grade: 3 }],
      ["start_grade", { course: "algebra1" }],
      ["start_focus", { count: 2 }],
      ["start_try_checked", { solved: true }],
      ["start_shown", null],
      ["start_plan", null],
    ]);
  });

  it("logs no journey, no details and no address", async () => {
    await POST(post(step({ meta: { role: "parent" } })));
    fake.recordError = { message: "boom", code: "XX000" };
    await POST(post(step()));
    const text = JSON.stringify(fake.lines);
    expect(text).not.toContain(JOURNEY);
    expect(text).not.toContain(IP);
    expect(text).not.toContain("parent");
  });
});

describe("refused", () => {
  it("from another site, or anything that does not say it is our page: 403, nothing spent", async () => {
    const others: Record<string, string>[] = [{ "sec-fetch-site": "cross-site" }, { "sec-fetch-site": "same-site" }, { "sec-fetch-site": "none" }, {}, { origin: "https://evil.example" }, { origin: "null" }];
    for (const headers of others) {
      const res = await POST(post(step(), headers));
      expect(res.status, JSON.stringify(headers)).toBe(403);
      expect(await errorOf(res)).toEqual({ error: "invalid_request" });
    }
    expect(fake.calls).toEqual([]);
  });

  it("a body that is not a step: 400; too big: 413; start_account: 400 (only linking records it)", async () => {
    const bad: unknown[] = ["{not json", step({ journeyId: "sam" }), step({ event: "start_teleported" }), step({ meta: { role: "x".repeat(41) } }), step({ meta: { nested: { a: 1 } } }), step({ event: "start_account" })];
    for (const body of bad) {
      const res = await POST(post(body));
      expect(res.status, JSON.stringify(body)).toBe(400);
      expect(await errorOf(res)).toEqual({ error: "invalid_request" });
    }
    const big = await POST(post(step({ pad: "y".repeat(START_STEP_MAX_BYTES) })));
    expect(big.status).toBe(413);
    expect(fake.calls).toEqual([]);
  });

  it("past the visitor's 120 an hour: 429 with retryAfterMs, keyed on Cloudflare's address", async () => {
    for (let i = 0; i < START_STEP_LIMITS.perVisitor.limit; i += 1) expect((await POST(post(step()))).status).toBe(204);
    const res = await POST(post(step()));
    expect(res.status).toBe(429);
    const body = await errorOf(res);
    expect(body.error).toBe("rate_limited");
    expect(body.retryAfterMs).toBeGreaterThan(0);
    expect(Number(res.headers.get("retry-after"))).toBeGreaterThan(0);
    // another visitor behind the same Cloudflare edge has a bucket of their own
    expect((await POST(post(step(), undefined, "198.51.100.24"))).status).toBe(204);
  });

  it("once the day's steps are spent: 429 until the day ends, and nothing recorded", async () => {
    fake.budget = { allowed: false, remaining: 0, retry_after_ms: 3_600_000, backend: "db" };
    const res = await POST(post(step()));
    expect(res.status).toBe(429);
    expect(await errorOf(res)).toEqual({ error: "rate_limited", retryAfterMs: 3_600_000 });
    expect(records()).toEqual([]);
  });

  it("START_DAILY_STEPS sets the day's steps", async () => {
    process.env.START_DAILY_STEPS = "500";
    resetServerEnvCache();
    await POST(post(step()));
    expect(fake.calls[0].args.p_limit).toBe(500);
  });
});

describe("the database", () => {
  it("the day's counter failing lets the step through (fails open), warned once", async () => {
    fake.budgetError = { message: "function global_budget_spend does not exist" };
    expect((await POST(post(step()))).status).toBe(204);
    expect((await POST(post(step()))).status).toBe(204);
    expect(records()).toHaveLength(2);
    expect(fake.lines.filter((l) => l.level === "warn" && /daily cap unavailable/.test(l.msg))).toHaveLength(1);
  });

  it("no service role: 503 unavailable", async () => {
    fake.client = null;
    const res = await POST(post(step()));
    expect(res.status).toBe(503);
    expect(await errorOf(res)).toEqual({ error: "unavailable" });
  });

  it("the function missing or the database failing: 503; the database refusing the step: 400", async () => {
    fake.recordError = { message: "Could not find the function", code: "PGRST202" };
    expect((await POST(post(step()))).status).toBe(503);
    fake.recordError = { message: "new row violates check constraint", code: "23514" };
    const refused = await POST(post(step()));
    expect(refused.status).toBe(400);
    expect(await errorOf(refused)).toEqual({ error: "invalid_request" });
  });

  it("a counter slower than its timeout lets the step through", async () => {
    vi.useFakeTimers();
    try {
      const client = fake.client!;
      fake.client = {
        rpc: (fn, args) => (fn === "global_budget_spend" ? new Promise(() => {}) : client.rpc(fn, args)),
      };
      const pending = POST(post(step()));
      await vi.advanceTimersByTimeAsync(2_000);
      expect((await pending).status).toBe(204);
      expect(records()).toHaveLength(1);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("helpers", () => {
  const req = (headers: Record<string, string>) => new Request("https://www.agathon.app/api/start/step", { method: "POST", headers });

  it("isSameOrigin: the browser's own word first, else an Origin of ours", () => {
    expect(isSameOrigin(req({ "sec-fetch-site": "same-origin" }))).toBe(true);
    expect(isSameOrigin(req({ "sec-fetch-site": "Same-Origin" }))).toBe(true);
    expect(isSameOrigin(req({ "sec-fetch-site": "cross-site", origin: "https://www.agathon.app" }))).toBe(false);
    expect(isSameOrigin(req({ origin: "https://www.agathon.app" }))).toBe(true);
    expect(isSameOrigin(req({ origin: "https://agathon.app" }))).toBe(true);
    expect(isSameOrigin(req({ origin: "https://preview.example", host: "preview.example" }))).toBe(true);
    expect(isSameOrigin(req({ origin: "https://evil.example", host: "www.agathon.app" }))).toBe(false);
    expect(isSameOrigin(req({ origin: "not a url" }))).toBe(false);
    expect(isSameOrigin(req({}))).toBe(false);
  });

  it("isSameOrigin: localhost and plain http only outside production", () => {
    expect(isSameOrigin(req({ origin: "http://localhost:3093" }))).toBe(true);
    vi.stubEnv("NODE_ENV", "production");
    expect(isSameOrigin(req({ origin: "http://localhost:3093" }))).toBe(false);
    expect(isSameOrigin(req({ origin: "http://www.agathon.app" }))).toBe(false);
    expect(isSameOrigin(req({ origin: "https://www.agathon.app" }))).toBe(true);
  });

  it("visitorIp: cf-connecting-ip when it is an address, else the first x-forwarded-for hop", () => {
    expect(visitorIp(req({ "cf-connecting-ip": "2001:db8::1", "x-forwarded-for": "172.70.1.1" }))).toBe("2001:db8::1");
    expect(visitorIp(req({ "cf-connecting-ip": "<script>", "x-forwarded-for": "203.0.113.5, 172.70.1.1" }))).toBe("203.0.113.5");
    expect(visitorIp(req({}))).toBe("unknown");
  });

  it("cleanStartMeta: each event's keys, each only when it is what the event says", () => {
    expect(cleanStartMeta("start_who", { role: "teacher" })).toBeNull();
    expect(cleanStartMeta("start_grade", { grade: 9 })).toBeNull();
    expect(cleanStartMeta("start_grade", { grade: 0 })).toEqual({ grade: 0 });
    expect(cleanStartMeta("start_grade", { grade: 2.5, course: "geometry" })).toEqual({ course: "geometry" });
    expect(cleanStartMeta("start_focus", { count: 4 })).toBeNull();
    expect(cleanStartMeta("start_try_checked", { solved: "yes" })).toBeNull();
    expect(cleanStartMeta("start_try_checked", { solved: false })).toEqual({ solved: false });
    expect(cleanStartMeta("start_handoff", { via: "share" })).toBeNull();
    expect(cleanStartMeta("start_who", undefined)).toBeNull();
  });

  it("startDailySteps: a whole number from 1 to 1,000,000, else the default", () => {
    for (const [raw, want] of [[undefined, 20_000], ["", 20_000], ["0", 20_000], ["-5", 20_000], ["2.5", 20_000], ["abc", 20_000], ["750", 750], ["5000000", 1_000_000]] as const) {
      if (raw === undefined) delete process.env.START_DAILY_STEPS;
      else process.env.START_DAILY_STEPS = raw;
      resetServerEnvCache();
      expect(startDailySteps(20_000), String(raw)).toBe(want);
    }
  });
});
