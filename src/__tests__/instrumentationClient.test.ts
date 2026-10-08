/**
 * The window's error listeners (src/instrumentation-client.ts): an uncaught error or rejection is
 * a crash report, except a chunk of an older release that an `import()` could not fetch, which is
 * a warning (`live.app`, `chunk_failed`; src/lib/chunkReload.ts).
 */
import { beforeAll, describe, expect, it, vi } from "vitest";

const calls = vi.hoisted(() => ({ crashes: [] as unknown[][], userErrors: [] as unknown[], listeners: new Map<string, (e: unknown) => void>() }));
vi.mock("@/lib/reportAppError", () => ({
  reportAppError: (...args: unknown[]) => calls.crashes.push(args),
  reportUserError: (input: unknown) => calls.userErrors.push(input),
  reportUserErrorBeforeLeaving: async () => {},
  preloadErrorReporter: () => {},
}));

beforeAll(async () => {
  vi.stubGlobal("addEventListener", (type: string, listener: (e: unknown) => void) => calls.listeners.set(type, listener));
  await import("@/instrumentation-client");
  vi.unstubAllGlobals();
});

describe("instrumentation-client", () => {
  it("an uncaught error or rejection is a crash report", () => {
    const error = new TypeError("x is undefined");
    calls.listeners.get("error")?.({ error, message: error.message });
    calls.listeners.get("unhandledrejection")?.({ reason: error });
    expect(calls.crashes).toEqual([
      ["error", error],
      ["rejection", error],
    ]);
  });

  it("a stale chunk an import() could not fetch is a warning, not a crash", () => {
    calls.crashes.length = 0;
    const stale = Object.assign(new Error("Failed to load chunk /_next/static/chunks/0a1b2c.js from module 123"), { name: "ChunkLoadError" });
    calls.listeners.get("unhandledrejection")?.({ reason: stale });
    calls.listeners.get("unhandledrejection")?.({ reason: new TypeError("Importing a module script failed.") });
    expect(calls.crashes).toEqual([]);
    expect(calls.userErrors).toEqual([
      expect.objectContaining({ kind: "live.app", code: "chunk_failed", level: "warn" }),
      expect.objectContaining({ kind: "live.app", code: "chunk_failed", level: "warn" }),
    ]);
  });

  it("an error event without an error object keeps its message and where it came from", () => {
    calls.crashes.length = 0;
    calls.listeners.get("error")?.({ error: null, message: "Script error.", filename: "", lineno: 0, colno: 0 });
    calls.listeners.get("error")?.({ error: null, message: "boom", filename: "https://app.test/a.js", lineno: 1, colno: 2 });
    expect(calls.crashes).toEqual([
      ["error", { message: "Script error.", stack: undefined }],
      ["error", { message: "boom", stack: "at https://app.test/a.js:1:2" }],
    ]);
  });
});
