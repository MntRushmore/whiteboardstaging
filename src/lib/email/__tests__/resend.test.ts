/**
 * The Resend client (src/lib/email/resend.ts) with an injected fetch: what it sends, and that it
 * never throws whatever comes back.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.hoisted(() => {
  process.env.LOG_LEVEL = "silent";
});

import { resetServerEnvCache } from "@/lib/env";
import {
  DEFAULT_EMAIL_FROM,
  NOT_CONFIGURED,
  RESEND_API_URL,
  emailConfigured,
  isSendableAddress,
  resendConfigFromEnv,
  sanitizeTag,
  sendEmail,
  type SendEmailInput,
} from "@/lib/email/resend";

const KEY = "re_unit_0123456789";
const message: SendEmailInput = {
  to: "delivered@resend.dev",
  subject: "Welcome to Agathon",
  html: "<p>Hi</p>",
  text: "Hi\n",
  idempotencyKey: "welcome/u1",
  tags: { kind: "welcome", "bad name": "a.b" },
};

const fetchMock = vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>();
const reply = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  fetchMock.mockResolvedValueOnce(new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", ...headers } }));
const config = (over: Partial<Parameters<typeof sendEmail>[1]> = {}) => ({ apiKey: KEY, fetchImpl: fetchMock as unknown as typeof fetch, ...over });

beforeEach(() => fetchMock.mockReset());

describe("sendEmail", () => {
  it("posts one email to Resend with the key, the idempotency key and sanitized tags", async () => {
    reply(200, { id: "4ef9a417-02e9-4d39-ad75-9611e0fcc33c" });
    const result = await sendEmail(message, config());
    expect(result).toEqual({ ok: true, id: "4ef9a417-02e9-4d39-ad75-9611e0fcc33c" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(RESEND_API_URL);
    expect(init?.method).toBe("POST");
    const headers = init?.headers as Record<string, string>;
    expect(headers.Authorization).toBe(`Bearer ${KEY}`);
    expect(headers["Idempotency-Key"]).toBe("welcome/u1");
    expect(headers["Content-Type"]).toBe("application/json");
    expect(JSON.parse(String(init?.body))).toEqual({
      from: DEFAULT_EMAIL_FROM,
      to: ["delivered@resend.dev"],
      subject: "Welcome to Agathon",
      html: "<p>Hi</p>",
      text: "Hi\n",
      tags: [
        { name: "kind", value: "welcome" },
        { name: "bad_name", value: "a_b" },
      ],
    });
    expect(init?.signal).toBeInstanceOf(AbortSignal);
  });

  it("uses EMAIL_FROM when given, and sends no Idempotency-Key or tags when there are none", async () => {
    reply(200, { id: "x" });
    await sendEmail({ ...message, idempotencyKey: undefined, tags: undefined }, config({ from: "Agathon Team <team@mail.agathon.app>" }));
    const init = fetchMock.mock.calls[0][1];
    expect((init?.headers as Record<string, string>)["Idempotency-Key"]).toBeUndefined();
    const body = JSON.parse(String(init?.body));
    expect(body.from).toBe("Agathon Team <team@mail.agathon.app>");
    expect("tags" in body).toBe(false);
  });

  it("without a key: `not configured`, and nothing is sent", async () => {
    for (const apiKey of [undefined, null, "", "   "]) {
      expect(await sendEmail(message, config({ apiKey }))).toEqual({ ok: false, error: NOT_CONFIGURED });
    }
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("refuses a bad request before calling Resend", async () => {
    for (const to of ["", "not-an-email", "a@b.c, d@e.f", "Name <a@b.c>", "a@b"]) {
      const result = await sendEmail({ ...message, to }, config());
      expect(result.ok, to).toBe(false);
    }
    expect((await sendEmail({ ...message, subject: " " }, config())).ok).toBe(false);
    expect(await sendEmail({ ...message, idempotencyKey: "k".repeat(257) }, config())).toMatchObject({ ok: false, error: expect.stringMatching(/idempotency key/) });
    expect(await sendEmail({ ...message, idempotencyKey: "" }, config())).toMatchObject({ ok: false });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("returns Resend's error, with the status, instead of throwing", async () => {
    reply(422, { statusCode: 422, name: "validation_error", message: "Invalid `to` field." });
    expect(await sendEmail(message, config())).toEqual({ ok: false, error: "validation_error: Invalid `to` field.", status: 422 });
    reply(409, { statusCode: 409, name: "invalid_idempotent_request", message: "Same idempotency key used with a different request payload." });
    expect(await sendEmail(message, config())).toMatchObject({ ok: false, status: 409, error: expect.stringMatching(/^invalid_idempotent_request/) });
    fetchMock.mockResolvedValueOnce(new Response("<html>bad gateway</html>", { status: 502 }));
    expect(await sendEmail(message, config())).toEqual({ ok: false, error: "HTTP 502", status: 502 });
  });

  it("passes on how long a 429 asks to wait", async () => {
    reply(429, { name: "rate_limit_exceeded", message: "Too many requests" }, { "retry-after": "2" });
    expect(await sendEmail(message, config())).toEqual({ ok: false, error: "rate_limit_exceeded: Too many requests", status: 429, retryAfterMs: 2000 });
    reply(429, { name: "daily_quota_exceeded", message: "quota" });
    expect(await sendEmail(message, config())).toEqual({ ok: false, error: "daily_quota_exceeded: quota", status: 429 });
  });

  it("a network error, a timeout or a reply without an id is a failure, never a throw", async () => {
    fetchMock.mockRejectedValueOnce(new TypeError("fetch failed"));
    expect(await sendEmail(message, config())).toEqual({ ok: false, error: "network error: fetch failed" });
    fetchMock.mockRejectedValueOnce(new DOMException("The operation timed out.", "TimeoutError"));
    expect(await sendEmail(message, config())).toEqual({ ok: false, error: "timed out" });
    reply(200, {});
    expect(await sendEmail(message, config())).toMatchObject({ ok: false, status: 200 });
  });

  it("gives up after the timeout", async () => {
    fetchMock.mockImplementationOnce(
      (_url, init) =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => reject(init.signal!.reason));
        }),
    );
    expect(await sendEmail(message, config({ timeoutMs: 20 }))).toEqual({ ok: false, error: "timed out" });
  });
});

describe("helpers", () => {
  it("sanitizeTag keeps Resend's alphabet", () => {
    expect(sanitizeTag("trial_reminder")).toBe("trial_reminder");
    expect(sanitizeTag("a b.c/d")).toBe("a_b_c_d");
    expect(sanitizeTag("")).toBe("_");
    expect(sanitizeTag("x".repeat(300))).toHaveLength(256);
  });

  it("isSendableAddress takes one plain address", () => {
    expect(isSendableAddress("kid+1@example.com")).toBe(true);
    expect(isSendableAddress("a@b")).toBe(false);
    expect(isSendableAddress("a@b.c d")).toBe(false);
  });
});

describe("config from the env", () => {
  const saved: Record<string, string | undefined> = {};
  const VARS = ["RESEND_API_KEY", "EMAIL_FROM", "NEXT_PUBLIC_SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_ANON_KEY", "OPENROUTER_API_KEY"];
  beforeEach(() => {
    for (const v of VARS) saved[v] = process.env[v];
    process.env.NEXT_PUBLIC_SUPABASE_URL = "http://127.0.0.1:54321";
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "anon-key";
    process.env.OPENROUTER_API_KEY = "sk-or-test";
    delete process.env.RESEND_API_KEY;
    delete process.env.EMAIL_FROM;
    resetServerEnvCache();
  });
  afterEach(() => {
    for (const v of VARS) {
      if (saved[v] === undefined) delete process.env[v];
      else process.env[v] = saved[v];
    }
    resetServerEnvCache();
  });

  it("is unconfigured without RESEND_API_KEY (or with a placeholder) and defaults the sender", () => {
    expect(resendConfigFromEnv()).toEqual({ apiKey: null, from: DEFAULT_EMAIL_FROM });
    expect(emailConfigured()).toBe(false);
    process.env.RESEND_API_KEY = "your-resend-key";
    resetServerEnvCache();
    expect(emailConfigured()).toBe(false);
  });

  it("reads RESEND_API_KEY and EMAIL_FROM", () => {
    process.env.RESEND_API_KEY = KEY;
    process.env.EMAIL_FROM = "Agathon <hi@mail.agathon.app>";
    resetServerEnvCache();
    expect(resendConfigFromEnv()).toEqual({ apiKey: KEY, from: "Agathon <hi@mail.agathon.app>" });
    expect(emailConfigured()).toBe(true);
  });
});
