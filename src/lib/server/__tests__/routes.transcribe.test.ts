/**
 * POST /api/live/transcribe (Ask's mic), driven through its real handler with fakes for supabase-js
 * (auth, the rate-limit RPC, ink_summary, the global budget's RPC), app events and `fetch`
 * (ElevenLabs Scribe). The contract: 401 before anything, 429 from `liveTranscribe`, 400/413/415 on
 * a bad recording (a compressed one past 1.2 MB), `source: "none"` for an empty one without any
 * call, 503 `speech_unavailable` without a key, without a plan, once the account's seconds for the
 * day are spent, and once everyone's are (recorded), the recording sent to Scribe batch with the
 * kid's language, the words back (never logged), never charged, both budgets trued up with the
 * length Scribe measured (a long recording in a small file: a 413 and no words), and Scribe's
 * refusals and failures answered and recorded for /admin.
 */
import pino from "pino";
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
import { ASK_LIMITS } from "@/lib/live/ask/contracts";
import { LIVE_RATE_LIMITS } from "@/lib/live/contracts";
import { logger } from "@/lib/logger";
import { TRANSCRIBE_GLOBAL_BUDGET, TRANSCRIBE_USER_DAY_BUDGET } from "@/lib/speech/contracts";
import { SCRIBE_BATCH } from "@/lib/speech/transcribe";
import { recordEvent } from "@/lib/server/events";
import { resetRateLimitFallbackWarning, resetRateLimits } from "@/lib/server/rate-limit";
import { POST as transcribe } from "@/app/api/live/transcribe/route";

const ENV_VARS = ["BILLING_ENFORCE", "SUPABASE_SERVICE_ROLE_KEY", "RATE_LIMIT_BACKEND", "NEXT_PUBLIC_SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_ANON_KEY", "OPENROUTER_API_KEY", "ELEVENLABS_API_KEY"];
const savedEnv: Record<string, string | undefined> = {};
const KEY = "el-test-key-0123456789";
const SAID = "what is seven times eight";

/** A 16 kHz mono 16-bit WAV of `seconds` (a quiet tone: not silence, not that it matters here). */
function wav(seconds: number): Uint8Array {
  const rate = 16_000;
  const samples = Math.round(seconds * rate);
  const bytes = new Uint8Array(44 + samples * 2);
  const view = new DataView(bytes.buffer);
  const put = (at: number, s: string) => [...s].forEach((c, i) => (bytes[at + i] = c.charCodeAt(0)));
  put(0, "RIFF");
  view.setUint32(4, 36 + samples * 2, true);
  put(8, "WAVE");
  put(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, rate, true);
  view.setUint32(28, rate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  put(36, "data");
  view.setUint32(40, samples * 2, true);
  for (let i = 0; i < samples; i++) view.setInt16(44 + i * 2, Math.round(800 * Math.sin(i / 8)), true);
  return bytes;
}

/** A WebM's EBML magic and some bytes after it (what Chrome's MediaRecorder starts with). */
function webm(size = 4_000): Uint8Array {
  const bytes = new Uint8Array(size).fill(7);
  bytes.set([0x1a, 0x45, 0xdf, 0xa3], 0);
  return bytes;
}

function request(fields: { audio?: Uint8Array | string | null; type?: string; lang?: string; seconds?: string } = {}, token: string | null = fake.GOOD_TOKEN): Request {
  const form = new FormData();
  const audio = fields.audio === undefined ? wav(2) : fields.audio;
  if (typeof audio === "string") form.set("audio", audio);
  else if (audio) form.set("audio", new Blob([audio as BlobPart], { type: fields.type ?? "audio/wav" }), "ask.wav");
  if (fields.lang !== undefined) form.set("lang", fields.lang);
  if (fields.seconds !== undefined) form.set("seconds", fields.seconds);
  return new Request("http://localhost/api/live/transcribe", {
    method: "POST",
    headers: token ? { Authorization: `Bearer ${token}` } : {},
    body: form,
  });
}

const callsTo = (fn: string) => fake.calls.filter((c) => c.fn === fn);
const fetchMock = vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>();
const scribeReply = (body: unknown, status = 200) => fetchMock.mockResolvedValueOnce(new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } }));
const heardReply = (text = SAID) =>
  scribeReply({
    language_code: "eng",
    language_probability: 0.98,
    text,
    words: [
      { text: "what", start: 0.1, end: 0.3, type: "word" },
      { text: "eight", start: 1.2, end: 1.6, type: "word" },
    ],
  });
