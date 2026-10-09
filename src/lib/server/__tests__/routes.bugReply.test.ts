/**
 * POST /api/bug-reports/<id>/messages, a reporter writing back on their own bug report, through its
 * real handler. supabase-js is faked for what the route does as the user (verifying the JWT, the
 * per-user rate limit, bug_report_reply()); the operator's email comes from `emailDeps`, replaced
 * with the fakes in src/lib/email/__tests__/fakes.ts. The contract: 401 before anything, 429 before
 * any write, 400 for a bad id or body, the function's refusals as 404 / 400 / 429 / 503, the stored
 * message back, and ALERT_EMAIL told after the answer (never the reply's failure).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.hoisted(() => {
  process.env.LOG_LEVEL = "silent";
});

const fake = vi.hoisted(() => ({
  GOOD_TOKEN: "aaaa.bbbb.cccc",
  USER_ID: "11111111-2222-4333-8444-555555555555",
  EMAIL: "maya@example.com" as string | null,
  rateLimit: { allowed: true, remaining: 5, retry_after_ms: 0, backend: "db" } as Record<string, unknown>,
  reply: { data: null as unknown, error: null as null | { message: string; code?: string; hint?: string } },
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
      if (fn === "rate_limit_hit") return { data: fake.rateLimit, error: null };
      if (fn === "bug_report_reply") return fake.reply;
      return { data: null, error: { message: `no fake for ${fn}` } };
    },
  }),
}));

const mail = vi.hoisted(() => ({ current: null as import("@/lib/email/server").EmailDeps | null }));
vi.mock("@/lib/email/server", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/email/server")>();
  const pick = () => mail.current ?? real.emailDeps;
  return {
    ...real,
    emailDeps: {
      getEnv: () => pick().getEnv(),
      send: (m: Parameters<typeof real.emailDeps.send>[0], c: Parameters<typeof real.emailDeps.send>[1]) => pick().send(m, c),
    },
  };
});

import { POST } from "@/app/api/bug-reports/[id]/messages/route";
import { BugReplyResultSchema } from "@/lib/bugReports/contracts";
import { fakeDeps, testEnv, type FakeDeps } from "@/lib/email/__tests__/fakes";
import { resetServerEnvCache } from "@/lib/env";
import { resetRateLimitFallbackWarning, resetRateLimits } from "@/lib/server/rate-limit";

const REPORT = "0f8fad5b-d9cb-469f-a165-70867728950e";
const STORED = { id: "7c9e6679-7425-40de-944b-e07fc1f90ae7", author: "reporter", body: "It happens again on my iPad", at: "2026-10-09T15:00:00.000+00:00" };
const ENV_VARS = ["NEXT_PUBLIC_SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_ANON_KEY", "OPENROUTER_API_KEY", "RATE_LIMIT_BACKEND"];
const saved: Record<string, string | undefined> = {};
let deps: FakeDeps;

const post = (id: string, body: unknown, token: string | null = fake.GOOD_TOKEN) =>
  POST(
    new Request(`http://localhost/api/bug-reports/${id}/messages`, {
      method: "POST",
      headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), "Content-Type": "application/json" },
      body: typeof body === "string" ? body : JSON.stringify(body),
    }),
    { params: Promise.resolve({ id }) },
  );

beforeEach(() => {
  for (const v of ENV_VARS) saved[v] = process.env[v];
  process.env.NEXT_PUBLIC_SUPABASE_URL = "http://127.0.0.1:54321";
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "anon-key";
  process.env.OPENROUTER_API_KEY = "sk-or-test";
  delete process.env.RATE_LIMIT_BACKEND;
  resetServerEnvCache();
  resetRateLimits();
  resetRateLimitFallbackWarning();
  fake.EMAIL = "maya@example.com";
  fake.rateLimit = { allowed: true, remaining: 5, retry_after_ms: 0, backend: "db" };
  fake.reply = { data: STORED, error: null };
  fake.rpcCalls.length = 0;
  deps = fakeDeps();
  mail.current = deps;
});

afterEach(() => {
  for (const v of ENV_VARS) {
    if (saved[v] === undefined) delete process.env[v];
    else process.env[v] = saved[v];
  }
  resetServerEnvCache();
  mail.current = null;
});

const replies = () => fake.rpcCalls.filter((c) => c.fn === "bug_report_reply");

describe("POST /api/bug-reports/<id>/messages", () => {
  it("401 without a token or with a bad one: nothing called", async () => {
    expect((await post(REPORT, { body: "hi" }, null)).status).toBe(401);
    expect((await post(REPORT, { body: "hi" }, "nope.nope.nope")).status).toBe(401);
    expect(fake.rpcCalls).toEqual([]);
  });

  it("429 past the per-minute budget, before any write", async () => {
    fake.rateLimit = { allowed: false, remaining: 0, retry_after_ms: 20_000, backend: "db" };
    const res = await post(REPORT, { body: "hi" });
    expect(res.status).toBe(429);
    expect(res.headers.get("retry-after")).toBe("20");
    expect(replies()).toEqual([]);
    expect(fake.rpcCalls[0]).toMatchObject({ fn: "rate_limit_hit", args: { p_bucket: "bugReply" } });
  });

  it.each([
    ["an id that is not a uuid", "nope", { body: "hi" }],
    ["not JSON", REPORT, "{"],
    ["an empty reply", REPORT, { body: "  \n " }],
    ["a reply over 4,000 characters", REPORT, { body: "x".repeat(4001) }],
  ])("400 for %s, nothing written", async (_what, id, body) => {
    const res = await post(id, body);
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toBe("invalid_request");
    expect(replies()).toEqual([]);
  });

  it("saves it as the user (bug_report_reply, trimmed) and answers the stored message; the operator is told", async () => {
    const res = await post(REPORT, { body: "  It happens again on my iPad \n" });
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(BugReplyResultSchema.parse(await res.json())).toEqual({ message: STORED });
    expect(replies()).toEqual([{ fn: "bug_report_reply", args: { p_report_id: REPORT, p_body: "It happens again on my iPad" } }]);
    await vi.waitFor(() => expect(deps.sent).toHaveLength(1));
    expect(deps.sent[0]).toMatchObject({ to: "owner@example.com", subject: "maya@example.com replied to their bug report" });
    expect(deps.sent[0].text).toContain("It happens again on my iPad");
    expect(deps.sent[0].text).toContain(`/admin/bugs?id=${REPORT}`);
  });

  it.each([
    ["someone else's report, or none (P0002)", { message: "no such bug report", code: "P0002", hint: "bug_report_missing" }, 404, "not_found"],
    ["a length the function refuses (22023)", { message: "a reply is 1 to 4000 characters", code: "22023" }, 400, "invalid_request"],
    ["the day's 20 replies on one report (P0001)", { message: "too many", code: "P0001", hint: "bug_reply_limit" }, 429, "rate_limited"],
    ["the function missing (the migration not applied)", { message: "Could not find the function", code: "PGRST202" }, 503, "feature_unavailable"],
    ["anything else", { message: "boom", code: "XX000" }, 502, "upstream_error"],
  ])("%s: %i, and nobody is emailed", async (_what, error, status, code) => {
    fake.reply = { data: null, error };
    const res = await post(REPORT, { body: "hi" });
    expect(res.status).toBe(status);
    expect(((await res.json()) as { error: string }).error).toBe(code);
    await new Promise((r) => setTimeout(r, 0));
    expect(deps.send).not.toHaveBeenCalled();
  });

  it("the operator's email failing, or not set up, never fails the reply", async () => {
    deps.sendReplies.push({ ok: false, error: "timed out" });
    expect((await post(REPORT, { body: "hi" })).status).toBe(200);
    await vi.waitFor(() => expect(deps.send).toHaveBeenCalledTimes(1));
    mail.current = fakeDeps({ env: testEnv({ alertEmail: null }) });
    expect((await post(REPORT, { body: "hi" })).status).toBe(200);
    await new Promise((r) => setTimeout(r, 0));
    expect(mail.current.send).not.toHaveBeenCalled();
  });
});
