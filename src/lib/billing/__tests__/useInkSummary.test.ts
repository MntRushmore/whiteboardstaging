import { describe, expect, it, vi } from "vitest";
import {
  AUTH_RETRY_DELAY_MS,
  INK_CHANGED_EVENT,
  INK_CHANGED_KEY,
  INK_CHECKOUT_EVENT,
  notifyInkChanged,
  watchInkCheckout,
  INK_SUMMARY_FALLBACK,
  isRetryableAuthError,
  readInkSummary,
  type InkSummaryRpc,
} from "@/lib/billing/useInkSummary";

/** Shape the RPC returns on success (ink_summary() jsonb). */
const SUMMARY = {
  balance: 297,
  granted: 300,
  purchased: 0,
  refunded: 0,
  used: 3,
  starter: 300,
  starter_at: "2026-10-02T00:00:00Z",
  purchases: 0,
  last_purchase: null,
};

/** An rpc that returns each queued result in turn and records how often it was called. */
function fakeRpc(results: Array<{ data?: unknown; error?: unknown }>): {
  rpc: InkSummaryRpc;
  calls: () => number;
} {
  let i = 0;
  let calls = 0;
  const rpc: InkSummaryRpc = () => {
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
    expect(isRetryableAuthError({ code: "42501", message: "permission denied for function ink_summary" })).toBe(false);
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

describe("readInkSummary", () => {
  it("returns the parsed summary on the first try", async () => {
    const { rpc, calls } = fakeRpc([{ data: SUMMARY }]);
    const sleep = vi.fn(async () => undefined);
    await expect(readInkSummary(rpc, { sleep })).resolves.toEqual({
      summary: expect.objectContaining({ starter: 300, balance: 297 }),
    });
    expect(calls()).toBe(1);
    expect(sleep).not.toHaveBeenCalled();
  });

  it("retries once after a transient auth error and then succeeds", async () => {
    const { rpc, calls } = fakeRpc([{ error: { code: "PGRST303", message: "JWT issued at future" } }, { data: SUMMARY }]);
    const sleep = vi.fn(async () => undefined);
    await expect(readInkSummary(rpc, { sleep, retryDelayMs: 42 })).resolves.toEqual({
      summary: expect.objectContaining({ balance: 297 }),
    });
    expect(calls()).toBe(2);
    expect(sleep).toHaveBeenCalledWith(42);
  });

  it("defaults the retry delay to AUTH_RETRY_DELAY_MS", async () => {
    const { rpc } = fakeRpc([{ error: { status: 401 } }, { data: SUMMARY }]);
    const sleep = vi.fn(async () => undefined);
    await readInkSummary(rpc, { sleep });
    expect(sleep).toHaveBeenCalledWith(AUTH_RETRY_DELAY_MS);
  });

  it("reports the error when the retry also fails", async () => {
    const { rpc, calls } = fakeRpc([{ error: { status: 401, message: "Unauthorized" } }]);
    const result = await readInkSummary(rpc, { sleep: async () => undefined });
    expect(calls()).toBe(2);
    expect(result).toHaveProperty("error");
  });

  it("does not retry an error a retry cannot fix", async () => {
    const { rpc, calls } = fakeRpc([{ error: { code: "42501", message: "permission denied for function ink_summary" } }]);
    const sleep = vi.fn(async () => undefined);
    const result = await readInkSummary(rpc, { sleep });
    expect(calls()).toBe(1);
    expect(sleep).not.toHaveBeenCalled();
    expect(result).toHaveProperty("error");
  });

  it("falls back when the payload does not parse, without retrying", async () => {
    const { rpc, calls } = fakeRpc([{ data: { balance: 3 } }]);
    await expect(readInkSummary(rpc, { sleep: async () => undefined })).resolves.toEqual({
      error: INK_SUMMARY_FALLBACK,
    });
    expect(calls()).toBe(1);
  });
});

describe("telling the other ink surfaces", () => {
  it("notifyInkChanged fires the window event and pings the other tabs through storage", () => {
    const seen: string[] = [];
    const store = new Map<string, string>();
    vi.stubGlobal("window", {
      dispatchEvent: (e: Event) => seen.push(e.type),
      localStorage: { setItem: (k: string, v: string) => store.set(k, v) },
    });
    try {
      notifyInkChanged();
    } finally {
      vi.unstubAllGlobals();
    }
    expect(seen).toEqual([INK_CHANGED_EVENT]);
    expect(Number(store.get(INK_CHANGED_KEY))).toBeGreaterThan(0);
  });

  it("still tells this tab when storage is blocked", () => {
    const seen: string[] = [];
    vi.stubGlobal("window", {
      dispatchEvent: (e: Event) => seen.push(e.type),
      localStorage: {
        setItem: () => {
          throw new Error("SecurityError");
        },
      },
    });
    try {
      expect(() => notifyInkChanged()).not.toThrow();
    } finally {
      vi.unstubAllGlobals();
    }
    expect(seen).toEqual([INK_CHANGED_EVENT]);
  });

  it("watchInkCheckout fires the event the hooks start their checkout watch on", () => {
    const seen: string[] = [];
    vi.stubGlobal("window", { dispatchEvent: (e: Event) => seen.push(e.type) });
    try {
      watchInkCheckout();
    } finally {
      vi.unstubAllGlobals();
    }
    expect(seen).toEqual([INK_CHECKOUT_EVENT]);
  });
});
