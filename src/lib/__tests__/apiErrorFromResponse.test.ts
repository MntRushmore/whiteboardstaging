import { describe, expect, it } from "vitest";
import { ApiError, apiErrorFromResponse } from "@/lib/api-client";

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
});
