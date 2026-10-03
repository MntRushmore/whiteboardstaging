import { describe, expect, it, vi } from "vitest";
import {
  AUTH_RETRY_DELAY_MS,
  CREDIT_SUMMARY_FALLBACK,
  isRetryableAuthError,
  readCreditSummary,
  type CreditSummaryRpc,
} from "@/lib/billing/useCreditSummary";

/** Shape the RPC returns on success (credit_summary() jsonb). */
const SUMMARY = {
  plan_id: "free",
  plan_name: "Free",
  monthly_credits: 300,
  used: 3,
  granted: 0,
  remaining: 297,
  period_start: "2026-09-01T00:00:00Z",
  period_end: "2026-10-01T00:00:00Z",
};

/** An rpc that returns each queued result in turn and records how often it was called. */
function fakeRpc(results: Array<{ data?: unknown; error?: unknown }>): {
  rpc: CreditSummaryRpc;
  calls: () => number;
} {
  let i = 0;
  let calls = 0;
  const rpc: CreditSummaryRpc = () => {
    calls++;
    const next = results[Math.min(i++, results.length - 1)];
    return Promise.resolve({ data: next.data ?? null, error: next.error ?? null });
  };
  return { rpc, calls: () => calls };
}

describe("isRetryableAuthError", () => {
  it("is true for a token that has not propagated yet", () => {
    // PostgREST's clock trailing the auth server's: the classic first-call-after-sign-in 401.
    expect(isRetryableAuthError({ code: "PGRST303", message: "JWT issued at future" })).toBe(true);
    expect(isRetryableAuthError({ code: "PGRST301", message: "JWT expired" })).toBe(true);
    expect(isRetryableAuthError({ status: 401, message: "Unauthorized" })).toBe(true);
    expect(isRetryableAuthError({ message: "invalid JWT: unable to parse" })).toBe(true);
  });

  it("is false for real failures that a retry cannot fix", () => {
    expect(isRetryableAuthError({ code: "42501", message: "permission denied for function credit_summary" })).toBe(false);
    expect(isRetryableAuthError({ code: "PGRST202", message: "Could not find the function" })).toBe(false);
    expect(isRetryableAuthError({ status: 500, message: "boom" })).toBe(false);
    expect(isRetryableAuthError(new TypeError("Failed to fetch"))).toBe(false);
    expect(isRetryableAuthError(null)).toBe(false);
    expect(isRetryableAuthError("nope")).toBe(false);
  });

  it("does not treat an unrelated word containing jwt as a token error", () => {
    expect(isRetryableAuthError({ message: "jwtish nonsense" })).toBe(false);
  });
});

describe("readCreditSummary", () => {
  it("returns the parsed summary on the first try", async () => {
    const { rpc, calls } = fakeRpc([{ data: SUMMARY }]);
    const sleep = vi.fn(async () => undefined);
    await expect(readCreditSummary(rpc, { sleep })).resolves.toEqual({
      summary: expect.objectContaining({ plan_id: "free", remaining: 297 }),
    });
    expect(calls()).toBe(1);
    expect(sleep).not.toHaveBeenCalled();
  });

  it("retries once after a transient auth error and then succeeds", async () => {
    const { rpc, calls } = fakeRpc([{ error: { code: "PGRST303", message: "JWT issued at future" } }, { data: SUMMARY }]);
    const sleep = vi.fn(async () => undefined);
    await expect(readCreditSummary(rpc, { sleep, retryDelayMs: 42 })).resolves.toEqual({
      summary: expect.objectContaining({ remaining: 297 }),
    });
    expect(calls()).toBe(2);
    expect(sleep).toHaveBeenCalledWith(42);
  });

  it("defaults the retry delay to AUTH_RETRY_DELAY_MS", async () => {
    const { rpc } = fakeRpc([{ error: { status: 401 } }, { data: SUMMARY }]);
    const sleep = vi.fn(async () => undefined);
    await readCreditSummary(rpc, { sleep });
    expect(sleep).toHaveBeenCalledWith(AUTH_RETRY_DELAY_MS);
  });

  it("reports the error when the retry also fails", async () => {
    const { rpc, calls } = fakeRpc([{ error: { status: 401, message: "Unauthorized" } }]);
    const result = await readCreditSummary(rpc, { sleep: async () => undefined });
    expect(calls()).toBe(2);
    expect(result).toHaveProperty("error");
  });

  it("does not retry an error a retry cannot fix", async () => {
    const { rpc, calls } = fakeRpc([{ error: { code: "42501", message: "permission denied for function credit_summary" } }]);
    const sleep = vi.fn(async () => undefined);
    const result = await readCreditSummary(rpc, { sleep });
    expect(calls()).toBe(1);
    expect(sleep).not.toHaveBeenCalled();
    expect(result).toHaveProperty("error");
  });

  it("falls back when the payload does not parse, without retrying", async () => {
    const { rpc, calls } = fakeRpc([{ data: { plan_id: "free" } }]);
    await expect(readCreditSummary(rpc, { sleep: async () => undefined })).resolves.toEqual({
      error: CREDIT_SUMMARY_FALLBACK,
    });
    expect(calls()).toBe(1);
  });
});
