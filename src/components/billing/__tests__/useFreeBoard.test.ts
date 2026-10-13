/**
 * The free board on the home and the board page (`useFreeBoard`), run as the pages run it: the
 * home's banner data and its redirects, the hold on new boards, the board's gate (the free board
 * open, any other locked), the moment of the win (the 5th problem published on the board's
 * learning bus, or a call refused for ink), and `free_board_done` recorded once.
 *
 * No DOM here: React's useState / useEffect / useMemo are replaced by a small hook runner that
 * renders, runs the effects whose deps changed, lets the reads resolve and renders again until the
 * hook settles. The session, the plan, the ink, is_admin(), the router, Supabase and the funnel's
 * recorder are fakes; the learning bus and the rule are the real ones.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const runner = vi.hoisted(() => {
  type Effect = { i: number; fn: () => void | (() => void); deps?: unknown[] };
  const s = {
    slots: [] as unknown[],
    cursor: 0,
    pending: [] as Effect[],
    effectDeps: new Map<number, unknown[] | undefined>(),
    cleanups: new Map<number, () => void>(),
    dirty: false,
  };
  const same = (a?: unknown[], b?: unknown[]) => !!a && !!b && a.length === b.length && a.every((v, k) => Object.is(v, b[k]));
  function useState<T>(init: T | (() => T)) {
    const i = s.cursor++;
    if (!(i in s.slots)) s.slots[i] = typeof init === "function" ? (init as () => T)() : init;
    const set = (next: T | ((prev: T) => T)) => {
      const prev = s.slots[i] as T;
      const value = typeof next === "function" ? (next as (p: T) => T)(prev) : next;
      if (!Object.is(value, prev)) {
        s.slots[i] = value;
        s.dirty = true;
      }
    };
    return [s.slots[i] as T, set] as const;
  }
  function useMemo<T>(fn: () => T, deps: unknown[]): T {
    const i = s.cursor++;
    const prev = s.slots[i] as { deps: unknown[]; value: T } | undefined;
    if (prev && same(prev.deps, deps)) return prev.value;
    const value = fn();
    s.slots[i] = { deps, value };
    return value;
  }
  function useEffect(fn: () => void | (() => void), deps?: unknown[]) {
    s.pending.push({ i: s.cursor++, fn, deps });
  }
  function reset() {
    for (const c of s.cleanups.values()) c();
    s.slots = [];
    s.cursor = 0;
    s.pending = [];
    s.effectDeps.clear();
    s.cleanups.clear();
    s.dirty = false;
  }
  /** Renders `hook` until it settles (state set in render or effects, reads resolved). */
  async function render<T>(hook: () => T): Promise<T> {
    let out!: T;
    for (let round = 0; round < 50; round++) {
      let renders = 0;
      do {
        s.dirty = false;
        s.cursor = 0;
        s.pending = [];
        out = hook();
        if (++renders > 20) throw new Error("render loop");
      } while (s.dirty);
      for (const e of s.pending) {
        if (s.effectDeps.has(e.i) && same(s.effectDeps.get(e.i), e.deps)) continue;
        s.cleanups.get(e.i)?.();
        s.cleanups.delete(e.i);
        s.effectDeps.set(e.i, e.deps);
        const cleanup = e.fn();
        if (typeof cleanup === "function") s.cleanups.set(e.i, cleanup);
      }
      // the reads resolve
      await new Promise((r) => setTimeout(r, 0));
      if (!s.dirty) return out;
    }
    throw new Error("did not settle");
  }
  return { useState, useMemo, useEffect, reset, render };
});

const world = vi.hoisted(() => ({
  status: "none" as string,
  known: true,
  balance: 80 as number | null,
  admin: false,
  oldest: [] as { id: string; created_at: string }[],
  oldestError: false,
  attempts: {} as Record<string, { id: string; problem_latex: string | null; outcome: string; origin: string }[]>,
  attemptsError: false,
  reads: [] as string[],
}));
const router = vi.hoisted(() => ({ replace: vi.fn(), push: vi.fn() }));
const record = vi.hoisted(() => vi.fn(async () => undefined));

