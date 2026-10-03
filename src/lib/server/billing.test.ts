import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { resetServerEnvCache } from "@/lib/env";
import {
  BILLING_UNAVAILABLE_MESSAGE,
  BUY_INK_PATH,
  FAIR_USE_FALLBACK_RETRY_MS,
  INK_EMPTY_MESSAGE,
  ROUTE_COSTS,
  aboutHowLong,
  billingEnforced,
  fairUseResponse,
  billingUnavailableResponse,
  consumeInk,
  consumeErrorToResult,
  enforceInk,
  inkEmptyResponse,
  normalizeConsumeResult,
  normalizeRefundResult,
  refundInk,
  resetBillingWarnings,
  runCharged,
  serviceClient,
  type RpcClient,
  type RpcError,
} from "@/lib/server/billing";

const ENV_VARS = ["BILLING_ENFORCE", "NEXT_PUBLIC_BILLING_LINKS", "NEXT_PUBLIC_SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_ANON_KEY", "OPENROUTER_API_KEY", "SUPABASE_SERVICE_ROLE_KEY"];
const saved: Record<string, string | undefined> = {};

beforeEach(() => {
  for (const name of ENV_VARS) {
    saved[name] = process.env[name];
    delete process.env[name];
  }
  process.env.NEXT_PUBLIC_SUPABASE_URL = "http://127.0.0.1:54321";
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "anon-key";
  process.env.OPENROUTER_API_KEY = "sk-or-test";
  resetServerEnvCache();
  resetBillingWarnings();
});

afterEach(() => {
  for (const name of ENV_VARS) {
    if (saved[name] === undefined) delete process.env[name];
    else process.env[name] = saved[name];
  }
  resetServerEnvCache();
});

/** A fake RPC client that records calls and answers with a scripted result. */
function fakeRpc(reply: { data?: unknown; error?: RpcError | null } | Error): RpcClient & { calls: Array<{ fn: string; args?: Record<string, unknown> }> } {
  const calls: Array<{ fn: string; args?: Record<string, unknown> }> = [];
  return {
    calls,
    rpc: (fn, args) => {
      calls.push({ fn, args });
      if (reply instanceof Error) return Promise.reject(reply);
      return Promise.resolve({ data: reply.data ?? null, error: reply.error ?? null });
    },
  };
}

describe("ROUTE_COSTS", () => {
  it("matches the agreed price table", () => {
    expect(ROUTE_COSTS).toEqual({
      "live/recognize": 1,
      "live/check": 3,
      "live/solve": 10,
      "live/setup": 2,
      "live/reread": 1,
      "live/proof": 2,
      "live/chat": 3,
      "live/lecture": 2,
      "live/listen": 1,
      "live/sketch": 4,
      credits: 0,
      "config/status": 0,
    });
  });
});

describe("normalizeConsumeResult", () => {
  it("reads the jsonb shape the migration returns", () => {
    expect(normalizeConsumeResult({ ok: true, remaining: 299, reason: null })).toEqual({ ok: true, remaining: 299 });
    expect(normalizeConsumeResult({ ok: false, remaining: 0, reason: "insufficient_credits" })).toEqual({
      ok: false,
      reason: "insufficient_ink",
      remaining: 0,
    });
  });

  it("accepts a one-row set, `allowed`, and numeric strings", () => {
    expect(normalizeConsumeResult([{ allowed: true, remaining: "12" }])).toEqual({ ok: true, remaining: 12 });
  });

  it("treats an unexpected payload as unavailable (never as success)", () => {
    for (const payload of [null, undefined, 5, "ok", {}, { ok: "yes", remaining: 1 }, { ok: true }, []]) {
      const result = normalizeConsumeResult(payload);
      expect(result.ok, JSON.stringify(payload)).toBe(false);
      expect((result as { reason: string }).reason).toBe("unavailable");
    }
  });

  it("never reports a negative balance", () => {
    expect(normalizeConsumeResult({ ok: false, remaining: -4 })).toMatchObject({ remaining: 0 });
  });

  it("reads an Agathon Unlimited answer: ok with the untouched balance, and the fair-use refusal", () => {
    expect(normalizeConsumeResult({ ok: true, remaining: 300, reason: null, unlimited: true })).toEqual({ ok: true, remaining: 300, unlimited: true });
    expect(normalizeConsumeResult({ ok: false, remaining: 300, reason: "fair_use", unlimited: true, retry_after_ms: 3_601_000 })).toEqual({
      ok: false,
      reason: "fair_use",
      retryAfterMs: 3_601_000,
    });
    // a refusal over the cap is never read as out of ink, even with no usable retry hint
    expect(normalizeConsumeResult({ ok: false, remaining: 0, reason: "fair_use" })).toEqual({ ok: false, reason: "fair_use", retryAfterMs: FAIR_USE_FALLBACK_RETRY_MS });
    expect(normalizeConsumeResult({ ok: false, reason: "fair_use", retry_after_ms: 999_999_999 })).toMatchObject({ retryAfterMs: 24 * 60 * 60_000 });
  });
});

