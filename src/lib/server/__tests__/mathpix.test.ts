/**
 * BUG-1: `recognizeStrokes` used to answer `null` for everything — a 401 "Invalid
 * credentials", a 500, a timeout and an unreadable scribble were indistinguishable in the
 * logs, which is why a production credential problem took a browser session to find.
 *
 * It now returns a discriminated outcome and logs the HTTP status plus Mathpix's
 * `error` / `error_info` at warn, never the strokes and never a credential. `reason: "auth"`
 * is what drives the vision fallback in /api/live/recognize.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resetServerEnvCache } from "@/lib/env";
import {
  MATHPIX_STROKES_URL,
  buildStrokesBody,
  isMathpixAuthFailure,
  isMathpixConfigured,
  latexFromMathpix,
  recognizeStrokes,
  stripMathDelimiters,
  type MathpixOutcome,
  type MathpixStrokesResponse,
} from "@/lib/server/mathpix";
import type { StrokePayload } from "@/lib/live/contracts";

const ENV_VARS = [
  "MATHPIX_APP_ID",
  "MATHPIX_APP_KEY",
  "OPENROUTER_API_KEY",
  "NEXT_PUBLIC_SUPABASE_URL",
  "NEXT_PUBLIC_SUPABASE_ANON_KEY",
] as const;
const saved: Record<string, string | undefined> = {};

const PAYLOAD: StrokePayload = { x: [[0, 10, 20]], y: [[0, 5, 0]], w: 20, h: 5 };

/** Warn records the code emitted, so tests can assert what an operator would actually see. */
function fakeLog() {
  const warns: Array<{ obj: Record<string, unknown>; msg: string }> = [];
  return { warns, warn: (obj: Record<string, unknown>, msg: string) => warns.push({ obj, msg }) };
}

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

/** Installs a fake global fetch and records the requests it saw. */
function fakeFetch(reply: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>) {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const spy = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({ url: String(input), init });
    return reply(input, init);
  });
  vi.stubGlobal("fetch", spy);
  return { calls, spy };
}

function ok(outcome: MathpixOutcome) {
  if (!outcome.ok) throw new Error(`expected a successful outcome, got ${outcome.reason}`);
  return outcome;
}

beforeEach(() => {
  for (const name of ENV_VARS) saved[name] = process.env[name];
  process.env.OPENROUTER_API_KEY = "sk-or-test";
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://example.supabase.co";
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "anon-key";
  process.env.MATHPIX_APP_ID = "app-id-123";
  process.env.MATHPIX_APP_KEY = "app-key-super-secret";
  resetServerEnvCache();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
  for (const name of ENV_VARS) {
    if (saved[name] === undefined) delete process.env[name];
    else process.env[name] = saved[name];
  }
  resetServerEnvCache();
});

describe("pure helpers", () => {
  it("builds the documented strokes body and unwraps Mathpix text", () => {
    expect(buildStrokesBody(PAYLOAD)).toEqual({
      strokes: { strokes: { x: PAYLOAD.x, y: PAYLOAD.y } },
      formats: ["latex_styled", "text"],
    });
    expect(stripMathDelimiters("\\( 2x = 8 \\)")).toBe("2x = 8");
    expect(latexFromMathpix({ latex_styled: "2x=8", text: "\\(2x=8\\)" })).toBe("2x=8");
    expect(latexFromMathpix({ text: "\\(x=4\\)" })).toBe("x=4");
    expect(latexFromMathpix({})).toBe("");
  });

  it("isMathpixConfigured follows the env and never throws", () => {
    expect(isMathpixConfigured()).toBe(true);
    delete process.env.MATHPIX_APP_KEY;
    resetServerEnvCache();
    expect(isMathpixConfigured()).toBe(false);
    delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    resetServerEnvCache();
    expect(isMathpixConfigured()).toBe(false);
  });
});

describe("recognizeStrokes — success", () => {
  it("returns latex/text/confidence and sends the credentials as headers only", async () => {
    const body: MathpixStrokesResponse = {
      latex_styled: "2x=8",
      text: "\\(2x=8\\)",
      confidence: 0.94,
    };
    const { calls } = fakeFetch(async () => jsonResponse(200, body));
    const log = fakeLog();

    const out = ok(await recognizeStrokes(PAYLOAD, undefined, { requestId: "req-1", log }));
    expect(out).toMatchObject({ ok: true, latex: "2x=8", text: "2x=8", confidence: 0.94 });
    expect(log.warns).toEqual([]);
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe(MATHPIX_STROKES_URL);
    const headers = calls[0].init?.headers as Record<string, string>;
    expect(headers.app_id).toBe("app-id-123");
    expect(headers.app_key).toBe("app-key-super-secret");
    expect(headers["X-Request-Id"]).toBe("req-1");
  });

  it("falls back to confidence_rate and clamps it into 0..1", async () => {
    fakeFetch(async () => jsonResponse(200, { latex: "x=4", confidence_rate: 1.7 }));
    expect(ok(await recognizeStrokes(PAYLOAD)).confidence).toBe(1);
    fakeFetch(async () => jsonResponse(200, { latex: "x=4" }));
    expect(ok(await recognizeStrokes(PAYLOAD)).confidence).toBe(0);
  });
});

