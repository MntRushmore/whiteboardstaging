/**
 * POST /api/live/lecture/token (lecture mode's speech-to-text token), driven through its real
 * handler with fakes for supabase-js (auth + RPCs) and `fetch` (ElevenLabs). The contract: 401
 * before anything, 429 before the charge, 503 `listen_not_configured` without a key and with
 * nothing charged, 1 credit up front, the SAME request id refunded on any non-2xx, and the server's
 * key never in the answer.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type RpcReply = { data?: unknown; error?: { message: string; code?: string } | null } | Error;

const fake = vi.hoisted(() => ({
  GOOD_TOKEN: "aaaa.bbbb.cccc",
  USER_ID: "11111111-2222-4333-8444-555555555555",
  calls: [] as Array<{ fn: string; args?: Record<string, unknown> }>,
  replies: {} as Record<string, (args?: Record<string, unknown>) => RpcReply>,
}));

vi.mock("@supabase/supabase-js", () => ({
  createClient: () => ({
    auth: {
      getUser: async (token: string) =>
        token === fake.GOOD_TOKEN ? { data: { user: { id: fake.USER_ID, email: "qa@example.com" } }, error: null } : { data: { user: null }, error: { message: "invalid token" } },
    },
    rpc: async (fn: string, args?: Record<string, unknown>) => {
      fake.calls.push({ fn, args });
      const reply = fake.replies[fn]?.(args) ?? { error: { message: `no fake reply for ${fn}` } };
      if (reply instanceof Error) throw reply;
      return { data: reply.data ?? null, error: reply.error ?? null };
    },
  }),
}));

import { resetServerEnvCache } from "@/lib/env";
import { LISTEN_NOT_CONFIGURED, ListenTokenResponseSchema } from "@/lib/live/lecture/contracts";
import { SCRIBE } from "@/lib/live/lecture/speech/scribe";
import { resetBillingWarnings, ROUTE_COSTS } from "@/lib/server/billing";
import { resetRateLimitFallbackWarning, resetRateLimits } from "@/lib/server/rate-limit";
import { POST as token } from "@/app/api/live/lecture/token/route";

const ENV_VARS = ["BILLING_ENFORCE", "RATE_LIMIT_BACKEND", "NEXT_PUBLIC_SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_ANON_KEY", "OPENROUTER_API_KEY", "ELEVENLABS_API_KEY"];
const savedEnv: Record<string, string | undefined> = {};
const KEY = "el-test-key-0123456789";

function request(authToken: string | null = fake.GOOD_TOKEN): Request {
  return new Request("http://localhost/api/live/lecture/token", {
    method: "POST",
    headers: authToken ? { Authorization: `Bearer ${authToken}` } : {},
  });
}
const callsTo = (fn: string) => fake.calls.filter((c) => c.fn === fn);

const fetchMock = vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>();
const upstream = (status: number, body: unknown) => fetchMock.mockResolvedValueOnce(new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } }));

function expectChargedAndRefunded(): void {
  const charged = callsTo("consume_credits");
  const refunded = callsTo("refund_credits");
  expect(charged.length).toBe(1);
  expect(refunded.length).toBe(1);
  expect(refunded[0].args?.p_request_id).toBe(charged[0].args?.p_request_id);
}

beforeEach(() => {
  for (const name of ENV_VARS) {
    savedEnv[name] = process.env[name];
    delete process.env[name];
  }
  process.env.NEXT_PUBLIC_SUPABASE_URL = "http://127.0.0.1:54321";
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "anon-key";
  process.env.OPENROUTER_API_KEY = "sk-or-test";
  process.env.ELEVENLABS_API_KEY = KEY;
  resetServerEnvCache();
  resetBillingWarnings();
  resetRateLimits();
  resetRateLimitFallbackWarning();
  fake.calls.length = 0;
  for (const k of Object.keys(fake.replies)) delete fake.replies[k];
  fake.replies.rate_limit_hit = () => ({ data: { allowed: true, remaining: 5, retry_after_ms: 0, backend: "db" } });
  fake.replies.consume_credits = () => ({ data: { ok: true, remaining: 100, reason: null } });
  fake.replies.refund_credits = () => ({ data: { refunded: 1, remaining: 101 } });
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  for (const name of ENV_VARS) {
    if (savedEnv[name] === undefined) delete process.env[name];
    else process.env[name] = savedEnv[name];
  }
  resetServerEnvCache();
  vi.unstubAllGlobals();
});

describe("POST /api/live/lecture/token", () => {
  it("costs one credit", () => {
    expect(ROUTE_COSTS["live/listen"]).toBe(1);
  });

  it("401 without a signed-in user: nothing charged, ElevenLabs never called", async () => {
    const res = await token(request(null));
    expect(res.status).toBe(401);
    expect(res.headers.get("X-Request-Id")).toMatch(/[0-9a-f-]{36}/);
    expect(callsTo("consume_credits")).toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("429 over the liveListen budget, before the charge", async () => {
    fake.replies.rate_limit_hit = () => ({ data: { allowed: false, remaining: 0, retry_after_ms: 12_000, backend: "db" } });
    const res = await token(request());
    expect(res.status).toBe(429);
    expect(callsTo("rate_limit_hit")[0].args).toMatchObject({ p_bucket: "liveListen" });
    expect(callsTo("consume_credits")).toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("503 listen_not_configured without a key, and nothing charged", async () => {
    delete process.env.ELEVENLABS_API_KEY;
    resetServerEnvCache();
    const res = await token(request());
    expect(res.status).toBe(503);
    const body = (await res.json()) as { error: string; message: string };
    expect(body.error).toBe(LISTEN_NOT_CONFIGURED);
    expect(body.message).toMatch(/not set up/);
    expect(res.headers.get("X-Request-Id")).toBeTruthy();
    expect(callsTo("consume_credits")).toEqual([]);
    expect(callsTo("refund_credits")).toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("a placeholder key counts as no key", async () => {
    process.env.ELEVENLABS_API_KEY = "your-elevenlabs-key";
    resetServerEnvCache();
    expect((await token(request())).status).toBe(503);
    expect(callsTo("consume_credits")).toEqual([]);
  });

  it("402 when the credits are gone: ElevenLabs never called", async () => {
    fake.replies.consume_credits = () => ({ data: { ok: false, remaining: 0, reason: "insufficient_credits" } });
    const res = await token(request());
    expect(res.status).toBe(402);
    expect(((await res.json()) as { error: string }).error).toBe("ink_empty");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("200: a single-use token and the socket URL with it, charged 1 and kept; the key stays on the server", async () => {
    upstream(200, { token: "sutkn_abc123" });
    const before = Date.now();
    const res = await token(request());
    expect(res.status).toBe(200);
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    const text = await res.text();
    expect(text).not.toContain(KEY);
    const body = ListenTokenResponseSchema.parse(JSON.parse(text));
    expect(body.provider).toBe("elevenlabs");
    expect(body.token).toBe("sutkn_abc123");
    const url = new URL(body.url);
    expect(`${url.protocol}//${url.host}${url.pathname}`).toBe("wss://api.elevenlabs.io/v1/speech-to-text/realtime");
    expect(url.searchParams.get("token")).toBe("sutkn_abc123");
    expect(url.searchParams.get("model_id")).toBe("scribe_v2_realtime");
    expect(url.searchParams.get("audio_format")).toBe("pcm_16000");
    expect(url.searchParams.get("commit_strategy")).toBe("vad");
    // 15 minutes, less a safety margin
    expect(body.expiresAt).toBeGreaterThan(before + 14 * 60_000);
    expect(body.expiresAt).toBeLessThanOrEqual(Date.now() + 15 * 60_000);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [calledUrl, init] = fetchMock.mock.calls[0];
    expect(String(calledUrl)).toBe(SCRIBE.tokenUrl);
    expect(init?.method).toBe("POST");
    expect(new Headers(init?.headers).get("xi-api-key")).toBe(KEY);

    expect(callsTo("consume_credits")[0].args).toMatchObject({ p_route: "live/listen", p_units: 1, p_model: "scribe_v2_realtime" });
    expect(callsTo("refund_credits")).toEqual([]);
  });

  it("an ElevenLabs error is a 502, and the same request id is refunded", async () => {
    upstream(500, { detail: "boom" });
    const res = await token(request());
    expect(res.status).toBe(502);
    expect(((await res.json()) as { error: string }).error).toBe("upstream_error");
    expectChargedAndRefunded();
  });

  it("a reply without a token is a 502, refunded", async () => {
    upstream(200, { nope: true });
    expect((await token(request())).status).toBe(502);
    expectChargedAndRefunded();
  });

  it("a key ElevenLabs rejects answers like a missing one (the browser's recognizer), refunded", async () => {
    upstream(401, { detail: { status: "invalid_api_key" } });
    const res = await token(request());
    expect(res.status).toBe(503);
    expect(((await res.json()) as { error: string }).error).toBe(LISTEN_NOT_CONFIGURED);
    expectChargedAndRefunded();
  });

  it("a network failure is refunded", async () => {
    fetchMock.mockRejectedValueOnce(new TypeError("fetch failed"));
    const res = await token(request());
    expect(res.status).toBe(500);
    expectChargedAndRefunded();
  });
});