describe("consumeErrorToResult", () => {
  it("maps a missing function to unavailable", () => {
    expect(consumeErrorToResult({ message: "Could not find the function public.consume_credits in the schema cache", code: "PGRST202" })).toMatchObject({
      ok: false,
      reason: "unavailable",
      message: expect.stringMatching(/missing/),
    });
    expect(consumeErrorToResult({ message: "function consume_credits(text) does not exist", code: "42883" })).toMatchObject({ reason: "unavailable" });
  });

  it("maps a raised insufficient_credits (or ink) to the 402 path with the balance from details", () => {
    expect(consumeErrorToResult({ message: "insufficient_credits", details: "7" })).toEqual({ ok: false, reason: "insufficient_ink", remaining: 7 });
    expect(consumeErrorToResult({ message: "insufficient credits" })).toEqual({ ok: false, reason: "insufficient_ink", remaining: 0 });
    expect(consumeErrorToResult({ message: "ink_empty", hint: "3" })).toEqual({ ok: false, reason: "insufficient_ink", remaining: 3 });
  });

  it("maps anything else to unavailable with the message", () => {
    expect(consumeErrorToResult({ message: "connection refused" })).toEqual({ ok: false, reason: "unavailable", message: "consume_credits failed: connection refused" });
  });
});

describe("consumeInk", () => {
  const input = { token: "jwt", route: "live/solve" as const, requestId: "req-1", model: "anthropic/claude-sonnet-5" };

  it("calls consume_credits with the route cost and metadata", async () => {
    const client = fakeRpc({ data: { ok: true, remaining: 275, reason: null } });
    await expect(consumeInk(input, client)).resolves.toEqual({ ok: true, remaining: 275 });
    expect(client.calls).toEqual([
      { fn: "consume_credits", args: { p_route: "live/solve", p_units: 10, p_request_id: "req-1", p_model: "anthropic/claude-sonnet-5" } },
    ]);
  });

  it("sends p_model null when no model is given", async () => {
    const client = fakeRpc({ data: { ok: true, remaining: 1 } });
    await consumeInk({ token: "jwt", route: "live/check", requestId: "r" }, client);
    expect(client.calls[0].args).toMatchObject({ p_units: 3, p_model: null });
  });

  it("short-circuits zero-cost routes without touching the database", async () => {
    const client = fakeRpc({ data: { ok: false, remaining: 0 } });
    const result = await consumeInk({ token: "jwt", route: "credits", requestId: "r" }, client);
    expect(result.ok).toBe(true);
    expect(client.calls).toEqual([]);
  });

  it("returns insufficient_ink from the RPC payload", async () => {
    const client = fakeRpc({ data: { ok: false, remaining: 0, reason: "insufficient_credits" } });
    await expect(consumeInk(input, client)).resolves.toEqual({ ok: false, reason: "insufficient_ink", remaining: 0 });
  });

  it("maps RPC errors and thrown errors to unavailable instead of throwing", async () => {
    await expect(consumeInk(input, fakeRpc({ error: { message: "boom" } }))).resolves.toMatchObject({ ok: false, reason: "unavailable" });
    await expect(consumeInk(input, fakeRpc(new Error("network down")))).resolves.toEqual({
      ok: false,
      reason: "unavailable",
      message: "consume_credits threw: network down",
    });
  });
});

