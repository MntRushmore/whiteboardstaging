import { describe, expect, it } from "vitest";
import {
  CLOCK_SKEW_MESSAGE,
  NETWORK_MESSAGE,
  describeError,
  isClockSkewError,
  isNetworkError,
  messageOf,
} from "../errorMessage";

describe("errorMessage", () => {
  it("reads messages from Error, plain objects (PostgrestError) and strings", () => {
    expect(messageOf(new Error("boom"))).toBe("boom");
    expect(messageOf({ message: "row level security", code: "42501" })).toBe("row level security");
    expect(messageOf("plain")).toBe("plain");
    expect(messageOf(null)).toBe("");
    expect(messageOf(42)).toBe("");
  });

  it("recognises the 'JWT issued at future' clock-skew rejection", () => {
    expect(isClockSkewError({ message: "JWT issued at future", code: "PGRST301" })).toBe(true);
    expect(isClockSkewError(new Error("token issued in the future"))).toBe(true);
    expect(isClockSkewError(new Error("permission denied"))).toBe(false);
    expect(describeError({ message: "JWT issued at future" }, "fallback")).toBe(CLOCK_SKEW_MESSAGE);
  });

  it("recognises network failures from fetch and supabase auth", () => {
    expect(isNetworkError(new TypeError("Failed to fetch"))).toBe(true);
    expect(isNetworkError(new TypeError("Load failed"))).toBe(true);
    expect(isNetworkError({ name: "AuthRetryableFetchError", message: "x", status: 0 })).toBe(true);
    expect(isNetworkError(new Error("NetworkError when attempting to fetch resource."))).toBe(true);
    expect(isNetworkError(new Error("duplicate key"))).toBe(false);
    expect(describeError(new TypeError("Failed to fetch"), "fallback")).toBe(NETWORK_MESSAGE);
  });

  it("recognises supabase-js's failed fetch: a plain object, no code, the fetch error's name in its words", () => {
    // what postgrest-js returns when fetch rejects (PostgrestBuilder: `${name}: ${message}`, code "")
    for (const message of ["TypeError: Load failed", "TypeError: Failed to fetch", "TypeError: NetworkError when attempting to fetch resource.", "FetchError: fetch failed"]) {
      const error = { message, details: `${message}\n    at fetch`, hint: "", code: "" };
      expect(isNetworkError(error), message).toBe(true);
      expect(describeError(error, "fallback")).toBe(NETWORK_MESSAGE);
    }
    expect(isNetworkError({ message: "TypeError: x is undefined", code: "" })).toBe(false);
    expect(isNetworkError({ message: "JWT expired", code: "PGRST301" })).toBe(false);
  });

  it("falls back to the error's own message, then the caller fallback", () => {
    expect(describeError(new Error("Permission denied for table whiteboards"), "fb")).toBe(
      "Permission denied for table whiteboards",
    );
    expect(describeError(new Error("   "), "fb")).toBe("fb");
    expect(describeError(undefined, "fb")).toBe("fb");
  });
});
