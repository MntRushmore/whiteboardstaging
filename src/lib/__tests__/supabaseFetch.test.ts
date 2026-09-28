import { describe, expect, it, vi } from "vitest";
import { createSkewRetryFetch, SKEW_RETRY_MS } from "../supabaseFetch";

const reply = (status: number, body: string) => new Response(body, { status, headers: { "content-type": "application/json" } });
const SKEW = JSON.stringify({ code: "PGRST303", details: null, hint: null, message: "JWT issued at future" });

describe("the Supabase fetch: a token refused as issued in the future is tried again once", () => {
  it("retries a PGRST303 once, after a second, and returns the retry's answer", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValueOnce(reply(401, SKEW)).mockResolvedValueOnce(reply(200, "[]"));
    const sleep = vi.fn(async () => {});
    const res = await createSkewRetryFetch({ fetch, sleep })("http://x/rest/v1/whiteboards", { method: "GET" });
    expect(res.status).toBe(200);
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(sleep).toHaveBeenCalledWith(SKEW_RETRY_MS);
  });

  it("a clock that really is off still fails after the one retry", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>().mockImplementation(async () => reply(401, SKEW));
    const res = await createSkewRetryFetch({ fetch, sleep: async () => {} })("http://x/rest/v1/rpc/credit_summary", { method: "POST", body: "{}" });
    expect(res.status).toBe(401);
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("any other answer, a 401 included, is returned as it came", async () => {
    for (const r of [reply(200, "[]"), reply(401, JSON.stringify({ code: "PGRST301", message: "JWT expired" })), reply(500, "boom")]) {
      const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(r);
      const res = await createSkewRetryFetch({ fetch, sleep: async () => {} })("http://x", {});
      expect(res).toBe(r);
      expect(fetch).toHaveBeenCalledTimes(1);
    }
  });
});