const sentForm = () => fetchMock.mock.calls[0][1]?.body as FormData;
const events = () => vi.mocked(recordEvent).mock.calls.map(([e]) => e);
const errorOf = async (res: Response) => ((await res.json()) as { error: string }).error;

const hoursAgo = (h: number) => new Date(Date.now() - h * 3_600_000).toISOString();
function inkSummary(over: Record<string, unknown> = {}) {
  return {
    balance: 0,
    granted: 100,
    purchased: 0,
    refunded: 0,
    used: 100,
    starter: 100,
    starter_at: hoursAgo(24 * 30),
    purchases: 0,
    last_purchase: null,
    unlimited: { status: "active", unlimited: true, trial_end: null, current_period_end: null, cancel_at_period_end: false, cancel_at: null, repeat_trial: false },
    ...over,
  };
}

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
  fake.replies.ink_summary = () => ({ data: inkSummary() });
  fake.replies.global_budget_spend = () => ({ data: { allowed: true, remaining: 1_000, retry_after_ms: 0, backend: "db" } });
  fake.replies.rate_limit_spend = () => ({ data: { allowed: true, remaining: 1_000, retry_after_ms: 0, backend: "db" } });
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

describe("POST /api/live/transcribe", () => {
  it("401 without a token, before any RPC or ElevenLabs call", async () => {
    const res = await transcribe(request({}, null));
    expect(res.status).toBe(401);
    expect(res.headers.get("X-Request-Id")).toBeTruthy();
    expect(fake.calls).toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("429 from the liveTranscribe budget, before the body or ElevenLabs", async () => {
    fake.replies.rate_limit_hit = () => ({ data: { allowed: false, remaining: 0, retry_after_ms: 4_000 } });
    const res = await transcribe(request());
    expect(res.status).toBe(429);
    expect(res.headers.get("Retry-After")).toBe("4");
    expect(callsTo("rate_limit_hit")[0].args).toMatchObject({ p_bucket: "liveTranscribe", p_limit: LIVE_RATE_LIMITS.liveTranscribe.limit });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("400 for a body that is not multipart, no `audio` file, or a bad field", async () => {
    const json = new Request("http://localhost/api/live/transcribe", {
      method: "POST",
      headers: { Authorization: `Bearer ${fake.GOOD_TOKEN}`, "Content-Type": "application/json" },
      body: JSON.stringify({ audio: "x" }),
    });
    expect((await transcribe(json)).status).toBe(400);
    expect((await transcribe(request({ audio: null }))).status).toBe(400);
    expect((await transcribe(request({ audio: "not a file" }))).status).toBe(400);
    expect((await transcribe(request({ lang: "en; drop table" }))).status).toBe(400);
    expect((await transcribe(request({ seconds: "forever" }))).status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("413 past ASK_LIMITS.audioBytes, by Content-Length before reading and by the file's size", async () => {
    const declared = new Request("http://localhost/api/live/transcribe", {
      method: "POST",
      headers: { Authorization: `Bearer ${fake.GOOD_TOKEN}`, "Content-Length": String(ASK_LIMITS.audioBytes * 2), "Content-Type": "multipart/form-data; boundary=x" },
      body: "--x--",
    });
    expect((await transcribe(declared)).status).toBe(413);
    expect((await transcribe(request({ audio: webm(ASK_LIMITS.audioBytes + 1), type: "audio/webm" }))).status).toBe(413);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("413 for a compressed recording past 1.2 MB (its length is unknown before Scribe); a WAV that long by its header is fine", async () => {
    const res = await transcribe(request({ audio: webm(ASK_LIMITS.compressedAudioBytes + 1), type: "audio/webm", seconds: "3" }));
    expect(res.status).toBe(413);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(callsTo("rate_limit_spend")).toEqual([]);
    // a minute of 16 kHz WAV is ~1.9 MB: its header says 60 s, under the WAV cap
    heardReply();
    expect((await transcribe(request({ audio: wav(60) }))).status).toBe(200);
    // a compressed recording just under the cap goes on
    heardReply();
    expect((await transcribe(request({ audio: webm(ASK_LIMITS.compressedAudioBytes), type: "audio/webm", seconds: "3" }))).status).toBe(200);
  });

  it("413 for a recording longer than the mic allows (a WAV's own header, or what the client timed)", async () => {
    expect((await transcribe(request({ audio: wav(ASK_LIMITS.audioSeconds + 5) }))).status).toBe(413);
    expect((await transcribe(request({ audio: webm(), type: "audio/webm", seconds: "75" }))).status).toBe(413);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("415 for bytes that are not a recording, whatever type they claim", async () => {
    const png = new Uint8Array(2_000);
    png.set([0x89, 0x50, 0x4e, 0x47], 0);
    const res = await transcribe(request({ audio: png, type: "audio/webm" }));
    expect(res.status).toBe(415);
    expect(await errorOf(res)).toBe("invalid_request");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("an empty recording is nothing heard: source none, no plan check, no ElevenLabs call", async () => {
    for (const audio of [new Uint8Array(0), webm(100), wav(0.1)]) {
      const res = await transcribe(request({ audio }));
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ text: "", source: "none" });
    }
    expect(callsTo("ink_summary")).toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("503 speech_unavailable without ELEVENLABS_API_KEY: nothing sent, nothing recorded", async () => {
    delete process.env.ELEVENLABS_API_KEY;
    resetServerEnvCache();
    const res = await transcribe(request());
    expect(res.status).toBe(503);
    expect(await errorOf(res)).toBe("speech_unavailable");
    expect(fetchMock).not.toHaveBeenCalled();
    expect(events()).toEqual([]);
  });

  it("sends the recording to Scribe batch and answers the words: model, key, language, settings; never charged", async () => {
    heardReply();
    const audio = wav(2);
    const res = await transcribe(request({ audio, lang: "en-US", seconds: "2.1" }));
    expect(res.status).toBe(200);
    expect(res.headers.get("X-Request-Id")).toBeTruthy();
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    expect(await res.json()).toEqual({ text: SAID, source: "elevenlabs" });

    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toBe("https://api.elevenlabs.io/v1/speech-to-text");
    expect(new Headers(init?.headers).get("xi-api-key")).toBe(KEY);
    const form = sentForm();
    expect(form.get("model_id")).toBe(SCRIBE_BATCH.model);
    expect(form.get("model_id")).toBe("scribe_v2");
    expect(form.get("language_code")).toBe("en");
    expect(form.get("tag_audio_events")).toBe("false");
    const file = form.get("file") as File;
    expect(file.type).toBe("audio/wav");
    expect(new Uint8Array(await file.arrayBuffer())).toEqual(audio);

    // the account's seconds for the day, then everyone's: the WAV's own length, rounded up
    expect(callsTo("rate_limit_spend")[0].args).toEqual({ p_bucket: "liveTranscribeDaySeconds", p_amount: 2, p_limit: TRANSCRIBE_USER_DAY_BUDGET.limit, p_window_ms: 86_400_000 });
    expect(TRANSCRIBE_USER_DAY_BUDGET.limit).toBe(20 * 60);
    expect(callsTo("global_budget_spend")[0].args).toEqual({ p_bucket: "liveTranscribeSeconds", p_amount: 2, p_limit: TRANSCRIBE_GLOBAL_BUDGET.limit, p_window_ms: 86_400_000 });
    expect(callsTo("consume_credits")).toEqual([]);
    // Scribe's length (the last word ended at 1.6 s) is within the estimate: nothing to true up
    expect(fake.calls.map((c) => c.fn)).toEqual(["rate_limit_hit", "ink_summary", "rate_limit_spend", "global_budget_spend"]);
  });

  it("a WebM from Chrome goes as audio/webm; no lang means Scribe detects it", async () => {
    heardReply("hi");
    await transcribe(request({ audio: webm(), type: "audio/webm;codecs=opus", seconds: "1.5" }));
    const file = sentForm().get("file") as File;
    expect(file.type).toBe("audio/webm");
    expect(sentForm().get("language_code")).toBeNull();
  });

  it("Scribe heard nothing (or only a sound tag): source none", async () => {
    heardReply("");
    expect(await (await transcribe(request())).json()).toEqual({ text: "", source: "none" });
    heardReply(" (laughs) ");
    expect(await (await transcribe(request())).json()).toEqual({ text: "", source: "none" });
  });

  it("never logs or records the words (the log line has their length)", async () => {
    // every logger child writes through the root's stream
    const stream = (logger as unknown as Record<symbol, { write(chunk: string): boolean }>)[pino.symbols.streamSym];
    const lines: string[] = [];
    const spy = vi.spyOn(stream, "write").mockImplementation((chunk: string) => {
      lines.push(String(chunk));
      return true;
    });
    logger.level = "info";
    try {
      heardReply();
      await transcribe(request());
    } finally {
      spy.mockRestore();
      logger.level = "silent";
    }
    const logged = lines.join("");
    expect(logged).toContain("speech transcribed");
    expect(logged).toContain(`"chars":${SAID.length}`);
    expect(logged).not.toContain("seven times eight");
    expect(JSON.stringify(events())).not.toContain("seven times eight");
  });

  it("a key ElevenLabs refuses is answered like no key (the browser's recognizer), and recorded for /admin", async () => {
    scribeReply({ detail: { status: "missing_permissions", message: "The API key you used is missing the permission speech_to_text." } }, 401);
    const res = await transcribe(request());
    expect(res.status).toBe(503);
    expect(await errorOf(res)).toBe("speech_unavailable");
    expect(events()).toEqual([
      expect.objectContaining({ source: "server", level: "error", kind: "route.live.transcribe", code: "unauthorized", userId: fake.USER_ID, message: expect.stringContaining("missing_permissions") }),
    ]);
  });

  it("spent quota: the same 503, with its own code", async () => {
    scribeReply({ detail: { status: "quota_exceeded", message: "This request exceeds your quota." } }, 401);
    expect((await transcribe(request())).status).toBe(503);
    expect(events()[0]).toMatchObject({ code: "quota" });
  });

  it("a recording Scribe cannot read is nothing heard, recorded as a warning", async () => {
    scribeReply({ detail: [{ msg: "Invalid audio file" }] }, 422);
    const res = await transcribe(request());
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ text: "", source: "none" });
    expect(events()[0]).toMatchObject({ level: "warn", code: "unreadable", kind: "route.live.transcribe" });
  });

  it("an ElevenLabs failure is a 502 upstream_error, recorded; so is a reply with no text", async () => {
    scribeReply({ detail: "boom" }, 500);
    const res = await transcribe(request());
    expect(res.status).toBe(502);
    expect(await errorOf(res)).toBe("upstream_error");
    expect(events()[0]).toMatchObject({ kind: "route.live.transcribe", code: "upstream" });

    scribeReply({ nope: true });
    expect((await transcribe(request())).status).toBe(502);
  });

  it("a Scribe that never answers is a timeout, not a hang", async () => {
    vi.useFakeTimers();
    try {
      fetchMock.mockImplementationOnce(
        (_url, init) =>
          new Promise((_resolve, reject) => {
            init?.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
          }),
      );
      const pending = transcribe(request());
      await vi.advanceTimersByTimeAsync(SCRIBE_BATCH.timeoutMs + 10);
      const res = await pending;
      expect(res.status).toBe(502);
      expect(events()[0]).toMatchObject({ kind: "route.live.transcribe", code: "timeout" });
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("POST /api/live/transcribe: who gets ElevenLabs Scribe", () => {
  const browserRecognizer = async (res: Response) => {
    expect(res.status).toBe(503);
    expect(await errorOf(res)).toBe("speech_unavailable");
    expect(fetchMock).not.toHaveBeenCalled();
  };

  it("no plan, past the guided first board: 503, the browser's recognizer; no budget spent", async () => {
    fake.replies.ink_summary = () => ({ data: inkSummary({ unlimited: { status: "none", unlimited: false } }) });
    await browserRecognizer(await transcribe(request()));
    expect(callsTo("global_budget_spend")).toEqual([]);
  });

  it("the guided first board gets it: starter ink left, granted lately", async () => {
    fake.replies.ink_summary = () => ({ data: inkSummary({ balance: 60, starter_at: hoursAgo(3), unlimited: { status: "none", unlimited: false } }) });
    heardReply();
    expect((await transcribe(request())).status).toBe(200);
  });

  it("the check failing is a 503 too, never a free Scribe", async () => {
    fake.replies.ink_summary = () => ({ error: { message: "connection refused" } });
    await browserRecognizer(await transcribe(request()));
  });

  it("BILLING_ENFORCE=0: no plan check at all", async () => {
    process.env.BILLING_ENFORCE = "0";
    resetServerEnvCache();
    fake.replies.ink_summary = () => ({ data: inkSummary({ unlimited: { status: "none" } }) });
    heardReply();
    expect((await transcribe(request())).status).toBe(200);
    expect(callsTo("ink_summary")).toEqual([]);
  });

  it("this account's seconds for the day spent: 503 (the browser's recognizer), nothing sent, everyone's budget untouched", async () => {
    fake.replies.rate_limit_spend = () => ({ data: { allowed: false, remaining: 0, retry_after_ms: 3_600_000, backend: "db" } });
    await browserRecognizer(await transcribe(request()));
    expect(callsTo("rate_limit_spend")).toHaveLength(1);
    expect(callsTo("global_budget_spend")).toEqual([]);
    expect(events()).toEqual([]);
  });

  it("the day's seconds for everyone spent: 503, recorded for /admin, nothing sent", async () => {
    fake.replies.global_budget_spend = () => ({ data: { allowed: false, remaining: 0, retry_after_ms: 3_600_000, backend: "db" } });
    await browserRecognizer(await transcribe(request()));
    expect(events()[0]).toMatchObject({ kind: "route.live.transcribe", code: "budget", level: "error" });
  });

  it("a recording with no header to time it counts at least its size's worth of seconds (128 kbit/s)", async () => {
    heardReply();
    await transcribe(request({ audio: webm(320_000), type: "audio/webm", seconds: "1" }));
    expect(callsTo("rate_limit_spend")[0].args).toMatchObject({ p_amount: 20 });
    expect(callsTo("global_budget_spend")[0].args).toMatchObject({ p_amount: 20 });
  });
});

describe("POST /api/live/transcribe: the budgets trued up with the length Scribe measured", () => {
  const measured = (seconds: number, text = SAID) => scribeReply({ language_code: "eng", text, audio_duration_secs: seconds, words: [] });

  it("a recording longer than its estimate: the difference is spent on both budgets after the call", async () => {
    // a low-bitrate WebM: 40 KB and "2 seconds", but Scribe heard 30.4 s
    measured(30.4);
    const res = await transcribe(request({ audio: webm(40_000), type: "audio/webm", seconds: "2" }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ text: SAID, source: "elevenlabs" });
    expect(callsTo("rate_limit_spend").map((c) => c.args?.p_amount)).toEqual([3, 28]);
    expect(callsTo("global_budget_spend").map((c) => c.args?.p_amount)).toEqual([3, 28]);
    expect(callsTo("rate_limit_spend")[1].args).toMatchObject({ p_bucket: "liveTranscribeDaySeconds" });
    expect(callsTo("global_budget_spend")[1].args).toMatchObject({ p_bucket: "liveTranscribeSeconds" });
  });

  it("no more than the estimate (or no length at all): nothing more is spent", async () => {
    measured(1.5);
    await transcribe(request({ audio: webm(40_000), type: "audio/webm", seconds: "2" }));
    expect(callsTo("rate_limit_spend")).toHaveLength(1);
    expect(callsTo("global_budget_spend")).toHaveLength(1);
    scribeReply({ text: SAID });
    await transcribe(request({ audio: webm(40_000), type: "audio/webm", seconds: "2" }));
    expect(callsTo("rate_limit_spend")).toHaveLength(2);
  });

  it("minutes of audio in a small file: counted in full, then a 413 with no words, recorded for /admin", async () => {
    // ~17 minutes of 8 kbit/s audio fits in 1 MB; it said 5 s
    measured(1_020);
    const res = await transcribe(request({ audio: webm(1_000_000), type: "audio/webm", seconds: "5" }));
    expect(res.status).toBe(413);
    const body = await res.json();
    expect(body).toMatchObject({ error: "invalid_request" });
    expect(JSON.stringify(body)).not.toContain("seven times eight");
    // estimated 63 s by its size (capped at the mic's 62), then the rest of what Scribe heard
    expect(callsTo("rate_limit_spend").map((c) => c.args?.p_amount)).toEqual([62, 958]);
    expect(callsTo("global_budget_spend").map((c) => c.args?.p_amount)).toEqual([62, 958]);
    expect(events()).toEqual([expect.objectContaining({ kind: "route.live.transcribe", level: "warn", code: "too_long", meta: expect.objectContaining({ heard: 1_020 }) })]);
  });

  it("the account's day spent by a true-up: this answer still comes back, the next request gets the browser's recognizer", async () => {
    measured(55);
    fake.replies.rate_limit_spend = (args) => ({ data: { allowed: Number(args?.p_amount) < 10, remaining: 0, retry_after_ms: 3_600_000, backend: "db" } });
    const res = await transcribe(request({ audio: webm(40_000), type: "audio/webm", seconds: "2" }));
    expect(res.status).toBe(200);
    expect(callsTo("rate_limit_spend").map((c) => c.args?.p_amount)).toEqual([3, 52]);
    fake.replies.rate_limit_spend = () => ({ data: { allowed: false, remaining: 0, retry_after_ms: 3_600_000, backend: "db" } });
    fetchMock.mockReset();
    const next = await transcribe(request({ audio: webm(40_000), type: "audio/webm", seconds: "2" }));
    expect(next.status).toBe(503);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