vi.mock("react", async (importOriginal) => ({
  ...(await importOriginal<typeof import("react")>()),
  useState: runner.useState,
  useEffect: runner.useEffect,
  useMemo: runner.useMemo,
}));
vi.mock("next/navigation", () => ({ useRouter: () => router }));
vi.mock("@/components/AuthProvider", () => ({ useAuth: () => ({ user: { id: "u-kid", email: "kid@example.com" }, session: null, loading: false, authError: null }) }));
vi.mock("@/components/admin/useIsAdmin", () => ({ checkIsAdmin: async () => world.admin }));
vi.mock("@/lib/billing/useUnlimited", () => ({
  useUnlimited: () => ({ state: { status: world.status, trialEnd: null, currentPeriodEnd: null, cancelAtPeriodEnd: false, checkoutRef: null }, loading: false, known: world.known, refresh: () => undefined }),
}));
vi.mock("@/lib/billing/useInkSummary", () => ({ useInkSummary: () => ({ summary: world.balance === null ? null : { balance: world.balance }, loading: false, error: null, reload: () => undefined }) }));
vi.mock("@/lib/funnel/record", () => ({ recordFunnelStep: record }));
vi.mock("@/lib/logger", () => ({ clientMetric: () => undefined }));
vi.mock("@/lib/supabase", () => {
  /** A PostgREST query as far as the hook builds it, answered from `world`. */
  function query(table: string) {
    const q = { table, boardId: null as string | null };
    const builder = {
      select: () => builder,
      order: () => builder,
      limit: () => builder,
      in: () => builder,
      eq: (_col: string, value: string) => {
        q.boardId = value;
        return builder;
      },
      then(resolve: (v: { data: unknown; error: unknown }) => void) {
        world.reads.push(q.boardId ? `${table}:${q.boardId}` : table);
        if (table === "whiteboards") resolve(world.oldestError ? { data: null, error: { message: "down" } } : { data: world.oldest.slice(0, 1), error: null });
        else resolve(world.attemptsError ? { data: null, error: { message: "down" } } : { data: world.attempts[q.boardId ?? ""] ?? [], error: null });
      },
    };
    return builder;
  }
  return { supabase: { from: query } };
});

const { useFreeBoard, noteFreeBoardEnded } = await import("../useFreeBoard");
const { mayMakeBoard } = await import("@/lib/billing/newBoards");
const { learningBus } = await import("@/lib/learning/bus");
const { freeBoardEndKey } = await import("@/lib/billing/freeBoard");
const { PLAN_PATH } = await import("@/lib/onboarding/planMarker");

const FREE = { id: "b-free", created_at: "2026-10-13T09:00:00Z" };
const SECOND = { id: "b-second", created_at: "2026-10-13T10:00:00Z" };

const done = (n: number, boardId = FREE.id) => Array.from({ length: n }, (_, i) => ({ id: `${boardId}-a${i}`, problem_latex: `${i}+${i}`, outcome: "first_try", origin: "student" }));

function memoryStorage() {
  const m = new Map<string, string>();
  return { map: m, getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), removeItem: (k: string) => void m.delete(k), key: () => null, length: 0, clear: () => m.clear() };
}
let local = memoryStorage();

