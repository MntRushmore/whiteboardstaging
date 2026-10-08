import { describe, expect, it } from "vitest";
import { ApiError, apiErrorFromResponse, errorTrace } from "@/lib/api-client";

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

  it("takes neither when it does not have the shape it should; nothing for an error that is not an ApiError", async () => {
    const odd = await apiErrorFromResponse(new Response("{}", { status: 500, headers: { "X-Request-Id": "has spaces and; more", "x-vercel-error": "lower case" } }));
    expect(errorTrace(odd)).toEqual({});
    expect(errorTrace(new TypeError("Load failed"))).toEqual({});
  });
});