describe("responses", () => {
  it("402 ink_empty keeps the error contract and adds remaining + buyUrl (the account page's packs)", async () => {
    const res = inkEmptyResponse(4);
    expect(res.status).toBe(402);
    expect(await res.json()).toEqual({ error: "ink_empty", message: INK_EMPTY_MESSAGE, remaining: 4, buyUrl: BUY_INK_PATH });
    expect(BUY_INK_PATH).toBe("/account");
    expect(INK_EMPTY_MESSAGE).toBe("You're out of ink. Grab an ink pack to keep going.");
    // never a negative balance, and no billing link: Payment Links need the user's id, which only the client has
    process.env.NEXT_PUBLIC_BILLING_LINKS = JSON.stringify({ medium: "https://buy.stripe.com/x" });
    resetServerEnvCache();
    expect(await inkEmptyResponse(-3).json()).toEqual({ error: "ink_empty", message: INK_EMPTY_MESSAGE, remaining: 0, buyUrl: "/account" });
  });

  it("the fair-use 429 says how long, in words a student reads at a glance", async () => {
    expect(aboutHowLong(30_000)).toBe("about a minute");
    expect(aboutHowLong(40 * 60_000)).toBe("about 40 minutes");
    expect(aboutHowLong(70 * 60_000)).toBe("about an hour");
    expect(aboutHowLong(23.6 * 60 * 60_000)).toBe("about 24 hours");
    const res = fairUseResponse(10);
    // at least a second, so Retry-After is never 0
    expect(res.headers.get("retry-after")).toBe("1");
    expect(await res.json()).toMatchObject({ error: "rate_limited", retryAfterMs: 1000, reason: "fair_use" });
  });

  it("503 feature_unavailable points at the migrations", async () => {
    const res = billingUnavailableResponse();
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: "feature_unavailable", message: BILLING_UNAVAILABLE_MESSAGE });
  });
});

describe("billingEnforced", () => {
  it("is on unless BILLING_ENFORCE is exactly '0'", () => {
    expect(billingEnforced()).toBe(true);
    for (const [value, expected] of [["0", false], ["1", true], ["false", true], ["", true]] as const) {
      process.env.BILLING_ENFORCE = value;
      resetServerEnvCache();
      expect(billingEnforced(), `BILLING_ENFORCE=${JSON.stringify(value)}`).toBe(expected);
    }
  });
});

describe("enforceInk", () => {
  const input = { token: "jwt", route: "live/solve" as const, requestId: "r", model: "m" };
  const quiet = { warn: () => undefined };

  it("passes through with the new balance when the RPC allows", async () => {
    const client = fakeRpc({ data: { ok: true, remaining: 290 } });
    await expect(enforceInk(input, quiet, client)).resolves.toEqual({ remaining: 290 });
    expect(client.calls[0].args).toMatchObject({ p_route: "live/solve", p_units: 10 });
  });

  it("answers 402 ink_empty when the ink is short", async () => {
    const result = await enforceInk(input, quiet, fakeRpc({ data: { ok: false, remaining: 4, reason: "insufficient_credits" } }));
    expect("response" in result).toBe(true);
    const res = (result as { response: Response }).response;
    expect(res.status).toBe(402);
    // `cost` is what the refused call needs (a worked solution: 10), so the board knows when it is affordable
    expect(await res.json()).toMatchObject({ error: "ink_empty", remaining: 4, cost: 10, buyUrl: "/account" });
  });

  it("lets an Agathon Unlimited subscriber through with the balance untouched", async () => {
    const client = fakeRpc({ data: { ok: true, remaining: 0, reason: null, unlimited: true } });
    // zero ink left does not matter: the subscription pays for help
    await expect(enforceInk(input, quiet, client)).resolves.toEqual({ remaining: 0 });
  });

  it("answers a subscriber over the fair-use cap like a rate limit: 429 rate_limited with Retry-After, never 402", async () => {
    const result = await enforceInk(input, quiet, fakeRpc({ data: { ok: false, remaining: 0, reason: "fair_use", unlimited: true, retry_after_ms: 3 * 60 * 60_000 } }));
    const res = (result as { response: Response }).response;
    expect(res.status).toBe(429);
    expect(res.headers.get("retry-after")).toBe(String(3 * 60 * 60));
    const body = await res.json();
    expect(body).toMatchObject({ error: "rate_limited", retryAfterMs: 3 * 60 * 60_000, reason: "fair_use" });
    expect(body.message).toBe("You've reached the daily fair-use limit of Agathon Unlimited. The tutor is back in about 3 hours.");
    expect(body).not.toHaveProperty("buyUrl");
  });

  it("fails closed with 503 when the RPC is unavailable and billing is enforced", async () => {
    const result = await enforceInk(input, quiet, fakeRpc({ error: { message: "schema cache", code: "PGRST202" } }));
    const res = (result as { response: Response }).response;
    expect(res.status).toBe(503);
    expect(await res.json()).toMatchObject({ error: "feature_unavailable" });
  });

  it("skips the database entirely when BILLING_ENFORCE=0", async () => {
    process.env.BILLING_ENFORCE = "0";
    resetServerEnvCache();
    const client = fakeRpc({ error: { message: "must not be called" } });
    await expect(enforceInk(input, quiet, client)).resolves.toEqual({ remaining: null });
    await expect(enforceInk(input, quiet, client)).resolves.toEqual({ remaining: null });
    expect(client.calls).toEqual([]);
  });
});

