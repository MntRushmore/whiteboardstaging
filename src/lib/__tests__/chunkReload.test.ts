/**
 * A chunk of an older release after a deploy (src/lib/chunkReload.ts): the error boundaries reload
 * the page once instead of showing a crash, report it at info (`live.app`, `chunk_reload`), and
 * never reload the same page twice within a minute.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const sent = vi.hoisted(() => ({ reports: [] as unknown[], resolve: null as null | (() => void) }));
vi.mock("@/lib/reportAppError", () => ({
  reportUserErrorBeforeLeaving: (input: unknown) => {
    sent.reports.push(input);
    return new Promise<void>((resolve) => (sent.resolve = resolve));
  },
}));

import {
  CHUNK_RELOAD_REPORT,
  CHUNK_RELOAD_REPORT_WAIT_MS,
  CHUNK_RELOAD_WINDOW_MS,
  chunkReloadDue,
  claimChunkReload,
  isChunkLoadError,
  reloadForNewRelease,
  type ReloadMemory,
} from "../chunkReload";

function memory(): ReloadMemory & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return { data, getItem: (k) => data.get(k) ?? null, setItem: (k, v) => void data.set(k, String(v)) };
}

function chunkError(message = "Failed to load chunk /_next/static/chunks/0a1b2c3d4e5f.js from module 12345"): Error {
  const e = new Error(message);
  e.name = "ChunkLoadError";
  return e;
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
  sent.reports.length = 0;
  sent.resolve = null;
});

describe("isChunkLoadError", () => {
  it.each([
    ["Turbopack", chunkError()],
    ["webpack", Object.assign(new Error("Loading chunk 812 failed.\n(error: https://www.agathon.app/_next/static/chunks/812.js)"), { name: "ChunkLoadError" })],
    ["webpack, by name only", Object.assign(new Error("something"), { name: "ChunkLoadError" })],
    ["Chrome", new TypeError("Failed to fetch dynamically imported module: https://www.agathon.app/_next/static/chunks/a.js")],
    ["Safari", new TypeError("Importing a module script failed.")],
    ["Firefox", new TypeError("error loading dynamically imported module: https://www.agathon.app/_next/static/chunks/a.js")],
    ["a plain object", { name: "ChunkLoadError", message: "Failed to load chunk x.js" }],
    ["a string", "Loading chunk 3 failed."],
  ])("%s", (_label, error) => {
    expect(isChunkLoadError(error)).toBe(true);
  });

  it("anything else is not", () => {
    for (const error of [new TypeError("Failed to fetch"), new Error("x is undefined"), null, undefined, 42, {}, "boom"]) {
      expect(isChunkLoadError(error)).toBe(false);
    }
  });
});

describe("claimChunkReload", () => {
  it("once per page per window: the claim is remembered with its time", () => {
    const store = memory();
    expect(claimChunkReload("/login", store, 1_000_000)).toBe(true);
    expect([...store.data.values()]).toEqual(["1000000"]);
    // reloaded, and the chunk is still missing: show the error, do not loop
    expect(claimChunkReload("/login", store, 1_000_000 + 5_000)).toBe(false);
    expect(claimChunkReload("/login", store, 1_000_000 + CHUNK_RELOAD_WINDOW_MS - 1)).toBe(false);
    // another page is its own
    expect(claimChunkReload("/", store, 1_000_000 + 5_000)).toBe(true);
    // a minute on, a new deploy: reload again
    expect(claimChunkReload("/login", store, 1_000_000 + CHUNK_RELOAD_WINDOW_MS)).toBe(true);
  });

  it("a clock set back counts as recent", () => {
    const store = memory();
    expect(claimChunkReload("/login", store, 1_000_000)).toBe(true);
    expect(claimChunkReload("/login", store, 1_000_000 - 5_000)).toBe(false);
  });

  it("never without storage that remembers: it could loop", () => {
    expect(claimChunkReload("/login", null, 1)).toBe(false);
    const throwing: ReloadMemory = {
      getItem: () => null,
      setItem: () => {
        throw new Error("QuotaExceededError");
      },
    };
    expect(claimChunkReload("/login", throwing, 1)).toBe(false);
    const forgetful: ReloadMemory = { getItem: () => null, setItem: () => {} };
    expect(claimChunkReload("/login", forgetful, 1)).toBe(false);
  });
});

describe("chunkReloadDue (an error boundary's render)", () => {
  let store: ReturnType<typeof memory>;
  beforeEach(() => {
    store = memory();
    vi.stubGlobal("window", { sessionStorage: store });
    vi.stubGlobal("location", { pathname: "/login" });
  });

  it("a stale chunk: due, the same answer on every render of the same error", () => {
    const error = chunkError();
    expect(chunkReloadDue(error)).toBe(true);
    expect(chunkReloadDue(error)).toBe(true);
    expect(store.data.size).toBe(1);
    // after the reload, the page is new; the same chunk failing again within the minute shows the error
    expect(chunkReloadDue(chunkError())).toBe(false);
  });

  it("any other error: never", () => {
    expect(chunkReloadDue(new TypeError("x is undefined"))).toBe(false);
    expect(store.data.size).toBe(0);
  });

  it("on the server: never", () => {
    vi.stubGlobal("window", undefined);
    expect(chunkReloadDue(chunkError())).toBe(false);
  });
});

describe("reloadForNewRelease", () => {
  it("reports at info first, then reloads, once", async () => {
    const reload = vi.fn();
    vi.stubGlobal("location", { reload });
    reloadForNewRelease();
    expect(sent.reports).toEqual([{ kind: "live.app", code: "chunk_reload", message: CHUNK_RELOAD_REPORT.message, level: "info" }]);
    expect(reload).not.toHaveBeenCalled();
    sent.resolve?.();
    await vi.waitFor(() => expect(reload).toHaveBeenCalledTimes(1));
  });

  it("reloads after a second when the report cannot go", async () => {
    vi.useFakeTimers();
    const reload = vi.fn();
    vi.stubGlobal("location", { reload });
    reloadForNewRelease();
    await vi.advanceTimersByTimeAsync(CHUNK_RELOAD_REPORT_WAIT_MS - 1);
    expect(reload).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(reload).toHaveBeenCalledTimes(1);
    sent.resolve?.();
    await vi.advanceTimersByTimeAsync(10);
    expect(reload).toHaveBeenCalledTimes(1);
  });
});
