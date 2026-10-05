/**
 * The first-load front door of client error reporting (src/lib/reportAppError.ts): it forwards to
 * the lazily loaded reporter, preloads it after a delay, and never throws or rejects.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

const reported = vi.hoisted(() => [] as unknown[][]);
const userReported = vi.hoisted(() => [] as unknown[]);
vi.mock("@/lib/clientErrors", () => ({
  reportClientError: (...args: unknown[]) => reported.push(args),
  reportUserError: (input: unknown) => userReported.push(input),
}));

import { preloadErrorReporter, reportAppError, reportUserError } from "../reportAppError";

afterEach(() => {
  reported.length = 0;
  userReported.length = 0;
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

describe("reportUserError", () => {
  it("forwards an error a student saw to the lazily loaded reporter, as it is", async () => {
    const input = { kind: "live.chat", code: "timeout", message: "The tutor took too long to answer. Try again." } as const;
    expect(reportUserError(input)).toBeUndefined();
    await vi.waitFor(() => expect(userReported).toEqual([input]));
    expect(reported).toEqual([]);
  });
});