describe("recognizeStrokes — failures are distinguishable", () => {
  it("401 Invalid credentials -> reason 'auth', with the status and Mathpix's error logged", async () => {
    fakeFetch(async () =>
      jsonResponse(401, { error: "Invalid credentials", error_info: { id: "invalid_credentials", message: "bad app_key" } }),
    );
    const log = fakeLog();

    const out = await recognizeStrokes(PAYLOAD, undefined, { requestId: "req-2", log });
    expect(out).toEqual({
      ok: false,
      reason: "auth",
      status: 401,
      detail: "Invalid credentials | invalid_credentials | bad app_key",
    });
    expect(isMathpixAuthFailure(out)).toBe(true);

    expect(log.warns).toHaveLength(1);
    expect(log.warns[0].msg).toBe("mathpix rejected our credentials");
    expect(log.warns[0].obj).toMatchObject({ requestId: "req-2", reason: "auth", status: 401 });
    // never the strokes, never a credential
    const serialized = JSON.stringify(log.warns);
    expect(serialized).not.toContain("app-key-super-secret");
    expect(serialized).not.toContain("app-id-123");
    expect(serialized).not.toContain("strokes");
  });

  it("403 is also 'auth'; another non-2xx is 'http' and keeps its status", async () => {
    fakeFetch(async () => jsonResponse(403, { error: "Forbidden" }));
    expect(await recognizeStrokes(PAYLOAD)).toMatchObject({ ok: false, reason: "auth", status: 403 });

    fakeFetch(async () => jsonResponse(500, { error: "server_error" }));
    const log = fakeLog();
    const out = await recognizeStrokes(PAYLOAD, undefined, { log });
    expect(out).toMatchObject({ ok: false, reason: "http", status: 500, detail: "server_error" });
    expect(isMathpixAuthFailure(out)).toBe(false);
    expect(log.warns[0].msg).toBe("mathpix returned a non-2xx response");
  });

  it("tolerates a non-JSON error body and still reports the status", async () => {
    fakeFetch(async () => new Response("<html>gateway</html>", { status: 502 }));
    expect(await recognizeStrokes(PAYLOAD)).toEqual({ ok: false, reason: "http", status: 502, detail: undefined });
  });

  it("200 + error is a recognition miss ('api_error'), NOT an auth failure", async () => {
    fakeFetch(async () =>
      jsonResponse(200, { error: "image_no_content", error_info: { id: "image_no_content", message: "no content" } }),
    );
    const log = fakeLog();
    const out = await recognizeStrokes(PAYLOAD, undefined, { log });
    expect(out).toMatchObject({ ok: false, reason: "api_error", status: 200 });
    expect(isMathpixAuthFailure(out)).toBe(false);
    expect(log.warns[0].msg).toBe("mathpix could not read the strokes");
  });

  it("200 + a credential-shaped error is still 'auth'", async () => {
    fakeFetch(async () => jsonResponse(200, { error: "Invalid credentials", error_info: { id: "unauthorized" } }));
    expect(await recognizeStrokes(PAYLOAD)).toMatchObject({ ok: false, reason: "auth" });
  });

  it("a fetch that throws is 'network' and keeps the message, not the payload", async () => {
    fakeFetch(async () => {
      throw new TypeError("fetch failed");
    });
    const log = fakeLog();
    expect(await recognizeStrokes(PAYLOAD, undefined, { log })).toEqual({
      ok: false,
      reason: "network",
      detail: "fetch failed",
    });
    expect(log.warns[0].msg).toBe("mathpix call failed before a response");
  });

  it("the internal timeout is reported as 'timeout'", async () => {
    fakeFetch(
      (_input, init) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")), { once: true });
        }),
    );
    const log = fakeLog();
    const pending = recognizeStrokes(PAYLOAD, undefined, { timeoutMs: 5, log });
    expect(await pending).toEqual({ ok: false, reason: "timeout", status: undefined, detail: undefined });
    expect(log.warns[0].msg).toBe("mathpix timed out");
  });

  it("a caller abort is 'aborted' and logs nothing (it is not a failure)", async () => {
    fakeFetch(
      (_input, init) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")), { once: true });
        }),
    );
    const log = fakeLog();
    const controller = new AbortController();
    const pending = recognizeStrokes(PAYLOAD, controller.signal, { log });
    controller.abort();
    expect(await pending).toEqual({ ok: false, reason: "aborted" });
    expect(log.warns).toEqual([]);
  });

  it("never calls Mathpix when it is unconfigured or the payload is unusable", async () => {
    const { spy } = fakeFetch(async () => jsonResponse(200, { latex: "x" }));
    delete process.env.MATHPIX_APP_ID;
    resetServerEnvCache();
    expect(await recognizeStrokes(PAYLOAD)).toEqual({ ok: false, reason: "unconfigured" });

    process.env.MATHPIX_APP_ID = "app-id-123";
    resetServerEnvCache();
    const log = fakeLog();
    expect(await recognizeStrokes({ x: [], y: [], w: 0, h: 0 }, undefined, { log })).toMatchObject({
      ok: false,
      reason: "invalid_payload",
    });
    expect(await recognizeStrokes({ x: [[1]], y: [], w: 1, h: 1 }, undefined, { log })).toMatchObject({
      ok: false,
      reason: "invalid_payload",
    });
    expect(spy).not.toHaveBeenCalled();
  });
});
