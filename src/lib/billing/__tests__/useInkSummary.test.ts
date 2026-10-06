import { describe, expect, it, vi } from "vitest";
import {
  AUTH_RETRY_DELAY_MS,
  INK_CHANGED_EVENT,
  INK_CHANGED_KEY,
  INK_CHECKOUT_EVENT,
  CHECKOUT_MARK_MAX_AGE_MS,
  INK_CHECKOUT_MARK_KEY,
  clearCheckoutMark,
  notifyInkChanged,
  readCheckoutMark,
  watchInkCheckout,
  INK_SUMMARY_FALLBACK,
  isRetryableAuthError,
  readInkSummary,
  createInkStore,
  bindInkEvents,
  INK_FRESH_MS,
  SPENT_REREAD_MS,
  CHECKOUT_WATCH_MS,
  type InkSummaryRpc,
  type ReadInkSummaryResult,
} from "@/lib/billing/useInkSummary";
import { INK_SPENT_EVENT } from "@/lib/api-client";
import { parseInkSummary } from "@/lib/billing/inkSummary";

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

  it("watchInkCheckout remembers the purchase the student had, and fires the event the hooks watch on", () => {
    const seen: string[] = [];
    const store = new Map<string, string>();
    const localStorage = {
      setItem: (k: string, v: string) => store.set(k, v),
      getItem: (k: string) => store.get(k) ?? null,
      removeItem: (k: string) => store.delete(k),
    };
    vi.stubGlobal("window", { dispatchEvent: (e: Event) => seen.push(e.type), localStorage });
    try {
      watchInkCheckout(7);
      expect(seen).toEqual([INK_CHECKOUT_EVENT]);
      const mark = readCheckoutMark();
      expect(mark).toMatchObject({ lastPurchaseId: 7 });
      expect(JSON.parse(store.get(INK_CHECKOUT_MARK_KEY) ?? "{}")).toMatchObject({ lastPurchaseId: 7 });
      // a mark from a checkout abandoned hours ago is ignored
      expect(readCheckoutMark((mark?.at ?? 0) + CHECKOUT_MARK_MAX_AGE_MS + 1)).toBeNull();
      clearCheckoutMark();
      expect(readCheckoutMark()).toBeNull();
      watchInkCheckout(null);
      expect(readCheckoutMark()).toMatchObject({ lastPurchaseId: null });
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("a blocked storage never breaks the buy button (the event still fires; no mark)", () => {
    const seen: string[] = [];
    const blocked = () => {
      throw new Error("SecurityError");
    };
    vi.stubGlobal("window", { dispatchEvent: (e: Event) => seen.push(e.type), localStorage: { setItem: blocked, getItem: blocked, removeItem: blocked } });
    try {
      expect(() => watchInkCheckout(3)).not.toThrow();
      expect(readCheckoutMark()).toBeNull();
      expect(() => clearCheckoutMark()).not.toThrow();
    } finally {
      vi.unstubAllGlobals();
    }
    expect(seen).toEqual([INK_CHECKOUT_EVENT]);
  });
});

describe("the shared ink store (one request, one cache, one set of listeners per page)", () => {
  function summaryWith(balance: number) {
    const parsed = parseInkSummary({ ...SUMMARY, balance, used: Math.max(0, 300 - balance) });
    if (!parsed) throw new Error("fixture does not parse");
    return parsed;
  }

  /** A store whose reads wait for `answer()`, with a hand-moved clock and counted listener sets. */
  function harness(bindTo?: { win: EventTarget; doc: EventTarget & { visibilityState: DocumentVisibilityState } }) {
    const pending: Array<(r: ReadInkSummaryResult) => void> = [];
    let clock = 1_000_000;
    const bound = { count: 0 };
    const read = vi.fn(() => new Promise<ReadInkSummaryResult>((resolve) => pending.push(resolve)));
    const store = createInkStore({
      read,
      now: () => clock,
      bind: (s) => {
        bound.count++;
        const unbind = bindTo ? bindInkEvents(s, bindTo.win, bindTo.doc) : () => undefined;
        return () => {
          bound.count--;
          unbind();
        };
      },
    });
    return {
      store,
      read,
      bound,
      advance: (ms: number) => {
        clock += ms;
      },
      /** settle the oldest read in flight (with the Agathon Unlimited part when given) */
      async answer(balance = 297, unlimited?: Record<string, unknown>) {
        const resolve = pending.shift();
        if (!resolve) throw new Error("no read in flight");
        resolve({ summary: unlimited ? { ...summaryWith(balance), unlimited } : summaryWith(balance) });
        for (let i = 0; i < 5; i++) await Promise.resolve();
      },
    };
  }

  function page() {
    return { win: new EventTarget(), doc: Object.assign(new EventTarget(), { visibilityState: "visible" as DocumentVisibilityState }) };
  }

  it("two consumers mounting together (header + page, or StrictMode's double effect) make one read", async () => {
    const h = harness();
    const offHeader = h.store.attach("u1");
    const offPage = h.store.attach("u1");
    expect(h.read).toHaveBeenCalledTimes(1);
    expect(h.bound.count).toBe(1); // one set of window listeners for the page
    await h.answer(250);
    expect(h.store.getState()).toMatchObject({ status: "ready", data: { balance: 250 } });
    offHeader();
    expect(h.bound.count).toBe(1);
    offPage();
    expect(h.bound.count).toBe(0);
  });

  it("a remount within INK_FRESH_MS (a page swapping its layout) uses the cached answer; later, reads again", async () => {
    const h = harness();
    const off = h.store.attach("u1");
    await h.answer();
    off();
    h.advance(INK_FRESH_MS - 1);
    const again = h.store.attach("u1");
    expect(h.read).toHaveBeenCalledTimes(1);
    expect(h.store.getState().status).toBe("ready");
    again();
    h.advance(2);
    h.store.attach("u1");
    expect(h.read).toHaveBeenCalledTimes(2);
  });

  it("focus and visibilitychange when the tab comes back are one read, and none right after a read", async () => {
    const p = page();
    const h = harness(p);
    h.store.attach("u1");
    h.store.attach("u1");
    h.advance(INK_FRESH_MS);
    p.win.dispatchEvent(new Event("focus"));
    p.doc.dispatchEvent(new Event("visibilitychange"));
    expect(h.read).toHaveBeenCalledTimes(1); // the mount's read is still in flight: joined
    await h.answer();
    p.win.dispatchEvent(new Event("focus"));
    p.doc.dispatchEvent(new Event("visibilitychange"));
    expect(h.read).toHaveBeenCalledTimes(1); // fresh
    h.advance(INK_FRESH_MS);
    p.win.dispatchEvent(new Event("focus"));
    p.doc.dispatchEvent(new Event("visibilitychange"));
    expect(h.read).toHaveBeenCalledTimes(2); // stale: exactly one read for both events
    p.doc.visibilityState = "hidden";
    await h.answer();
    h.advance(INK_FRESH_MS);
    p.doc.dispatchEvent(new Event("visibilitychange"));
    expect(h.read).toHaveBeenCalledTimes(2); // going hidden reads nothing
  });

  it("a balance change reads even when fresh, and once more after a read already in flight", async () => {
    const p = page();
    const h = harness(p);
    h.store.attach("u1");
    h.store.attach("u1"); // two surfaces, one listener set
    p.win.dispatchEvent(new Event(INK_CHANGED_EVENT));
    p.win.dispatchEvent(new Event(INK_CHANGED_EVENT));
    expect(h.read).toHaveBeenCalledTimes(1);
    await h.answer(100); // that read may predate the change...
    expect(h.read).toHaveBeenCalledTimes(2); // ...so exactly one more
    await h.answer(1100);
    expect(h.store.getState().data?.balance).toBe(1100);
    expect(h.read).toHaveBeenCalledTimes(2);
    // another tab's ping (storage) is a change; an unrelated key is not
    p.win.dispatchEvent(Object.assign(new Event("storage"), { key: "something-else" }));
    expect(h.read).toHaveBeenCalledTimes(2);
    p.win.dispatchEvent(Object.assign(new Event("storage"), { key: INK_CHANGED_KEY }));
    expect(h.read).toHaveBeenCalledTimes(3);
  });

  it("a 402's remaining is shown without a read; other paid calls re-read once after the burst", async () => {
    vi.useFakeTimers();
    try {
      const p = page();
      const h = harness(p);
      h.store.attach("u1");
      await h.answer(300);
      p.win.dispatchEvent(new CustomEvent(INK_SPENT_EVENT, { detail: { remaining: 12 } }));
      expect(h.store.getState().data).toMatchObject({ balance: 12, used: 288 });
      expect(h.read).toHaveBeenCalledTimes(1);
      p.win.dispatchEvent(new CustomEvent(INK_SPENT_EVENT, { detail: {} }));
      vi.advanceTimersByTime(1000);
      p.win.dispatchEvent(new CustomEvent(INK_SPENT_EVENT, { detail: {} }));
      vi.advanceTimersByTime(SPENT_REREAD_MS - 1);
      expect(h.read).toHaveBeenCalledTimes(1);
      vi.advanceTimersByTime(1);
      expect(h.read).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it("another account starts from loading and never sees the previous account's late answer", async () => {
    const h = harness();
    h.store.attach("a")();
    h.store.attach("b");
    expect(h.read).toHaveBeenCalledTimes(2);
    expect(h.store.userId()).toBe("b");
    await h.answer(999); // a's read lands late: dropped
    expect(h.store.getState().status).toBe("loading");
    await h.answer(42);
    expect(h.store.getState().data?.balance).toBe(42);
  });

  it("the checkout watch re-reads until the balance grows, then stops", async () => {
    vi.useFakeTimers();
    try {
      const p = page();
      const h = harness(p);
      h.store.attach("u1");
      await h.answer(10);
      p.win.dispatchEvent(new Event(INK_CHECKOUT_EVENT));
      expect(h.read).toHaveBeenCalledTimes(2);
      await h.answer(10); // the balance before paying
      vi.advanceTimersByTime(CHECKOUT_WATCH_MS);
      expect(h.read).toHaveBeenCalledTimes(3);
      await h.answer(10);
      vi.advanceTimersByTime(CHECKOUT_WATCH_MS);
      expect(h.read).toHaveBeenCalledTimes(4);
      await h.answer(1010); // the pack arrived
      vi.advanceTimersByTime(CHECKOUT_WATCH_MS * 10);
      expect(h.read).toHaveBeenCalledTimes(4);
    } finally {
      vi.useRealTimers();
    }
  });

  it("the checkout watch also stops when Agathon Unlimited turns on (the balance does not move)", async () => {
    vi.useFakeTimers();
    try {
      const p = page();
      const h = harness(p);
      const none = { status: "none", unlimited: false };
      const trialing = { status: "trialing", unlimited: true, trial_end: "2026-10-10T00:00:00Z", current_period_end: "2026-10-10T00:00:00Z", cancel_at_period_end: false, cancel_at: null };
      h.store.attach("u1");
      await h.answer(0, none);
      h.store.watchCheckout(); // back on ?unlimited=started
      await h.answer(0, none); // before the webhook
      vi.advanceTimersByTime(CHECKOUT_WATCH_MS);
      expect(h.read).toHaveBeenCalledTimes(3);
      await h.answer(0, trialing); // the free trial arrived
      vi.advanceTimersByTime(CHECKOUT_WATCH_MS * 10);
      expect(h.read).toHaveBeenCalledTimes(3);
      expect(h.store.getState().data?.unlimited).toEqual(trialing);
    } finally {
      vi.useRealTimers();
    }
  });

  it("a watch that starts with the plan already on still waits for a pack's ink", async () => {
    vi.useFakeTimers();
    try {
      const p = page();
      const h = harness(p);
      const on = { status: "active", unlimited: true };
      h.store.attach("u1");
      await h.answer(10, on);
      p.win.dispatchEvent(new Event(INK_CHECKOUT_EVENT)); // a subscriber buying ink for later
      await h.answer(10, on);
      vi.advanceTimersByTime(CHECKOUT_WATCH_MS);
      expect(h.read).toHaveBeenCalledTimes(3);
      await h.answer(1010, on);
      vi.advanceTimersByTime(CHECKOUT_WATCH_MS * 10);
      expect(h.read).toHaveBeenCalledTimes(3);
    } finally {
      vi.useRealTimers();
    }
  });

  it("nothing reads while no consumer is mounted, and the listeners go with the last one", () => {
    const p = page();
    const h = harness(p);
    void h.store.refresh(true);
    expect(h.read).not.toHaveBeenCalled();
    h.store.attach("u1")();
    expect(h.read).toHaveBeenCalledTimes(1);
    p.win.dispatchEvent(new Event(INK_CHANGED_EVENT));
    void h.store.refresh(true);
    expect(h.read).toHaveBeenCalledTimes(1);
  });
});
