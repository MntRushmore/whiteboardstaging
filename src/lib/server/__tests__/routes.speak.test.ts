/**
 * POST /api/live/speak (read aloud), driven through its real handler with fakes for supabase-js
 * (auth + the rate-limit RPC), app events and `fetch` (ElevenLabs). The contract: 401 before
 * anything, 429 from the minute budget and from the day's cap, zod 400, 503 `feature_unavailable`
 * without a key (and for a key ElevenLabs refuses, recorded for /admin), never charged, the text
 * made speakable before it leaves, `audio/mpeg` streamed back with X-Request-Id, and a 502 on an
 * ElevenLabs failure (recorded).
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

vi.mock("@/lib/server/events", () => ({ recordEvent: vi.fn(), recordEventNow: vi.fn(async () => undefined) }));

import { resetServerEnvCache } from "@/lib/env";
import { logger } from "@/lib/logger";
import { SPEAK_MAX_CHARS, SPEAK_RATE_LIMITS } from "@/lib/speech/contracts";
import { TTS } from "@/lib/speech/tts";
import { recordEvent } from "@/lib/server/events";
import { resetRateLimitFallbackWarning, resetRateLimits } from "@/lib/server/rate-limit";
import { POST as speak } from "@/app/api/live/speak/route";

const ENV_VARS = ["BILLING_ENFORCE", "SUPABASE_SERVICE_ROLE_KEY", "RATE_LIMIT_BACKEND", "NEXT_PUBLIC_SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_ANON_KEY", "OPENROUTER_API_KEY", "ELEVENLABS_API_KEY", "LIVE_VOICE_ID"];
const savedEnv: Record<string, string | undefined> = {};
const KEY = "el-test-key-0123456789";
const MP3 = new Uint8Array([0xff, 0xfb, 0x90, 0x64, 0x00, 0x00, 0x00, 0x00]);

function request(body: unknown, token: string | null = fake.GOOD_TOKEN): Request {
  return new Request("http://localhost/api/live/speak", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}
const callsTo = (fn: string) => fake.calls.filter((c) => c.fn === fn);

const fetchMock = vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>();
const audioReply = () => fetchMock.mockResolvedValueOnce(new Response(MP3, { status: 200, headers: { "Content-Type": "audio/mpeg" } }));
const upstream = (status: number, body: unknown) => fetchMock.mockResolvedValueOnce(new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } }));
const sentBody = () => JSON.parse(String(fetchMock.mock.calls[0][1]?.body)) as { text: string; model_id: string };
const events = () => vi.mocked(recordEvent).mock.calls.map(([e]) => e);

beforeEach(() => {
  for (const name of ENV_VARS) {
    savedEnv[name] = process.env[name];
    delete process.env[name];
  }
  process.env.NEXT_PUBLIC_SUPABASE_URL = "http://127.0.0.1:54321";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "service-role-test";
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "anon-key";
  process.env.OPENROUTER_API_KEY = "sk-or-test";
  process.env.ELEVENLABS_API_KEY = KEY;
  resetServerEnvCache();
  resetRateLimits();
  resetRateLimitFallbackWarning();
  fake.calls.length = 0;
  for (const k of Object.keys(fake.replies)) delete fake.replies[k];
  fake.replies.rate_limit_hit = () => ({ data: { allowed: true, remaining: 5, retry_after_ms: 0, backend: "db" } });
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
  vi.mocked(recordEvent).mockReset();
  logger.level = "silent";
});

afterEach(() => {
  vi.unstubAllGlobals();
  for (const name of ENV_VARS) {
    if (savedEnv[name] === undefined) delete process.env[name];
    else process.env[name] = savedEnv[name];
  }
  resetServerEnvCache();
  logger.level = process.env.LOG_LEVEL || "info";
});

describe("POST /api/live/speak", () => {
  it("401 without a token, before any RPC or ElevenLabs call", async () => {
    const res = await speak(request({ text: "Hello" }, null));
    expect(res.status).toBe(401);
    expect(res.headers.get("X-Request-Id")).toBeTruthy();
    expect(fake.calls).toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("429 from the minute budget, before the body or ElevenLabs", async () => {
    fake.replies.rate_limit_hit = () => ({ data: { allowed: false, remaining: 0, retry_after_ms: 900 } });
    const res = await speak(request({ text: "Hello" }));
    expect(res.status).toBe(429);
    expect(callsTo("rate_limit_hit")[0].args).toMatchObject({ p_bucket: "liveSpeak", p_limit: SPEAK_RATE_LIMITS.perMinute.limit });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("429 from the day's cap", async () => {
    fake.replies.rate_limit_hit = (args) =>
      args?.p_bucket === "liveSpeakDay" ? { data: { allowed: false, remaining: 0, retry_after_ms: 3_600_000 } } : { data: { allowed: true, remaining: 5, retry_after_ms: 0 } };
    const res = await speak(request({ text: "Hello" }));
    expect(res.status).toBe(429);
    expect(res.headers.get("Retry-After")).toBe("3600");
    expect(callsTo("rate_limit_hit").map((c) => c.args?.p_bucket)).toEqual(["liveSpeak", "liveSpeakDay"]);
    expect(callsTo("rate_limit_hit")[1].args).toMatchObject({ p_limit: SPEAK_RATE_LIMITS.perDay.limit, p_window_ms: 86_400_000 });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("400 on a bad body: empty, too long, not JSON, extra fields, control characters", async () => {
    expect((await speak(request({ text: "   " }))).status).toBe(400);
    expect((await speak(request({ text: "a".repeat(SPEAK_MAX_CHARS + 1) }))).status).toBe(400);
    expect((await speak(request("{nope"))).status).toBe(400);
    expect((await speak(request({ text: "hi", voice: "x" }))).status).toBe(400);
    expect((await speak(request({ text: "hi\u0007" }))).status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("503 feature_unavailable without ELEVENLABS_API_KEY: nothing sent, nothing recorded", async () => {
    delete process.env.ELEVENLABS_API_KEY;
    resetServerEnvCache();
    const res = await speak(request({ text: "Hello" }));
    expect(res.status).toBe(503);
    expect(((await res.json()) as { error: string }).error).toBe("feature_unavailable");
    expect(fetchMock).not.toHaveBeenCalled();
    expect(events()).toEqual([]);
  });

  it("streams ElevenLabs' MP3 back: flash model, the default voice, speakable words, never charged", async () => {
    audioReply();
    const res = await speak(request({ text: "Try \\frac{3}{4} of x^2 - 1." }));
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("audio/mpeg");
    expect(res.headers.get("Cache-Control")).toBe("private, no-store");
    expect(res.headers.get("X-Request-Id")).toBeTruthy();
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(MP3);

    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toBe(`${TTS.baseUrl}/${TTS.defaultVoiceId}/stream?output_format=${TTS.outputFormat}`);
    expect(new Headers(init?.headers).get("xi-api-key")).toBe(KEY);
    expect(sentBody()).toMatchObject({ text: "Try three quarters of x squared minus 1.", model_id: "eleven_flash_v2_5", language_code: "en" });
    expect(res.headers.get("X-Speech-Chars")).toBe(String(sentBody().text.length));
    expect(callsTo("consume_credits")).toEqual([]);
    // the key never comes back
    expect(JSON.stringify([...res.headers])).not.toContain(KEY);
  });

  it("LIVE_VOICE_ID picks the voice; one that is not a voice id is ignored", async () => {
    process.env.LIVE_VOICE_ID = "EXAVITQu4vr4xnSDxMaL";
    resetServerEnvCache();
    audioReply();
    await speak(request({ text: "Hello" }));
    expect(String(fetchMock.mock.calls[0][0])).toContain("/EXAVITQu4vr4xnSDxMaL/stream");

    process.env.LIVE_VOICE_ID = "../../v1/user";
    resetServerEnvCache();
    audioReply();
    await speak(request({ text: "Hello" }));
    expect(String(fetchMock.mock.calls[1][0])).toContain(`/${TTS.defaultVoiceId}/stream`);
  });

  it("a key ElevenLabs refuses (no Text to Speech permission) is answered like no key, and recorded for /admin", async () => {
    upstream(401, { detail: { status: "missing_permissions", message: "The API key you used is missing the permission text_to_speech to execute this operation." } });
    const res = await speak(request({ text: "Hello" }));
    expect(res.status).toBe(503);
    expect(((await res.json()) as { error: string }).error).toBe("feature_unavailable");
    expect(events()).toEqual([
      expect.objectContaining({
        source: "server",
        level: "error",
        kind: "route.live.speak",
        code: "unauthorized",
        route: "/api/live/speak",
        userId: fake.USER_ID,
        message: expect.stringContaining("missing_permissions"),
      }),
    ]);
  });

  it("spent quota is answered like no key too, with its own code", async () => {
    upstream(401, { detail: { status: "quota_exceeded", message: "This request exceeds your quota." } });
    const res = await speak(request({ text: "Hello" }));
    expect(res.status).toBe(503);
    expect(events()[0]).toMatchObject({ code: "quota" });
  });

  it("an ElevenLabs failure is a 502 upstream_error, recorded", async () => {
    upstream(500, { detail: "boom" });
    const res = await speak(request({ text: "Hello" }));
    expect(res.status).toBe(502);
    expect(((await res.json()) as { error: string }).error).toBe("upstream_error");
    expect(events()[0]).toMatchObject({ kind: "route.live.speak", code: "upstream" });
  });

  it("an ElevenLabs that never answers is a timeout, not a hang", async () => {
    vi.useFakeTimers();
    try {
      fetchMock.mockImplementationOnce(
        (_url, init) =>
          new Promise((_resolve, reject) => {
            init?.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
          }),
      );
      const pending = speak(request({ text: "Hello" }));
      await vi.advanceTimersByTimeAsync(TTS.firstByteTimeoutMs + 10);
      const res = await pending;
      expect(res.status).toBe(502);
      expect(events()[0]).toMatchObject({ kind: "route.live.speak", code: "timeout" });
    } finally {
      vi.useRealTimers();
    }
  });

  it("text that is only markup has nothing to say: 400, nothing sent", async () => {
    const res = await speak(request({ text: "$$ {} $$" }));
    expect(res.status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
