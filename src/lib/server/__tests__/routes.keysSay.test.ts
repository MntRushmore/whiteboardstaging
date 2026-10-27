/**
 * POST /api/keys/say (Agathon Keys' tutor line), driven through its real handler with fakes for
 * supabase-js and OpenRouter: 401 first, zod 400, the model's line when it keeps every fact, the
 * fixed line (200, `source: "copy"`) when it does not, when the model fails, and never a charge.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type RpcReply = { data?: unknown; error?: { message: string; code?: string } | null } | Error;

const fake = vi.hoisted(() => ({
  GOOD_TOKEN: "aaaa.bbbb.cccc",
  USER_ID: "11111111-2222-4333-8444-555555555555",
  calls: [] as Array<{ fn: string; args?: Record<string, unknown>; key?: string }>,
  replies: {} as Record<string, (args?: Record<string, unknown>) => RpcReply>,
}));

vi.mock("@supabase/supabase-js", () => ({
  createClient: (_url: string, key: string) => ({
    auth: {
      getUser: async (token: string) =>
        token === fake.GOOD_TOKEN
          ? { data: { user: { id: fake.USER_ID, email: "qa@example.com" } }, error: null }
          : { data: { user: null }, error: { message: "invalid token" } },
    },
    rpc: async (fn: string, args?: Record<string, unknown>) => {
      fake.calls.push({ fn, args, key });
      const reply = fake.replies[fn]?.(args) ?? { error: { message: `no fake reply for ${fn}` } };
      if (reply instanceof Error) throw reply;
      return { data: reply.data ?? null, error: reply.error ?? null };
    },
  }),
}));

vi.mock("@/lib/server/openrouter", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/server/openrouter")>();
  return { ...actual, chatJson: vi.fn() };
});

import { resetServerEnvCache } from "@/lib/env";
import { SayResponseSchema } from "@/lib/keys/say";
import { chatJson, UpstreamError } from "@/lib/server/openrouter";
import { resetRateLimitFallbackWarning, resetRateLimits } from "@/lib/server/rate-limit";
import { POST as say } from "@/app/api/keys/say/route";

const ENV_VARS = ["BILLING_ENFORCE", "SUPABASE_SERVICE_ROLE_KEY", "RATE_LIMIT_BACKEND", "NEXT_PUBLIC_SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_ANON_KEY", "OPENROUTER_API_KEY", "LIVE_MODEL_REREAD", "LIVE_MODEL_TITLE"];
const savedEnv: Record<string, string | undefined> = {};
const COPY = "The 1 you carried is a ten. 1 + 2 + ? = 9";
const BODY = { moment: "smaller", bug: "add_forgot_carry", problem: "26 + ?6 = 92", step: "1 + 2 + ? = 9", level: 2, grade: 2, copy: COPY };

function request(body: unknown, token: string | null = fake.GOOD_TOKEN): Request {
  return new Request("http://localhost/api/keys/say", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

const callsTo = (fn: string) => fake.calls.filter((c) => c.fn === fn);

beforeEach(() => {
  for (const name of ENV_VARS) {
    savedEnv[name] = process.env[name];
    delete process.env[name];
  }
  process.env.NEXT_PUBLIC_SUPABASE_URL = "http://127.0.0.1:54321";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "service-role-test";
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "anon-key";
  process.env.OPENROUTER_API_KEY = "sk-or-test";
  resetServerEnvCache();
  resetRateLimits();
  resetRateLimitFallbackWarning();
  fake.calls.length = 0;
  for (const key of Object.keys(fake.replies)) delete fake.replies[key];
  fake.replies.rate_limit_hit = () => ({ data: { allowed: true, remaining: 9, retry_after_ms: 0, backend: "db" } });
  vi.mocked(chatJson).mockReset();
});

afterEach(() => {
  for (const name of ENV_VARS) {
    if (savedEnv[name] === undefined) delete process.env[name];
    else process.env[name] = savedEnv[name];
  }
  resetServerEnvCache();
});

describe("POST /api/keys/say", () => {
  it("401 without a token, before any model call", async () => {
    const res = await say(request(BODY, null));
    expect(res.status).toBe(401);
    expect(chatJson).not.toHaveBeenCalled();
  });

  it("400 on a body that is not a say request", async () => {
    const res = await say(request({ ...BODY, moment: "shout" }));
    expect(res.status).toBe(400);
    expect(chatJson).not.toHaveBeenCalled();
  });

  it("says the model's line when it keeps every fact, uncharged", async () => {
    vi.mocked(chatJson).mockResolvedValueOnce({ line: "That 1 you carried counts as a ten. Now 1 + 2 + ? = 9" });
    const res = await say(request(BODY));
    expect(res.status).toBe(200);
    expect(res.headers.get("X-Request-Id")).toBeTruthy();
    const body = SayResponseSchema.parse(await res.json());
    expect(body).toMatchObject({ source: "model", line: "That 1 you carried counts as a ten. Now 1 + 2 + ? = 9." });
    expect(callsTo("consume_credits")).toEqual([]);
    const sent = vi.mocked(chatJson).mock.calls[0][0];
    expect(JSON.stringify(sent.messages)).toContain(COPY);
  });

  it("keeps the fixed line when the reply changes a number or says a word the tutor never says", async () => {
    vi.mocked(chatJson).mockResolvedValueOnce({ line: "The missing number is 6, so 1 + 2 + 6 = 9" });
    let body = SayResponseSchema.parse(await (await say(request({ ...BODY, level: 3 }))).json());
    expect(body).toMatchObject({ source: "copy", line: `${COPY}.` });
    vi.mocked(chatJson).mockResolvedValueOnce({ line: "That was wrong. 1 + 2 + ? = 9" });
    body = SayResponseSchema.parse(await (await say(request({ ...BODY, grade: 3 }))).json());
    expect(body.source).toBe("copy");
  });

  it("answers the fixed line, 200, when the model fails or is slow", async () => {
    vi.mocked(chatJson).mockRejectedValueOnce(new UpstreamError(504, "slow"));
    const res = await say(request({ ...BODY, grade: 4 }));
    expect(res.status).toBe(200);
    expect(SayResponseSchema.parse(await res.json())).toMatchObject({ source: "copy", line: `${COPY}.` });
  });
});
