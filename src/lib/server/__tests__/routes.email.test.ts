/**
 * POST /api/email/welcome and GET /api/cron/trial-reminders, driven through their real handlers.
 * supabase-js is faked for the parts the routes do themselves (verifying the JWT, the per-user rate
 * limit); everything email-specific comes from `emailDeps`, replaced per test with the fakes in
 * src/lib/email/__tests__/fakes.ts. The contract: 401 before anything, 429 before any work, 503
 * on a deployment that cannot send, the recipient never taken from the request, each email once.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.hoisted(() => {
  process.env.LOG_LEVEL = "silent";
});

const fake = vi.hoisted(() => ({
  GOOD_TOKEN: "aaaa.bbbb.cccc",
  USER_ID: "11111111-2222-4333-8444-555555555555",
  EMAIL: "parent@example.com" as string | null,
  rateLimit: { allowed: true, remaining: 4, retry_after_ms: 0, backend: "db" } as Record<string, unknown>,
  rpcCalls: [] as Array<{ fn: string; args?: Record<string, unknown> }>,
}));

vi.mock("@supabase/supabase-js", () => ({
  createClient: () => ({
    auth: {
      getUser: async (token: string) =>
        token === fake.GOOD_TOKEN ? { data: { user: { id: fake.USER_ID, email: fake.EMAIL } }, error: null } : { data: { user: null }, error: { message: "invalid token" } },
    },
    rpc: async (fn: string, args?: Record<string, unknown>) => {
      fake.rpcCalls.push({ fn, args });
      return fn === "rate_limit_hit" ? { data: fake.rateLimit, error: null } : { data: null, error: { message: `no fake for ${fn}` } };
    },
  }),
}));

// The routes take everything email-specific from `emailDeps`; each test brings its own.
const deps = vi.hoisted(() => ({ current: null as import("@/lib/email/server").EmailDeps | null }));
vi.mock("@/lib/email/server", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/email/server")>();
  const pick = () => deps.current ?? real.emailDeps;
  return {
    ...real,
    emailDeps: {
      getEnv: () => pick().getEnv(),
      logStore: () => pick().logStore(),
      readOnboardedAt: (token: string, userId: string) => pick().readOnboardedAt(token, userId),
      findTrials: (from: Date, to: Date) => pick().findTrials(from, to),
      emailOf: (userId: string) => pick().emailOf(userId),
      send: (m: Parameters<typeof real.emailDeps.send>[0], c: Parameters<typeof real.emailDeps.send>[1]) => pick().send(m, c),
      now: () => pick().now(),
      sleep: (ms: number) => pick().sleep(ms),
    },
  };
});

import { GET as trialReminders } from "@/app/api/cron/trial-reminders/route";
import { POST as welcome } from "@/app/api/email/welcome/route";
import { resetServerEnvCache } from "@/lib/env";
import { resetRateLimitFallbackWarning, resetRateLimits } from "@/lib/server/rate-limit";
import { fakeDeps, testEnv, type FakeDeps } from "@/lib/email/__tests__/fakes";
import type { TrialRow } from "@/lib/email/trialReminders";

const ENV_VARS = ["NEXT_PUBLIC_SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_ANON_KEY", "OPENROUTER_API_KEY", "RATE_LIMIT_BACKEND"];
const saved: Record<string, string | undefined> = {};

beforeEach(() => {
  for (const v of ENV_VARS) saved[v] = process.env[v];
  process.env.NEXT_PUBLIC_SUPABASE_URL = "http://127.0.0.1:54321";
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "anon-key";
  process.env.OPENROUTER_API_KEY = "sk-or-test";
  delete process.env.RATE_LIMIT_BACKEND;
  resetServerEnvCache();
  resetRateLimits();
  resetRateLimitFallbackWarning();
  fake.EMAIL = "parent@example.com";
  fake.rateLimit = { allowed: true, remaining: 4, retry_after_ms: 0, backend: "db" };
  fake.rpcCalls.length = 0;
  deps.current = null;
});

afterEach(() => {
  for (const v of ENV_VARS) {
    if (saved[v] === undefined) delete process.env[v];
    else process.env[v] = saved[v];
  }
  resetServerEnvCache();
  deps.current = null;
});

function use(d: FakeDeps): FakeDeps {
  deps.current = d;
  return d;
}

const welcomeRequest = (token: string | null = fake.GOOD_TOKEN, body?: string) =>
  new Request("http://localhost/api/email/welcome", {
    method: "POST",
    headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(body ? { "Content-Type": "application/json" } : {}) },
    body,
  });

describe("POST /api/email/welcome", () => {
  it("401 without a signed-in user, before anything else", async () => {
    const d = use(fakeDeps());
    const res = await welcome(welcomeRequest(null));
    expect(res.status).toBe(401);
    expect(fake.rpcCalls).toEqual([]);
    expect(d.readOnboardedAt).not.toHaveBeenCalled();
    expect(d.send).not.toHaveBeenCalled();
    expect((await welcome(welcomeRequest("not-a-jwt"))).status).toBe(401);
  });

  it("429 over the emailWelcome budget, before any work", async () => {
    const d = use(fakeDeps());
    fake.rateLimit = { allowed: false, remaining: 0, retry_after_ms: 9_000, backend: "db" };
    const res = await welcome(welcomeRequest());
    expect(res.status).toBe(429);
    expect(fake.rpcCalls[0]).toMatchObject({ fn: "rate_limit_hit", args: { p_bucket: "emailWelcome" } });
    expect(d.readOnboardedAt).not.toHaveBeenCalled();
  });

  it("503 on a deployment without RESEND_API_KEY or the service role", async () => {
    const noKey = use(fakeDeps({ env: testEnv({ resend: { apiKey: null } }) }));
    const res = await welcome(welcomeRequest());
    expect(res.status).toBe(503);
    expect(await res.json()).toMatchObject({ error: "feature_unavailable" });
    expect(noKey.log.store.claim).not.toHaveBeenCalled();
    use(fakeDeps({ env: testEnv({ hasServiceRole: false }) }));
    expect((await welcome(welcomeRequest())).status).toBe(503);
  });

  it("sends once, to the account's own address, whatever the request says", async () => {
    const d = use(fakeDeps());
    const res = await welcome(welcomeRequest(fake.GOOD_TOKEN, JSON.stringify({ to: "someone-else@example.com", email: "x@example.com" })));
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(await res.json()).toEqual({ status: "sent" });
    expect(d.sent.map((m) => m.to)).toEqual(["parent@example.com"]);
    expect(d.readOnboardedAt).toHaveBeenCalledWith(fake.GOOD_TOKEN, fake.USER_ID);

    const again = await welcome(welcomeRequest());
    expect(await again.json()).toEqual({ status: "already_sent" });
    expect(d.send).toHaveBeenCalledTimes(1);
  });

  it("answers what it skipped: not onboarded yet, onboarded long ago, no address", async () => {
    use(fakeDeps({ onboardedAt: null }));
    expect(await (await welcome(welcomeRequest())).json()).toEqual({ status: "skipped", reason: "not_onboarded" });
    use(fakeDeps({ onboardedAt: "2026-01-01T00:00:00Z" }));
    expect(await (await welcome(welcomeRequest())).json()).toEqual({ status: "skipped", reason: "not_new" });
    fake.EMAIL = null;
    const d = use(fakeDeps());
    expect(await (await welcome(welcomeRequest())).json()).toEqual({ status: "skipped", reason: "no_email" });
    expect(d.send).not.toHaveBeenCalled();
  });

  it("502 when Resend refuses, and the next call sends", async () => {
    const d = use(fakeDeps());
    d.sendReplies.push({ ok: false, error: "timed out" });
    const res = await welcome(welcomeRequest());
    expect(res.status).toBe(502);
    expect(await res.json()).toMatchObject({ error: "upstream_error" });
    expect(await (await welcome(welcomeRequest())).json()).toEqual({ status: "sent" });
  });

  it("500 when the profile cannot be read, and nothing is sent", async () => {
    const d = use(fakeDeps({ onboardedAt: { error: "permission denied" } }));
    const res = await welcome(welcomeRequest());
    expect(res.status).toBe(500);
    expect(d.send).not.toHaveBeenCalled();
  });
});

const HOUR = 60 * 60 * 1000;
const cronRequest = (opts: { secret?: string | null; query?: string; ip?: string } = {}) =>
  new Request(`http://localhost/api/cron/trial-reminders${opts.query ?? ""}`, {
    headers: {
      "x-forwarded-for": opts.ip ?? "192.0.2.10",
      ...(opts.secret === null ? {} : { Authorization: `Bearer ${opts.secret ?? "unit-cron-secret"}` }),
      "user-agent": "vercel-cron/1.0",
    },
  });

function dueTrial(now: Date): TrialRow {
  return {
    subscriptionId: "sub_due",
    userId: fake.USER_ID,
    status: "trialing",
    trialEnd: new Date(now.getTime() + 60 * HOUR).toISOString(),
    cancelAtPeriodEnd: false,
    cancelAt: null,
  };
}

describe("GET /api/cron/trial-reminders", () => {
  const now = new Date("2026-10-07T15:00:00Z");

  it("401 without the cron secret, or with a wrong one, before reading anything", async () => {
    const d = use(fakeDeps({ now, trials: [dueTrial(now)] }));
    for (const secret of [null, "nope", ""]) {
      const res = await trialReminders(cronRequest({ secret }));
      expect(res.status, String(secret)).toBe(401);
      expect(((await res.json()) as { error: string }).error).toBe("unauthorized");
    }
    expect(d.findTrials).not.toHaveBeenCalled();
    expect(d.send).not.toHaveBeenCalled();
  });

  it("503 without CRON_SECRET, the service role, or (to send) RESEND_API_KEY", async () => {
    use(fakeDeps({ env: testEnv({ cronSecret: undefined }) }));
    expect((await trialReminders(cronRequest())).status).toBe(503);
    use(fakeDeps({ env: testEnv({ hasServiceRole: false }) }));
    expect((await trialReminders(cronRequest())).status).toBe(503);
    const d = use(fakeDeps({ now, env: testEnv({ resend: { apiKey: null } }), trials: [dueTrial(now)] }));
    expect((await trialReminders(cronRequest())).status).toBe(503);
    // a dry run needs no Resend key
    const dry = await trialReminders(cronRequest({ query: "?dryRun=1" }));
    expect(dry.status).toBe(200);
    expect(await dry.json()).toMatchObject({ dryRun: true, wouldSend: ["sub_due"], sent: 0 });
    expect(d.send).not.toHaveBeenCalled();
  });

  it("sends the due reminders once and reports the run", async () => {
    const d = use(fakeDeps({ now, trials: [dueTrial(now)], emails: { [fake.USER_ID]: "parent@example.com" } }));
    const res = await trialReminders(cronRequest());
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(await res.json()).toMatchObject({ dryRun: false, found: 1, due: 1, sent: 1, failed: 0, alreadySent: 0 });
    expect(d.sent.map((m) => m.to)).toEqual(["parent@example.com"]);
    const again = await trialReminders(cronRequest());
    expect(await again.json()).toMatchObject({ sent: 0, alreadySent: 1 });
    expect(d.send).toHaveBeenCalledTimes(1);
  });

  it("500 when the subscriptions cannot be read", async () => {
    use(fakeDeps({ now, trials: { error: 'relation "public.unlimited_subscriptions" does not exist' } }));
    const res = await trialReminders(cronRequest());
    expect(res.status).toBe(500);
    expect(await res.json()).toMatchObject({ error: "internal_error" });
  });

  it("is rate limited per IP", async () => {
    use(fakeDeps({ now, trials: [] }));
    for (let i = 0; i < 10; i++) expect((await trialReminders(cronRequest({ ip: "198.51.100.9" }))).status).toBe(200);
    expect((await trialReminders(cronRequest({ ip: "198.51.100.9" }))).status).toBe(429);
    expect((await trialReminders(cronRequest({ ip: "198.51.100.10" }))).status).toBe(200);
  });
});
