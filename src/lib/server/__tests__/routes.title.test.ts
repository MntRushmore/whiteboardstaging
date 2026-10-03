/**
 * POST /api/live/title (a board's smart name), driven through its real handler with fakes for
 * supabase-js and OpenRouter: 401 before anything, 429 from its own bucket, zod 400, never charged
 * (a name is not something the student asked for), the model's name cleaned, `X-Request-Id` on
 * every response.
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
  return { ...actual, chatJsonWithFallback: vi.fn() };
});

import { resetServerEnvCache } from "@/lib/env";
import { LIVE_MODELS } from "@/lib/live/contracts";
import { TitleResponseSchema } from "@/lib/boards/smartTitle";
import { chatJsonWithFallback, UpstreamError } from "@/lib/server/openrouter";
import { resetRateLimitFallbackWarning, resetRateLimits } from "@/lib/server/rate-limit";
import { POST as title } from "@/app/api/live/title/route";

const ENV_VARS = ["BILLING_ENFORCE", "SUPABASE_SERVICE_ROLE_KEY", "RATE_LIMIT_BACKEND", "NEXT_PUBLIC_SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_ANON_KEY", "OPENROUTER_API_KEY", "LIVE_MODEL_REREAD"];
const savedEnv: Record<string, string | undefined> = {};
const BODY = { boardId: "board-1", lines: ["2 \\sin x = 1", "\\sin x = \\frac{1}{2}"] };

function request(body: unknown, token: string | null = fake.GOOD_TOKEN): Request {
  return new Request("http://localhost/api/live/title", {
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
  vi.mocked(chatJsonWithFallback).mockReset();
});

afterEach(() => {
  for (const name of ENV_VARS) {
    if (savedEnv[name] === undefined) delete process.env[name];
    else process.env[name] = savedEnv[name];
  }
  resetServerEnvCache();
});

describe("POST /api/live/title", () => {
  it("401 without a token, before any RPC or model call", async () => {
    const res = await title(request(BODY, null));
    expect(res.status).toBe(401);
    expect(res.headers.get("X-Request-Id")).toBeTruthy();
    expect(fake.calls).toEqual([]);
    expect(chatJsonWithFallback).not.toHaveBeenCalled();
  });

  it("429 from its own bucket", async () => {
    fake.replies.rate_limit_hit = () => ({ data: { allowed: false, remaining: 0, retry_after_ms: 900 } });
    const res = await title(request(BODY));
    expect(res.status).toBe(429);
    expect(callsTo("rate_limit_hit")[0].args).toMatchObject({ p_bucket: "liveTitle" });
    expect(chatJsonWithFallback).not.toHaveBeenCalled();
  });

  it("400 on a bad body (no lines, too many lines)", async () => {
    expect((await title(request({ boardId: "b", lines: [] }))).status).toBe(400);
    expect((await title(request({ boardId: "b", lines: Array.from({ length: 13 }, (_, i) => `x = ${i}`) }))).status).toBe(400);
    expect((await title(request("{nope"))).status).toBe(400);
  });

  it("names the board on the reread models, uncharged, and cleans the name", async () => {
    vi.mocked(chatJsonWithFallback).mockResolvedValue({ data: { title: '"solving trig equations."' }, model: LIVE_MODELS.reread } as never);
    const res = await title(request(BODY));
    expect(res.status).toBe(200);
    expect(res.headers.get("X-Request-Id")).toBeTruthy();
    const body = TitleResponseSchema.parse(await res.json());
    expect(body.title).toBe("Solving trig equations");
    expect(vi.mocked(chatJsonWithFallback).mock.calls[0][0]).toBe(LIVE_MODELS.reread);
    expect(callsTo("consume_credits")).toEqual([]);
  });

  it("a name with maths in it is no name: null, and the board keeps its first-line name", async () => {
    vi.mocked(chatJsonWithFallback).mockResolvedValue({ data: { title: "2 sin x = 1" }, model: LIVE_MODELS.reread } as never);
    const body = TitleResponseSchema.parse(await (await title(request(BODY))).json());
    expect(body.title).toBeNull();
  });

  it("an upstream failure is the usual error response, with X-Request-Id and no charge", async () => {
    vi.mocked(chatJsonWithFallback).mockRejectedValue(new UpstreamError(502, "Model returned non-JSON output"));
    const res = await title(request(BODY));
    expect(res.status).toBeGreaterThanOrEqual(500);
    expect(res.headers.get("X-Request-Id")).toBeTruthy();
    expect(callsTo("consume_credits")).toEqual([]);
  });
});
