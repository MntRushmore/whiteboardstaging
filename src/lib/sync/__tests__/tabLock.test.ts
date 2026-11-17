/**
 * Which tabs are still open (src/lib/sync/tabLock.ts, Web Locks): a board opening elsewhere replays
 * only the backups of tabs whose lock is gone, so "can't tell" must be null (replay nothing on a
 * guess), never an empty set (which would replay a live tab's work under it).
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { holdTabLock, openTabIds } from "@/lib/sync/tabLock";

type Held = Array<{ name?: string }>;

/** A small Web Locks stand-in: a lock is held until its callback's promise settles. */
function fakeLocks() {
  const held = new Map<string, number>();
  const api = {
    request: vi.fn((name: string, cb: () => Promise<void>) => {
      held.set(name, (held.get(name) ?? 0) + 1);
      return cb().finally(() => {
        const n = (held.get(name) ?? 1) - 1;
        if (n === 0) held.delete(name);
        else held.set(name, n);
      });
    }),
    query: vi.fn(async (): Promise<{ held?: Held }> => ({ held: [...held.keys()].map((name) => ({ name })) })),
  };
  return { api, held };
}

function withNavigator(nav: unknown) {
  vi.stubGlobal("navigator", nav);
}

afterEach(() => vi.unstubAllGlobals());

describe("holdTabLock / openTabIds", () => {
  it("a held tab is open until released; then it is not", async () => {
    const { api } = fakeLocks();
    withNavigator({ locks: api });
    const release = holdTabLock("tab-1");
    expect(await openTabIds()).toEqual(new Set(["tab-1"]));
    release();
    await Promise.resolve();
    await Promise.resolve();
    expect(await openTabIds()).toEqual(new Set());
  });

  it("only this app's tab locks count; other locks, nameless ones and the bare prefix are left alone", async () => {
    withNavigator({
      locks: {
        request: vi.fn(),
        query: async () => ({ held: [{ name: "agathon.tab.a" }, { name: "other-lib" }, {}, { name: "agathon.tab." }, { name: "xagathon.tab.b" }, { name: "agathon.tab.ünï-😀" }] }),
      },
    });
    expect(await openTabIds()).toEqual(new Set(["a", "", "ünï-😀"]));
  });

  it("many tabs, and the same tab opened twice, release independently", async () => {
    const { api } = fakeLocks();
    withNavigator({ locks: api });
    const releases = Array.from({ length: 50 }, (_, i) => holdTabLock(`t${i % 25}`));
    expect((await openTabIds())?.size).toBe(25);
    releases.slice(0, 25).forEach((r) => r());
    await new Promise((r) => setTimeout(r, 0));
    // each id is still held once by its second holder
    expect((await openTabIds())?.size).toBe(25);
    releases.slice(25).forEach((r) => r());
    await new Promise((r) => setTimeout(r, 0));
    expect(await openTabIds()).toEqual(new Set());
  });

  it("releasing twice is harmless", async () => {
    const { api } = fakeLocks();
    withNavigator({ locks: api });
    const release = holdTabLock("x");
    release();
    expect(() => release()).not.toThrow();
  });

  it.each([
    ["no navigator", undefined],
    ["no Web Locks (older Safari)", {}],
  ])("%s: holding is a no-op and openness is unknown (null), not 'none open'", async (_name, nav) => {
    withNavigator(nav);
    const release = holdTabLock("t");
    expect(() => release()).not.toThrow();
    expect(await openTabIds()).toBeNull();
  });

  it("a query that throws, rejects or answers without `held` is unknown (null), never an empty set", async () => {
    withNavigator({ locks: { request: vi.fn(), query: () => Promise.reject(new DOMException("denied", "SecurityError")) } });
    expect(await openTabIds()).toBeNull();
    withNavigator({
      locks: {
        request: vi.fn(),
        query: () => {
          throw new Error("sync throw");
        },
      },
    });
    expect(await openTabIds()).toBeNull();
    withNavigator({ locks: { request: vi.fn(), query: async () => ({}) } });
    expect(await openTabIds()).toBeNull();
  });

  it("a lock request the browser refuses never surfaces as an unhandled rejection", async () => {
    const unhandled = vi.fn();
    process.on("unhandledRejection", unhandled);
    try {
      withNavigator({ locks: { request: () => Promise.reject(new DOMException("aborted", "AbortError")), query: async () => ({ held: [] }) } });
      const release = holdTabLock("t");
      await new Promise((r) => setTimeout(r, 0));
      release();
      expect(unhandled).not.toHaveBeenCalled();
    } finally {
      process.off("unhandledRejection", unhandled);
    }
  });
});