/* ------------------------------------------------------------------------- */
/* Refunds                                                                    */
/* ------------------------------------------------------------------------- */

/** Records what the billing helpers log so tests can assert "only logged". */
function recordingLog() {
  const lines: string[] = [];
  return {
    lines,
    warn: (_obj: object, msg: string) => void lines.push(`warn:${msg}`),
    info: (_obj: object, msg: string) => void lines.push(`info:${msg}`),
  };
}

describe("normalizeRefundResult", () => {
  it("reads the jsonb shape the migration returns (object, one-row set, numeric strings)", () => {
    expect(normalizeRefundResult({ refunded: 3, remaining: 297 })).toEqual({ refunded: 3, remaining: 297 });
    expect(normalizeRefundResult([{ refunded: "10", remaining: "40" }])).toEqual({ refunded: 10, remaining: 40 });
    expect(normalizeRefundResult({ refunded: 0, remaining: 5 })).toEqual({ refunded: 0, remaining: 5 });
  });

  it("treats an unexpected payload as refunded 0 with a reason (never throws)", () => {
    for (const payload of [null, undefined, 7, "ok", {}, { refunded: 1 }, { refunded: "x", remaining: 1 }, []]) {
      expect(normalizeRefundResult(payload), JSON.stringify(payload)).toMatchObject({ refunded: 0, reason: expect.stringMatching(/refund_ink_for/) });
    }
  });
});

describe("refundInk", () => {
  const USER = "11111111-2222-4333-8444-555555555555";
  const input = { userId: USER, requestId: "req-42" };

  it("calls refund_ink_for (service role) with exactly the verified user and the request id", async () => {
    const client = fakeRpc({ data: { refunded: 25, remaining: 300 } });
    const log = recordingLog();
    await expect(refundInk(input, log, client)).resolves.toEqual({ refunded: 25, remaining: 300 });
    expect(client.calls).toEqual([{ fn: "refund_ink_for", args: { p_user_id: USER, p_request_id: "req-42" } }]);
    expect(log.lines).toEqual(["info:ink refunded"]);
  });

  it("without SUPABASE_SERVICE_ROLE_KEY nothing is refunded (logged), and the user's own token is never used", async () => {
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    resetServerEnvCache();
    const log = recordingLog();
    await expect(refundInk(input, log)).resolves.toEqual({ refunded: 0, reason: expect.stringMatching(/SUPABASE_SERVICE_ROLE_KEY/) });
    expect(log.lines).toEqual(["warn:ink refund failed"]);
    expect(serviceClient()).toBeNull();
  });

  it("a refund that matched nothing is refunded 0 without a reason (idempotent, not an error)", async () => {
    const log = recordingLog();
    await expect(refundInk(input, log, fakeRpc({ data: { refunded: 0, remaining: 12 } }))).resolves.toEqual({ refunded: 0, remaining: 12 });
    expect(log.lines).toEqual(["info:ink refunded"]);
  });

  it("maps a missing function, an RPC error and a thrown error to refunded 0 + reason, only logging", async () => {
    const missing = recordingLog();
    await expect(refundInk(input, missing, fakeRpc({ error: { message: "Could not find the function public.refund_ink_for in the schema cache", code: "PGRST202" } }))).resolves.toEqual({
      refunded: 0,
      reason: "refund_ink_for RPC is missing (run the migrations).",
    });
    expect(missing.lines).toEqual(["warn:ink refund failed"]);

    await expect(refundInk(input, recordingLog(), fakeRpc({ error: { message: "deadlock detected" } }))).resolves.toEqual({
      refunded: 0,
      reason: "refund_ink_for failed: deadlock detected",
    });
    await expect(refundInk(input, recordingLog(), fakeRpc(new Error("network down")))).resolves.toEqual({
      refunded: 0,
      reason: "refund_ink_for threw: network down",
    });
  });

  it("skips the database when BILLING_ENFORCE=0 (nothing was charged)", async () => {
    process.env.BILLING_ENFORCE = "0";
    resetServerEnvCache();
    const client = fakeRpc({ data: { refunded: 99, remaining: 99 } });
    await expect(refundInk(input, recordingLog(), client)).resolves.toEqual({ refunded: 0, reason: "not_enforced" });
    expect(client.calls).toEqual([]);
  });
});