beforeEach(() => {
  runner.reset();
  Object.assign(world, { status: "none", known: true, balance: 80, admin: false, oldest: [FREE, SECOND], oldestError: false, attempts: {}, attemptsError: false, reads: [] });
  router.replace.mockClear();
  router.push.mockClear();
  record.mockClear();
  learningBus.reset();
  local = memoryStorage();
  vi.stubGlobal("window", { localStorage: local, sessionStorage: memoryStorage(), location: { search: "" } });
  vi.stubEnv("NEXT_PUBLIC_UNLIMITED_LINK", "https://buy.stripe.com/test_link");
});
afterEach(() => {
  runner.reset();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

const homeWith = (boards: { id: string; created_at: string }[] | undefined) => () => useFreeBoard({ page: "home", boards });
const home = () => homeWith([SECOND, FREE]);
const boardAt = (id: string, extra: { inkRefused?: boolean; enabled?: boolean } = {}) => () => useFreeBoard({ page: "board", boardId: id, ...extra });
const flushImports = () => new Promise((r) => setTimeout(r, 5));

describe("the home on the free board", () => {
  it("stays (no redirect) and shows the free board's progress, read from its finished attempts", async () => {
    world.attempts[FREE.id] = done(2);
    const view = await runner.render(home());
    expect(view).toMatchObject({ gate: "free", freeBoardId: FREE.id, done: 2, goal: 5, ended: null, doneUnknown: false });
    expect(router.replace).not.toHaveBeenCalled();
    // the home has its list: no board read, one read of the free board's attempts
    expect(world.reads).toEqual([`learning_attempts:${FREE.id}`]);
  });

  it("sends a new board (New Board, a topic, Today's practice) to the plan screen instead", async () => {
    await runner.render(home());
    expect(mayMakeBoard()).toBe(false);
    expect(router.push).toHaveBeenCalledWith(PLAN_PATH);
  });

  it("goes to the plan screen once the free board's 5 problems are done, and records it once", async () => {
    world.attempts[FREE.id] = done(5);
    const view = await runner.render(home());
    expect(view).toMatchObject({ gate: "locked", ended: "problems" });
    expect(router.replace).toHaveBeenCalledWith(PLAN_PATH);
    await flushImports();
    expect(record).toHaveBeenCalledTimes(1);
    expect(record).toHaveBeenCalledWith("free_board_done", { reason: "problems" });
    expect(local.map.get(freeBoardEndKey("u-kid"))).toBe("problems");
    // a new board is not held by a page that is leaving
    expect(mayMakeBoard()).toBe(true);
  });

  it("goes to the plan screen when the starter ink is gone", async () => {
    world.attempts[FREE.id] = done(1);
    world.balance = 0;
    const view = await runner.render(home());
    expect(view).toMatchObject({ gate: "locked", ended: "ink" });
    expect(router.replace).toHaveBeenCalledWith(PLAN_PATH);
    await flushImports();
    expect(record).toHaveBeenCalledWith("free_board_done", { reason: "ink" });
  });

  it("goes to the plan screen at once when this device saw the free board end", async () => {
    local.setItem(freeBoardEndKey("u-kid"), "problems");
    const view = await runner.render(home());
    expect(view.gate).toBe("locked");
    expect(router.replace).toHaveBeenCalledWith(PLAN_PATH);
    await flushImports();
    // already recorded on the device that saw it
    expect(record).not.toHaveBeenCalled();
  });

  it("holds nobody while the boards are loading, or when the attempts could not be read", async () => {
    const loading = await runner.render(homeWith(undefined));
    expect(loading.gate).toBe("checking");
    expect(router.replace).not.toHaveBeenCalled();
    expect(mayMakeBoard()).toBe(true);
    runner.reset();
    world.attemptsError = true;
    const failed = await runner.render(home());
    expect(failed).toMatchObject({ gate: "free", done: 0, doneUnknown: true });
    expect(router.replace).not.toHaveBeenCalled();
  });

  it("with no board yet lets the first be made: it will be the free board", async () => {
    const view = await runner.render(homeWith([]));
    expect(view).toMatchObject({ gate: "free", freeBoardId: null });
    expect(mayMakeBoard()).toBe(true);
    expect(world.reads).toEqual([]);
  });

  it("leaves a subscriber, an admin and a deployment without checkout alone, and reads nothing for them", async () => {
    world.status = "trialing";
    world.attempts[FREE.id] = done(9);
    expect((await runner.render(home())).gate).toBe("open");
    expect(world.reads).toEqual([]);
    runner.reset();
    world.status = "none";
    world.admin = true;
    expect((await runner.render(home())).gate).toBe("open");
    runner.reset();
    world.admin = false;
    vi.stubEnv("NEXT_PUBLIC_UNLIMITED_LINK", "");
    expect((await runner.render(home())).gate).toBe("open");
    expect(router.replace).not.toHaveBeenCalled();
    expect(mayMakeBoard()).toBe(true);
  });

  it("follows the boards: the free board deleted, the next oldest is the free board", async () => {
    world.attempts[FREE.id] = done(4);
    world.attempts[SECOND.id] = done(1, SECOND.id);
    expect(await runner.render(homeWith([FREE, SECOND]))).toMatchObject({ freeBoardId: FREE.id, done: 4 });
    expect(await runner.render(homeWith([SECOND]))).toMatchObject({ gate: "free", freeBoardId: SECOND.id, done: 1 });
  });
});

describe("the board page", () => {
  it("opens the free board, reading which board it is and its problems", async () => {
    world.attempts[FREE.id] = done(3);
    const view = await runner.render(boardAt(FREE.id));
    expect(view).toMatchObject({ gate: "free", freeBoardId: FREE.id, done: 3, usedUp: false });
    expect(world.reads).toEqual(["whiteboards", `learning_attempts:${FREE.id}`]);
    expect(router.replace).not.toHaveBeenCalled();
  });

  it("sends any other board to the plan screen", async () => {
    const view = await runner.render(boardAt(SECOND.id));
    expect(view.gate).toBe("locked");
    expect(router.replace).toHaveBeenCalledWith(PLAN_PATH);
    // its problems are not the free board's: not read
    expect(world.reads).toEqual(["whiteboards"]);
  });

  it("sends the free board to the plan screen when it arrives used up", async () => {
    world.attempts[FREE.id] = done(5);
    const view = await runner.render(boardAt(FREE.id));
    expect(view).toMatchObject({ gate: "locked", ended: "problems", usedUp: false });
    expect(router.replace).toHaveBeenCalledWith(PLAN_PATH);
  });

  it("the 5th problem finished on the board: the moment (usedUp), no redirect, recorded once", async () => {
    world.attempts[FREE.id] = done(4);
    const hook = boardAt(FREE.id);
    expect(await runner.render(hook)).toMatchObject({ gate: "free", done: 4, usedUp: false });
    // the tracker publishes the attempt as it goes: in progress, then solved
    const attempt = { id: "live-1", boardId: FREE.id, problemLatex: "3x=12", origin: "student", outcome: "in_progress" } as const;
    learningBus.publishAttempt({ ...attempt } as never);
    expect(await runner.render(hook)).toMatchObject({ gate: "free", done: 4, usedUp: false });
    learningBus.publishAttempt({ ...attempt, outcome: "self_corrected" } as never);
    const view = await runner.render(hook);
    expect(view).toMatchObject({ gate: "free", done: 5, ended: "problems", usedUp: true });
    expect(router.replace).not.toHaveBeenCalled();
    await flushImports();
    expect(record).toHaveBeenCalledTimes(1);
    expect(record).toHaveBeenCalledWith("free_board_done", { reason: "problems" });
    // the same attempt again (saved, re-published) changes nothing
    learningBus.publishAttempt({ ...attempt, outcome: "with_help" } as never);
    expect(await runner.render(hook)).toMatchObject({ done: 5, usedUp: true });
    await flushImports();
    expect(record).toHaveBeenCalledTimes(1);
  });

  it("an attempt on another board, or the chat's worked example, is not the free board's problem", async () => {
    world.attempts[FREE.id] = done(4);
    const hook = boardAt(FREE.id);
    await runner.render(hook);
    learningBus.publishAttempt({ id: "x1", boardId: SECOND.id, problemLatex: "1+1", origin: "student", outcome: "first_try" } as never);
    learningBus.publishAttempt({ id: "x2", boardId: FREE.id, problemLatex: "2+2", origin: "teach", outcome: "tutor_solved" } as never);
    expect(await runner.render(hook)).toMatchObject({ done: 4, usedUp: false });
  });

  it("a call refused for ink on the free board: the moment, with the ink's words", async () => {
    world.attempts[FREE.id] = done(1);
    expect((await runner.render(boardAt(FREE.id))).usedUp).toBe(false);
    const view = await runner.render(boardAt(FREE.id, { inkRefused: true }));
    expect(view).toMatchObject({ gate: "free", ended: "ink", usedUp: true });
    // the refusal clears (a retry), the moment stays for the visit
    expect(await runner.render(boardAt(FREE.id, { inkRefused: false }))).toMatchObject({ ended: "ink", usedUp: true });
    expect(router.replace).not.toHaveBeenCalled();
  });

  it("keeps the guided board's exemption (the old welcome's tour): open, nothing read", async () => {
    world.attempts[FREE.id] = done(9);
    world.balance = 0;
    const view = await runner.render(boardAt(FREE.id, { enabled: false }));
    expect(view.gate).toBe("open");
    expect(world.reads).toEqual([]);
    expect(router.replace).not.toHaveBeenCalled();
  });

  it("holds nobody when the board read fails", async () => {
    world.oldestError = true;
    const view = await runner.render(boardAt(SECOND.id));
    expect(view.gate).toBe("checking");
    expect(router.replace).not.toHaveBeenCalled();
  });
});

describe("free_board_done", () => {
  it("is recorded once per account on a device, with its reason", async () => {
    const storage = memoryStorage();
    expect(noteFreeBoardEnded("u-1", "ink", storage)).toBe(true);
    expect(noteFreeBoardEnded("u-1", "problems", storage)).toBe(false);
    expect(noteFreeBoardEnded("u-2", "problems", storage)).toBe(true);
    await vi.waitFor(() => expect(record).toHaveBeenCalledTimes(2));
    expect(record.mock.calls).toEqual([
      ["free_board_done", { reason: "ink" }],
      ["free_board_done", { reason: "problems" }],
    ]);
  });
});
