import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { resetServerEnvCache } from "@/lib/env";
import {
  BILLING_UNAVAILABLE_MESSAGE,
  CREDITS_EXHAUSTED_MESSAGE,
  ROUTE_COSTS,
  billingEnforced,
  billingUnavailableResponse,
  consumeCredits,
  consumeErrorToResult,
  creditsExhaustedResponse,
  enforceCredits,
  normalizeConsumeResult,
  resetBillingWarnings,
  type RpcClient,
  type RpcError,
} from "@/lib/server/billing";

const ENV_VARS = ["BILLING_ENFORCE", "NEXT_PUBLIC_BILLING_LINKS", "NEXT_PUBLIC_SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_ANON_KEY", "OPENROUTER_API_KEY"];
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
      "generate-solution": 25,
      "generate-worksheet": 20,
      "voice/analyze-workspace": 3,
      ocr: 2,
      "check-help-needed": 2,
      credits: 0,
      "config/status": 0,
      "voice/token": 0,
    });
  });
});

describe("normalizeConsumeResult", () => {
  it("reads the jsonb shape the migration returns", () => {
    expect(normalizeConsumeResult({ ok: true, remaining: 299, reason: null })).toEqual({ ok: true, remaining: 299 });
    expect(normalizeConsumeResult({ ok: false, remaining: 0, reason: "insufficient_credits" })).toEqual({
      ok: false,
      reason: "insufficient_credits",
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

  it("maps a raised insufficient_credits to the 402 path with the balance from details", () => {
    expect(consumeErrorToResult({ message: "insufficient_credits", details: "7" })).toEqual({ ok: false, reason: "insufficient_credits", remaining: 7 });
    expect(consumeErrorToResult({ message: "insufficient credits" })).toEqual({ ok: false, reason: "insufficient_credits", remaining: 0 });
  });

  it("maps anything else to unavailable with the message", () => {
    expect(consumeErrorToResult({ message: "connection refused" })).toEqual({ ok: false, reason: "unavailable", message: "consume_credits failed: connection refused" });
  });
});

describe("consumeCredits", () => {
  const input = { token: "jwt", route: "generate-solution" as const, requestId: "req-1", model: "google/gemini-3-pro-image-preview" };

  it("calls consume_credits with the route cost and metadata", async () => {
    const client = fakeRpc({ data: { ok: true, remaining: 275, reason: null } });
    await expect(consumeCredits(input, client)).resolves.toEqual({ ok: true, remaining: 275 });
    expect(client.calls).toEqual([
      { fn: "consume_credits", args: { p_route: "generate-solution", p_units: 25, p_request_id: "req-1", p_model: "google/gemini-3-pro-image-preview" } },
    ]);
  });

  it("sends p_model null when no model is given", async () => {
    const client = fakeRpc({ data: { ok: true, remaining: 1 } });
    await consumeCredits({ token: "jwt", route: "ocr", requestId: "r" }, client);
    expect(client.calls[0].args).toMatchObject({ p_units: 2, p_model: null });
  });

  it("short-circuits zero-cost routes without touching the database", async () => {
    const client = fakeRpc({ data: { ok: false, remaining: 0 } });
    const result = await consumeCredits({ token: "jwt", route: "credits", requestId: "r" }, client);
    expect(result.ok).toBe(true);
    expect(client.calls).toEqual([]);
  });

  it("returns insufficient_credits from the RPC payload", async () => {
    const client = fakeRpc({ data: { ok: false, remaining: 0, reason: "insufficient_credits" } });
    await expect(consumeCredits(input, client)).resolves.toEqual({ ok: false, reason: "insufficient_credits", remaining: 0 });
  });

  it("maps RPC errors and thrown errors to unavailable instead of throwing", async () => {
    await expect(consumeCredits(input, fakeRpc({ error: { message: "boom" } }))).resolves.toMatchObject({ ok: false, reason: "unavailable" });
    await expect(consumeCredits(input, fakeRpc(new Error("network down")))).resolves.toEqual({
      ok: false,
      reason: "unavailable",
      message: "consume_credits threw: network down",
    });
  });
});

describe("responses", () => {
  it("402 keeps the error contract and adds remaining + upgradeUrl (portal when configured)", async () => {
    const res = creditsExhaustedResponse(0);
    expect(res.status).toBe(402);
    expect(await res.json()).toEqual({ error: "credits_exhausted", message: CREDITS_EXHAUSTED_MESSAGE, remaining: 0, upgradeUrl: "/account" });

    process.env.NEXT_PUBLIC_BILLING_LINKS = JSON.stringify({ portal: "https://billing.example.com/p/abc" });
    resetServerEnvCache();
    const withPortal = await creditsExhaustedResponse(-3, "2026-10-01T00:00:00.000Z").json();
    expect(withPortal).toEqual({
      error: "credits_exhausted",
      message: CREDITS_EXHAUSTED_MESSAGE,
      remaining: 0,
      upgradeUrl: "https://billing.example.com/p/abc",
      periodEnd: "2026-10-01T00:00:00.000Z",
    });
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

describe("enforceCredits", () => {
  const input = { token: "jwt", route: "live/solve" as const, requestId: "r", model: "m" };
  const quiet = { warn: () => undefined };

  it("passes through with the new balance when the RPC allows", async () => {
    const client = fakeRpc({ data: { ok: true, remaining: 290 } });
    await expect(enforceCredits(input, quiet, client)).resolves.toEqual({ remaining: 290 });
    expect(client.calls[0].args).toMatchObject({ p_route: "live/solve", p_units: 10 });
  });

  it("answers 402 on insufficient credits", async () => {
    const result = await enforceCredits(input, quiet, fakeRpc({ data: { ok: false, remaining: 4, reason: "insufficient_credits" } }));
    expect("response" in result).toBe(true);
    const res = (result as { response: Response }).response;
    expect(res.status).toBe(402);
    expect(await res.json()).toMatchObject({ error: "credits_exhausted", remaining: 4 });
  });

  it("fails closed with 503 when the RPC is unavailable and billing is enforced", async () => {
    const result = await enforceCredits(input, quiet, fakeRpc({ error: { message: "schema cache", code: "PGRST202" } }));
    const res = (result as { response: Response }).response;
    expect(res.status).toBe(503);
    expect(await res.json()).toMatchObject({ error: "feature_unavailable" });
  });

  it("skips the database entirely when BILLING_ENFORCE=0", async () => {
    process.env.BILLING_ENFORCE = "0";
    resetServerEnvCache();
    const client = fakeRpc({ error: { message: "must not be called" } });
    await expect(enforceCredits(input, quiet, client)).resolves.toEqual({ remaining: null });
    await expect(enforceCredits(input, quiet, client)).resolves.toEqual({ remaining: null });
    expect(client.calls).toEqual([]);
  });
});
