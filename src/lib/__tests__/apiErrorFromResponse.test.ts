import { describe, expect, it } from "vitest";
import { ApiError, apiErrorFromResponse, errorTrace, isBareServerError } from "@/lib/api-client";
import { recognizeFailureHints } from "@/lib/live/recognizeClient";

describe("apiErrorFromResponse", () => {
  it("keeps the server's retryAfterMs from the body", async () => {
    const res = new Response(JSON.stringify({ error: "rate_limited", message: "Slow down", retryAfterMs: 5000 }), {
      status: 429,
      headers: { "Retry-After": "5" },
    });
    const err = await apiErrorFromResponse(res);
    expect(err).toBeInstanceOf(ApiError);
    expect(err).toMatchObject({ status: 429, code: "rate_limited", message: "Slow down", retryAfterMs: 5000 });
  });

  it("falls back to the Retry-After header (seconds) when the body has no retryAfterMs", async () => {
    const res = new Response(JSON.stringify({ error: "rate_limited" }), { status: 429, headers: { "Retry-After": "3" } });
    const err = await apiErrorFromResponse(res);
    expect(err.retryAfterMs).toBe(3000);
    expect(err.message).toBe("rate_limited");
  });

  it("leaves retryAfterMs undefined for other failures and tolerates a non-JSON body", async () => {
    const err = await apiErrorFromResponse(new Response("boom", { status: 502 }));
    expect(err.status).toBe(502);
    expect(err.message).toBe("Request failed (502)");
    expect(err.retryAfterMs).toBeUndefined();
    expect("retryAfterMs" in err).toBe(false);
  });

  it("keeps the request id and Vercel's own error, so a report can be joined to the server's rows", async () => {
    const ours = await apiErrorFromResponse(
      new Response(JSON.stringify({ error: "recognizer_failed" }), { status: 502, headers: { "X-Request-Id": "4f1c2d3e-aaaa-4bbb-8ccc-123456789abc" } }),
    );
    expect(ours).toMatchObject({ requestId: "4f1c2d3e-aaaa-4bbb-8ccc-123456789abc" });
    expect(ours.vercelError).toBeUndefined();
    expect(errorTrace(ours)).toEqual({ requestId: "4f1c2d3e-aaaa-4bbb-8ccc-123456789abc" });

    // a function killed at its maxDuration: the platform answers, with its own error and no id of ours
    const killed = await apiErrorFromResponse(new Response("An error occurred", { status: 504, headers: { "x-vercel-error": "FUNCTION_INVOCATION_TIMEOUT" } }));
    expect(errorTrace(killed)).toEqual({ vercelError: "FUNCTION_INVOCATION_TIMEOUT" });
  });

  it("Cloudflare's page in place of a route's 502 is a bare 5xx: no code, no hints, no request id (production, 2026-10-12)", async () => {
    const page = "<!DOCTYPE html><html><head><title>www.agathon.app | 502: Bad gateway</title></head><body>cloudflare</body></html>";
    const err = await apiErrorFromResponse(
      new Response(page, { status: 502, headers: { "Content-Type": "text/html; charset=UTF-8", Server: "cloudflare", "cf-ray": "a4925f9e3b1509ae-SJC" } }),
    );
    expect(err).toMatchObject({ status: 502, message: "Request failed (502)" });
    expect(err.code).toBeUndefined();
    expect(errorTrace(err)).toEqual({});
    expect(isBareServerError(err)).toBe(true);
    // what the route meant to say never arrived: the board can take its word for nothing
    expect(recognizeFailureHints(err)).toEqual({ needsCrop: false, recognizerDown: false, unreadable: false, transient: false });

    // the route's own answer, as it now gets through (503): its hints and its id
    const ours = await apiErrorFromResponse(
      new Response(JSON.stringify({ error: "recognizer_failed", message: "Couldn't read this line right now.", provider: null, needsCrop: true, unreadable: true }), {
        status: 503,
        headers: { "Content-Type": "application/json", "X-Request-Id": "4f1c2d3e-aaaa-4bbb-8ccc-123456789abc" },
      }),
    );
    expect(isBareServerError(ours)).toBe(false);
    expect(recognizeFailureHints(ours)).toMatchObject({ needsCrop: true, unreadable: true });
    expect(errorTrace(ours)).toEqual({ requestId: "4f1c2d3e-aaaa-4bbb-8ccc-123456789abc" });
    // only 5xx: a 4xx without our body is not a server that lost its answer
    expect(isBareServerError(await apiErrorFromResponse(new Response("no", { status: 413 })))).toBe(false);
    expect(isBareServerError(new TypeError("Load failed"))).toBe(false);
  });

  it("takes neither when it does not have the shape it should; nothing for an error that is not an ApiError", async () => {
    const odd = await apiErrorFromResponse(new Response("{}", { status: 500, headers: { "X-Request-Id": "has spaces and; more", "x-vercel-error": "lower case" } }));
    expect(errorTrace(odd)).toEqual({});
    expect(errorTrace(new TypeError("Load failed"))).toEqual({});
  });
});
