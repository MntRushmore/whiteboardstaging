/**
 * SAT mode's server enforcement (docs/SAT-MODE.md "Server enforcement", enforceInk +
 * satTutorGate in src/lib/server/billing.ts, livePreamble's `sat_question_id`): through the real
 * live/recognize handler, with fakes for supabase-js (token verification and every RPC) and Mathpix.
 *
 *  - no `sat_question_id`: the ordinary rules, consume_credits as before, and sat_tutor_spend is
 *    never asked;
 *  - with it, no Unlimited, a pass: answered with NO ink (consume_credits never called), even for a
 *    student whose balance is 0;
 *  - with it, no Unlimited, no pass (or the pass used up): the usual 402 ink_empty, with reason
 *    `sat_tutor`, and nothing read;
 *  - with it, Unlimited: charged as on any board (consume_credits: no ink, the fair-use count);
 *  - a malformed id is a 400; the gate failing is a 503 (fails closed); BILLING_ENFORCE=0 skips it;
 *  - the iPad tutor's routes all pass the id to enforceInk.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const fake = vi.hoisted(() => ({
  TOKEN: "student.token.sig",
  USER_ID: "99999999-2222-4333-8444-555555555555",
  calls: [] as Array<{ fn: string; args?: Record<string, unknown> }>,
  spend: { unlimited: false, allowed: true, reason: null as string | null, remaining: 0 } as Record<string, unknown> | null,
  spendError: null as { message: string } | null,
  mathpix: null as unknown,
}));

vi.mock("@supabase/supabase-js", () => ({
  createClient: () => ({
    auth: {
      getUser: async (token: string) =>
        token === fake.TOKEN ? { data: { user: { id: fake.USER_ID, email: "kid@example.com" } }, error: null } : { data: { user: null }, error: { message: "invalid token" } },
    },
    rpc: async (fn: string, args?: Record<string, unknown>) => {
      fake.calls.push({ fn, args });
      if (fn === "sat_tutor_spend") return fake.spendError ? { data: null, error: fake.spendError } : { data: fake.spend, error: null };
      if (fn === "consume_credits") return { data: { ok: true, remaining: 41, reason: null, ...(fake.spend?.unlimited ? { unlimited: true } : {}) }, error: null };
      if (fn === "refund_ink_for") return { data: { refunded: 1, remaining: 42 }, error: null };
      return { data: null, error: { message: `no fake reply for ${fn}` } };
    },
  }),
}));
vi.mock("@/lib/server/events", () => ({ recordEvent: vi.fn(), recordEventNow: vi.fn(async () => undefined) }));
vi.mock("@/lib/server/mathpix", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/server/mathpix")>();
  return { ...actual, isMathpixConfigured: () => true, recognizeStrokes: vi.fn(async () => fake.mathpix), recognizeImage: vi.fn() };
});

import { resetServerEnvCache } from "@/lib/env";
import { logger } from "@/lib/logger";
import { resetBillingWarnings, SAT_TUTOR_REFUSED_MESSAGE } from "@/lib/server/billing";
import { satQuestionIdOf } from "@/lib/server/live-route";
import { recognizeStrokes } from "@/lib/server/mathpix";
import { resetRateLimitFallbackWarning, resetRateLimits } from "@/lib/server/rate-limit";
import { POST as recognize } from "@/app/api/live/recognize/route";

const ENV_VARS = ["BILLING_ENFORCE", "SUPABASE_SERVICE_ROLE_KEY", "RATE_LIMIT_BACKEND", "NEXT_PUBLIC_SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_ANON_KEY", "OPENROUTER_API_KEY", "RECOGNIZE_CROP_READER", "RECOGNIZE_SECOND_OPINION"] as const;
const saved: Record<string, string | undefined> = {};

const READ_OK = { ok: true, latex: "x=4", text: "x=4", confidence: 0.97, raw: {} };
const RECOGNIZE = { boardId: "board-1", lineId: "ln_1", strokes: { x: [[1, 2, 3]], y: [[1, 2, 3]] }, bounds: { w: 100, h: 40 } };
const SAT_ID = "algebra-linear-functions-0001";

function post(body: unknown): Request {
  return new Request("http://localhost/api/live/recognize", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${fake.TOKEN}` },
    body: JSON.stringify(body),
  });
}
const fns = () => fake.calls.map((c) => c.fn);

beforeEach(() => {
  for (const name of ENV_VARS) {
    saved[name] = process.env[name];
    delete process.env[name];
  }
  process.env.NEXT_PUBLIC_SUPABASE_URL = "http://127.0.0.1:54321";
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "anon-key";
  process.env.OPENROUTER_API_KEY = "sk-or-test";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "service-role-test";
  process.env.BILLING_ENFORCE = "1";
  process.env.RATE_LIMIT_BACKEND = "memory";
  resetServerEnvCache();
  resetBillingWarnings();
  resetRateLimits();
  resetRateLimitFallbackWarning();
  fake.calls.length = 0;
  fake.spend = { unlimited: false, allowed: true, reason: null, remaining: 0 };
  fake.spendError = null;
  fake.mathpix = READ_OK;
  vi.mocked(recognizeStrokes).mockClear();
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

describe("an SAT page's live call (live/recognize)", () => {
  it("without sat_question_id: the ordinary rules (consume_credits), the SAT gate never asked", async () => {
    for (const body of [RECOGNIZE, { ...RECOGNIZE, sat_question_id: null }]) {
      fake.calls.length = 0;
      const res = await recognize(post(body));
      expect(res.status).toBe(200);
      expect(fns()).toEqual(["consume_credits"]);
    }
  });

  it("a free student with today's pass: answered with no ink, even with a balance of 0", async () => {
    const res = await recognize(post({ ...RECOGNIZE, sat_question_id: SAT_ID }));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ latex: "x=4" });
    expect(fns()).toEqual(["sat_tutor_spend"]);
    expect(fake.calls[0].args).toEqual({ p_question_id: SAT_ID, p_units: 1 });
  });

  it("a free student without a pass, or with it used up: the usual 402 ink_empty, nothing read", async () => {
    for (const reason of ["no_pass", "pass_used_up"]) {
      fake.calls.length = 0;
      fake.spend = { unlimited: false, allowed: false, reason, remaining: 37 };
      const res = await recognize(post({ ...RECOGNIZE, sat_question_id: SAT_ID }));
      expect(res.status).toBe(402);
      expect(await res.json()).toEqual({ error: "ink_empty", message: SAT_TUTOR_REFUSED_MESSAGE, remaining: 37, cost: 1, buyUrl: "/welcome/plan", reason: "sat_tutor", sat: reason });
      expect(res.headers.get("X-Request-Id")).toBeTruthy();
      expect(recognizeStrokes).not.toHaveBeenCalled();
      expect(fns()).toEqual(["sat_tutor_spend"]);
    }
  });

  it("an Unlimited subscriber: charged as on any board (consume_credits: no ink, the fair-use count)", async () => {
    fake.spend = { unlimited: true, allowed: true, reason: null, remaining: 12 };
    const res = await recognize(post({ ...RECOGNIZE, sat_question_id: SAT_ID }));
    expect(res.status).toBe(200);
    expect(fns()).toEqual(["sat_tutor_spend", "consume_credits"]);
  });

  it("a malformed sat_question_id is a 400 before anything is read or charged", async () => {
    for (const bad of ["drop table", 42, "algebra-linear-functions-1", "ALGEBRA-linear-functions-0001"]) {
      fake.calls.length = 0;
      const res = await recognize(post({ ...RECOGNIZE, sat_question_id: bad }));
      expect(res.status, String(bad)).toBe(400);
      expect(fake.calls).toEqual([]);
    }
  });

  it("the gate failing fails closed (503), as billing does", async () => {
    fake.spendError = { message: "function sat_tutor_spend does not exist" };
    const res = await recognize(post({ ...RECOGNIZE, sat_question_id: SAT_ID }));
    expect(res.status).toBe(503);
    expect(await res.json()).toMatchObject({ error: "feature_unavailable" });
    fake.spendError = null;
    fake.spend = { nonsense: true };
    expect((await recognize(post({ ...RECOGNIZE, sat_question_id: SAT_ID }))).status).toBe(503);
  });

  it("BILLING_ENFORCE=0 skips the gate like the rest of metering", async () => {
    process.env.BILLING_ENFORCE = "0";
    resetServerEnvCache();
    fake.spend = { unlimited: false, allowed: false, reason: "no_pass", remaining: 0 };
    const res = await recognize(post({ ...RECOGNIZE, sat_question_id: SAT_ID }));
    expect(res.status).toBe(200);
    expect(fake.calls).toEqual([]);
  });

  it("a failed read on a pass never charges ink (the route's refund by request id finds nothing to give back)", async () => {
    fake.mathpix = { ok: false, reason: "api_error", status: 200, detail: "image_no_content" };
    const res = await recognize(post({ ...RECOGNIZE, sat_question_id: SAT_ID }));
    expect(res.status).toBe(503);
    // the route refunds any failed call by request id; with no usage_events row it gives back nothing
    expect(fns()[0]).toBe("sat_tutor_spend");
    expect(fns()).not.toContain("consume_credits");
  });
});

describe("satQuestionIdOf", () => {
  it("reads the id, null when absent, invalid otherwise", () => {
    expect(satQuestionIdOf({ sat_question_id: SAT_ID })).toBe(SAT_ID);
    expect(satQuestionIdOf({ sat_question_id: ` ${SAT_ID} ` })).toBe(SAT_ID);
    expect(satQuestionIdOf({})).toBeNull();
    expect(satQuestionIdOf({ sat_question_id: null })).toBeNull();
    expect(satQuestionIdOf(null)).toBeNull();
    expect(satQuestionIdOf([])).toBeNull();
    expect(satQuestionIdOf({ sat_question_id: "nope" })).toBe("invalid");
    expect(satQuestionIdOf({ sat_question_id: 7 })).toBe("invalid");
  });
});

describe("the iPad tutor's routes pass the SAT id to billing", () => {
  const REPO_ROOT = join(__dirname, "..", "..", "..", "..");
  const source = (route: string) => readFileSync(join(REPO_ROOT, "src", "app", "api", route, "route.ts"), "utf8");
  for (const route of ["live/recognize", "live/reread", "live/setup", "live/check", "live/solve", "live/ask", "live/chat", "live/proof"]) {
    it(`${route}: enforceInk carries satQuestionId: ctx.satQuestionId`, () => {
      const call = /\benforceInk\(\s*(\{[^{}]*\})/.exec(source(route));
      expect(call?.[1]).toMatch(/\bsatQuestionId:\s*ctx\.satQuestionId\b/);
    });
  }
});