describe("runCharged", () => {
  const input = { userId: "11111111-2222-4333-8444-555555555555", requestId: "req-7" };
  const onError = (err: unknown) => Response.json({ error: "upstream_error", message: String(err) }, { status: 502 });

  it("returns a 2xx untouched and never refunds (a text-only model answer is still a 2xx)", async () => {
    const client = fakeRpc({ data: { refunded: 1, remaining: 1 } });
    const res = await runCharged(input, recordingLog(), async () => Response.json({ success: false, imageUrl: null }), onError, client);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ success: false, imageUrl: null });
    expect(client.calls).toEqual([]);
  });

  it("refunds the same request id when run resolves to a non-2xx response", async () => {
    const client = fakeRpc({ data: { refunded: 20, remaining: 120 } });
    const log = recordingLog();
    const res = await runCharged(input, log, async () => Response.json({ error: "recognizer_failed" }, { status: 502 }), onError, client);
    expect(res.status).toBe(502);
    expect(client.calls).toEqual([{ fn: "refund_ink_for", args: { p_user_id: "11111111-2222-4333-8444-555555555555", p_request_id: "req-7" } }]);
    expect(log.lines).toEqual(["info:ink refunded"]);
  });

  it("keeps the charge when the client abandoned a request that asked for it (keepChargeWhenAborted); refunds when not aborted", async () => {
    const aborted = new AbortController();
    aborted.abort();
    const client = fakeRpc({ data: { refunded: 2, remaining: 2 } });
    const log = recordingLog();
    const fail = async () => {
      throw new DOMException("The operation was aborted.", "AbortError");
    };
    const res = await runCharged(input, log, fail, onError, client, { keepChargeWhenAborted: aborted.signal });
    expect(res.status).toBe(502);
    expect(client.calls).toEqual([]);
    expect(log.lines).toEqual(["info:request abandoned by the client after it was charged; charge kept"]);

    const live = new AbortController();
    await runCharged(input, recordingLog(), async () => Response.json({}, { status: 502 }), onError, client, { keepChargeWhenAborted: live.signal });
    expect(client.calls.map((c) => c.fn)).toEqual(["refund_ink_for"]);
  });

  it("maps a thrown error through onError and refunds", async () => {
    const client = fakeRpc({ data: { refunded: 2, remaining: 2 } });
    const res = await runCharged(
      input,
      recordingLog(),
      async () => {
        throw new Error("timeout");
      },
      onError,
      client,
    );
    expect(res.status).toBe(502);
    expect(await res.json()).toMatchObject({ error: "upstream_error", message: "Error: timeout" });
    expect(client.calls.map((c) => c.fn)).toEqual(["refund_ink_for"]);
  });

  it("still returns the error response when the refund itself fails (only logged)", async () => {
    const log = recordingLog();
    const res = await runCharged(input, log, async () => Response.json({}, { status: 500 }), onError, fakeRpc(new Error("db gone")));
    expect(res.status).toBe(500);
    expect(log.lines).toEqual(["warn:ink refund failed"]);
  });
});
