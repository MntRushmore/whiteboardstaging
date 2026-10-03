/**
 * The first-load front door of client error reporting (src/lib/reportAppError.ts): it forwards to
 * the lazily loaded reporter, preloads it after a delay, and never throws or rejects.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

const reported = vi.hoisted(() => [] as unknown[][]);
vi.mock("@/lib/clientErrors", () => ({
  reportClientError: (...args: unknown[]) => reported.push(args),
}));

import { preloadErrorReporter, reportAppError } from "../reportAppError";

afterEach(() => {
  reported.length = 0;
  vi.useRealTimers();
});

describe("reportAppError", () => {
  it("forwards source, error and digest to the reporter once it has loaded", async () => {
    const error = new Error("boom");
    expect(reportAppError("boundary", error, "123")).toBeUndefined();
    await vi.waitFor(() => expect(reported).toEqual([["boundary", error, "123"]]));
  });

  it("preloads the reporter after the delay without throwing", async () => {
    vi.useFakeTimers();
    expect(() => preloadErrorReporter(50)).not.toThrow();
    await vi.advanceTimersByTimeAsync(60);
    expect(reported).toEqual([]);
  });
});
