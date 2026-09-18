import { describe, expect, it } from "vitest";
import { AUTH_UNREACHABLE_MESSAGE, classifyAuthLoadError } from "../authState";
import { CLOCK_SKEW_MESSAGE, NETWORK_MESSAGE } from "../errorMessage";

describe("classifyAuthLoadError", () => {
  it("treats an invalid refresh token / missing session as signed out", () => {
    expect(classifyAuthLoadError({ message: "Invalid Refresh Token: Refresh Token Not Found", status: 400 })).toEqual({
      kind: "signed-out",
    });
    expect(classifyAuthLoadError({ message: "Auth session missing!", status: 400 })).toEqual({ kind: "signed-out" });
    expect(classifyAuthLoadError({ message: "nope", status: 401 })).toEqual({ kind: "signed-out" });
  });

  it("treats network failures as a reachability error with a Retry-worthy message", () => {
    expect(classifyAuthLoadError(new TypeError("Failed to fetch"))).toEqual({
      kind: "error",
      message: NETWORK_MESSAGE,
    });
    expect(classifyAuthLoadError({ name: "AuthRetryableFetchError", message: "fetch failed", status: 0 })).toEqual({
      kind: "error",
      message: NETWORK_MESSAGE,
    });
  });

  it("surfaces clock skew, 5xx and 429 as errors, not sign-outs", () => {
    expect(classifyAuthLoadError({ message: "JWT issued at future", status: 401 }).kind).toBe("signed-out");
    // 401 with a skew message is still a stored-session problem the login page will explain;
    // a skew message without an auth status is a reachability-class error.
    expect(classifyAuthLoadError({ message: "JWT issued at future" })).toEqual({
      kind: "error",
      message: CLOCK_SKEW_MESSAGE,
    });
    expect(classifyAuthLoadError({ message: "Service unavailable", status: 503 })).toEqual({
      kind: "error",
      message: "Service unavailable",
    });
    expect(classifyAuthLoadError({ message: "Too many requests", status: 429 }).kind).toBe("error");
    expect(classifyAuthLoadError(undefined)).toEqual({ kind: "error", message: AUTH_UNREACHABLE_MESSAGE });
  });
});
