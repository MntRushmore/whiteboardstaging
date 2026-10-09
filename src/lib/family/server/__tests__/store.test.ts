/**
 * The service-role store's own logic (src/lib/family/server/store.ts) over a fake supabase-js client:
 * the PIN's counter fails CLOSED (no per-instance fallback that a 60-second prune could wipe), the
 * family_pin_attempt answer is read strictly, the plan and kids-added budget are asked of the
 * database with the right arguments, and "the kids' images" never deletes a kid's account.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.hoisted(() => {
  process.env.LOG_LEVEL = "silent";
});

import { checkRateLimit, resetRateLimits } from "@/lib/server/rate-limit";
import { PIN_ATTEMPTS, PIN_DAILY_LIMIT } from "../pin";
import { KID_ADDS, parsePinAttempt, storeOver } from "../store";

const PARENT = "11111111-1111-4111-8111-111111111111";
const KID = "22222222-2222-4222-8222-222222222222";

type Rpc = (fn: string, args: Record<string, unknown>) => Promise<{ data: unknown; error: { message: string } | null }>;

function fakeSvc(rpc: Rpc, assets: string[] = []) {
  const calls = { rpc: [] as Array<{ fn: string; args: Record<string, unknown> }>, removed: [] as string[][], deletedUsers: [] as string[] };
  const svc = {
    rpc: (fn: string, args: Record<string, unknown>) => {
      calls.rpc.push({ fn, args });
      return rpc(fn, args);
    },
    from: () => ({ select: () => ({ eq: async () => ({ data: assets.map((object_path) => ({ object_path })), error: null }) }) }),
    storage: { from: () => ({ remove: async (paths: string[]) => (calls.removed.push(paths), { data: null, error: null }) }) },
    auth: { admin: { deleteUser: async (id: string) => (calls.deletedUsers.push(id), { data: null, error: null }) } },
  };
  return { store: storeOver(svc as unknown as SupabaseClient, () => ({}) as SupabaseClient), calls };
}

beforeEach(() => resetRateLimits());

describe("parsePinAttempt", () => {
  it("reads an allowed try, with the day's last one flagged", () => {
    expect(parsePinAttempt({ allowed: true, remaining: 3, window_start: "2026-10-09T03:30:00+00:00", last: false })).toEqual({ ok: true, remaining: 3, windowStart: "2026-10-09T03:30:00+00:00", last: false });
    expect(parsePinAttempt([{ allowed: true, remaining: 0, window_start: "w", last: true }])).toMatchObject({ ok: true, last: true });
  });

  it("tells the 15-minute wait from the day's lock", () => {
    expect(parsePinAttempt({ allowed: false, retry_after_ms: 120_000, locked: false })).toEqual({ ok: false, reason: "too_many", retryAfterMs: 120_000 });
    expect(parsePinAttempt({ allowed: false, retry_after_ms: 80_000_000, locked: true })).toEqual({ ok: false, reason: "locked", retryAfterMs: 80_000_000 });
    // no usable wait: the budget's own length
    expect(parsePinAttempt({ allowed: false })).toEqual({ ok: false, reason: "too_many", retryAfterMs: PIN_ATTEMPTS.windowMs });
    expect(parsePinAttempt({ allowed: false, locked: true })).toEqual({ ok: false, reason: "locked", retryAfterMs: 24 * 60 * 60_000 });
  });

  it("is null for anything else (the store then refuses the try)", () => {
    for (const data of [null, undefined, "yes", [], {}, { allowed: "true" }, { allowed: true }, { allowed: true, window_start: "" }]) {
      expect(parsePinAttempt(data), JSON.stringify(data)).toBeNull();
    }
  });
});

describe("the PIN's counter", () => {
  it("asks family_pin_attempt with both budgets", async () => {
    const { store, calls } = fakeSvc(async () => ({ data: { allowed: true, remaining: 4, window_start: "w", last: false }, error: null }));
    expect(await store.pinAttempt(PARENT)).toEqual({ ok: true, remaining: 4, windowStart: "w", last: false });
    expect(calls.rpc).toEqual([{ fn: "family_pin_attempt", args: { p_parent: PARENT, p_limit: PIN_ATTEMPTS.limit, p_window_ms: PIN_ATTEMPTS.windowMs, p_day_limit: PIN_DAILY_LIMIT } }]);
  });

  it("fails CLOSED, every time, when the database errors, answers oddly or throws", async () => {
    for (const rpc of [
      async () => ({ data: null, error: { message: "Could not find the function public.family_pin_attempt" } }),
      async () => ({ data: { surprise: true }, error: null }),
      async () => {
        throw new Error("network down");
      },
    ] satisfies Rpc[]) {
      const { store } = fakeSvc(rpc);
      for (let i = 0; i < PIN_ATTEMPTS.limit + 3; i++) expect(await store.pinAttempt(PARENT)).toEqual({ ok: false, reason: "unavailable" });
    }
  });

  it("keeps no in-memory count a prune could reset (finding: the 60-second prune wiped the 15-minute key)", async () => {
    const { store } = fakeSvc(async () => ({ data: null, error: { message: "down" } }));
    vi.useFakeTimers();
    try {
      for (let i = 0; i < PIN_ATTEMPTS.limit; i++) await store.pinAttempt(PARENT);
      vi.advanceTimersByTime(2 * 60_000);
      // any other bucket's call prunes stale keys; the PIN never had one to lose
      checkRateLimit("ip:1.2.3.4:health", { limit: 10, windowMs: 60_000 });
      expect(await store.pinAttempt(PARENT)).toEqual({ ok: false, reason: "unavailable" });
    } finally {
      vi.useRealTimers();
    }
  });

  it("gives a right PIN's try back with its window, and never throws", async () => {
    const { store, calls } = fakeSvc(async () => ({ data: null, error: { message: "down" } }));
    await expect(store.pinForgive(PARENT, "2026-10-09T03:30:00+00:00")).resolves.toBeUndefined();
    expect(calls.rpc).toEqual([{ fn: "family_pin_forgive", args: { p_parent: PARENT, p_window_start: "2026-10-09T03:30:00+00:00" } }]);
  });
});

describe("adding kids", () => {
  it("reads the plan with has_unlimited and throws when it cannot (never adds unchecked)", async () => {
    const yes = fakeSvc(async () => ({ data: true, error: null }));
    expect(await yes.store.hasPlan(PARENT)).toBe(true);
    expect(yes.calls.rpc).toEqual([{ fn: "has_unlimited", args: { p_uid: PARENT } }]);
    expect(await fakeSvc(async () => ({ data: false, error: null })).store.hasPlan(PARENT)).toBe(false);
    await expect(fakeSvc(async () => ({ data: null, error: { message: "down" } })).store.hasPlan(PARENT)).rejects.toThrow(/plan not read/);
  });

  it(`counts each add against the family's ${KID_ADDS.limit} a day, and throws when the counter cannot be asked`, async () => {
    const { store, calls } = fakeSvc(async () => ({ data: { allowed: false, remaining: 0, retry_after_ms: 5_000 }, error: null }));
    expect(await store.kidAddAttempt(PARENT)).toEqual({ ok: false, retryAfterMs: 5_000 });
    expect(calls.rpc).toEqual([{ fn: "family_kid_add_attempt", args: { p_parent: PARENT, p_limit: KID_ADDS.limit, p_window_ms: KID_ADDS.windowMs } }]);
    expect(await fakeSvc(async () => ({ data: { allowed: true, remaining: 5 }, error: null })).store.kidAddAttempt(PARENT)).toEqual({ ok: true, retryAfterMs: 0 });
    await expect(fakeSvc(async () => ({ data: null, error: { message: "down" } })).store.kidAddAttempt(PARENT)).rejects.toThrow(/kid budget not read/);
  });
});

describe("a kid's images", () => {
  it("removeKidAssets removes the images and keeps the account; deleteKid does both", async () => {
    const { store, calls } = fakeSvc(async () => ({ data: null, error: null }), [`${KID}/a.png`, `${KID}/b.png`]);
    expect(await store.removeKidAssets(KID)).toEqual({ assetsRemoved: 2, assetsError: null });
    expect(calls.removed).toEqual([[`${KID}/a.png`, `${KID}/b.png`]]);
    expect(calls.deletedUsers).toEqual([]);
    expect(await store.deleteKid(KID)).toEqual({ assetsRemoved: 2, assetsError: null });
    expect(calls.deletedUsers).toEqual([KID]);
  });
});
