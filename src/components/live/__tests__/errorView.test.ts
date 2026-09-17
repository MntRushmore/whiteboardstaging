import { describe, expect, it } from "vitest";
import { ApiError } from "@/lib/api-client";
import type { LiveError } from "@/lib/live/liveStore";
import { LIVE_COPY, pillLabelFor } from "../copy";
import {
  RATE_LIMIT_FALLBACK_MS,
  classifyLiveFailure,
  liveErrorView,
  secondsLeftFor,
  showsHintCard,
  sseFailure,
} from "../errorView";

/** Pure mappings behind the Live error pill and hint card. */

const ONLINE = { kind: "recognize" as const, lineId: "L1", online: true };

function err(partial: Partial<LiveError> = {}): LiveError {
  return { id: "e1", kind: "recognize", code: "upstream", message: "The tutor service had a hiccup", at: 10_000, ...partial };
}

describe("classifyLiveFailure", () => {
  it("maps the API error contract to codes and calm copy", () => {
    expect(classifyLiveFailure(new ApiError("You need to be signed in.", 401, "unauthorized"), ONLINE)).toMatchObject({
      kind: "recognize",
      lineId: "L1",
      code: "unauthorized",
      message: "Please sign in again",
    });
    expect(classifyLiveFailure(new ApiError("Request failed (500)", 500), ONLINE)).toMatchObject({ code: "upstream", message: "The tutor service had a hiccup" });
    expect(classifyLiveFailure(new ApiError("bad gateway", 502, "upstream_error"), ONLINE)).toMatchObject({ code: "upstream" });
    expect(classifyLiveFailure(new ApiError("mathpix down", 400, "recognizer_failed"), ONLINE)).toMatchObject({ code: "upstream" });
    expect(classifyLiveFailure(new ApiError("invalid", 400, "invalid_request"), ONLINE)).toMatchObject({ code: "unknown", message: "Something went sideways" });
  });

  it("429: retryAfterMs from the error (or its details), else the fallback; message counts whole seconds", () => {
    const withField = new ApiError("Too many", 429, "rate_limited") as ApiError & { retryAfterMs?: number };
    withField.retryAfterMs = 1500;
    expect(classifyLiveFailure(withField, ONLINE)).toMatchObject({ code: "rate_limited", retryAfterMs: 1500, message: "Slowing down — try again in 2 s" });
    const inDetails = new ApiError("Too many", 429, "rate_limited", { retryAfterMs: 4000 });
    expect(classifyLiveFailure(inDetails, ONLINE)).toMatchObject({ retryAfterMs: 4000, message: "Slowing down — try again in 4 s" });
    expect(classifyLiveFailure(new ApiError("Too many", 429, "rate_limited"), ONLINE)).toMatchObject({ retryAfterMs: RATE_LIMIT_FALLBACK_MS });
  });

  it("402: keeps a human server message, falls back to our copy for a bare code", () => {
    expect(classifyLiveFailure(new ApiError("Your class is out of credits.", 402, "credits_exhausted"), ONLINE)).toMatchObject({
      code: "credits",
      message: "Your class is out of credits.",
    });
    expect(classifyLiveFailure(new ApiError("credits_exhausted", 402, "credits_exhausted"), ONLINE)).toMatchObject({ message: LIVE_COPY.errors.credits });
    expect(classifyLiveFailure(new ApiError("Request failed (402)", 402), ONLINE)).toMatchObject({ message: LIVE_COPY.errors.credits });
  });

  it("timeouts, SSE error frames, network failures and the offline exception", () => {
    const timeout = new Error("Recognition timed out");
    timeout.name = "TimeoutError";
    expect(classifyLiveFailure(timeout, ONLINE)).toMatchObject({ code: "timeout", message: "Reading took too long" });
    expect(classifyLiveFailure(new DOMException("t", "TimeoutError"), ONLINE)).toMatchObject({ code: "timeout" });

    expect(classifyLiveFailure(sseFailure({ error: "upstream_error", message: "Model unavailable" }), { kind: "check", lineId: "L1", online: true, userAsked: true })).toMatchObject({
      kind: "check",
      code: "upstream",
      message: "Model unavailable",
      userAsked: true,
    });
    expect(classifyLiveFailure(sseFailure({ error: "upstream_error", message: "  " }), { kind: "check", online: true })).toMatchObject({ message: LIVE_COPY.errors.upstream });

    expect(classifyLiveFailure(new TypeError("Failed to fetch"), ONLINE)).toMatchObject({ code: "network", message: "Couldn't reach the tutor service" });
    expect(classifyLiveFailure(new TypeError("Failed to fetch"), { ...ONLINE, online: false })).toBeNull();
    expect(classifyLiveFailure("weird", ONLINE)).toMatchObject({ code: "unknown" });
    expect(classifyLiveFailure(undefined, { kind: "capabilities", online: true })).toMatchObject({ kind: "capabilities", code: "unknown", lineId: undefined });
  });

  it("appends the attempt count from the second failure on", () => {
    const e = new ApiError("boom", 500);
    expect(classifyLiveFailure(e, { ...ONLINE, attempts: 1 })?.message).toBe("The tutor service had a hiccup");
    expect(classifyLiveFailure(e, { ...ONLINE, attempts: 3 })?.message).toBe("The tutor service had a hiccup — tried 3 times");
  });
});

describe("liveErrorView", () => {
  it("unauthorized -> Sign in, no retry", () => {
    expect(liveErrorView(err({ code: "unauthorized", message: "Please sign in again" }), 10_000)).toEqual({
      title: "Please sign in again",
      primary: "signin",
      retryEnabled: false,
    });
  });

  it("rate_limited counts down from retryAfterMs and enables Retry at 0", () => {
    const e = err({ code: "rate_limited", retryAfterMs: 5000, message: "Slowing down — try again in 5 s" });
    expect(liveErrorView(e, 10_000)).toMatchObject({ title: "Slowing down — try again in 5 s", primary: "retry", secondsLeft: 5, retryEnabled: false });
    expect(liveErrorView(e, 12_100)).toMatchObject({ title: "Slowing down — try again in 3 s", secondsLeft: 3, retryEnabled: false });
    expect(liveErrorView(e, 14_999)).toMatchObject({ secondsLeft: 1, retryEnabled: false });
    expect(liveErrorView(e, 15_000)).toMatchObject({ title: "You can try again now", secondsLeft: 0, retryEnabled: true });
    expect(liveErrorView(e, 99_000)).toMatchObject({ secondsLeft: 0, retryEnabled: true });
    expect(secondsLeftFor({ at: 0 }, 5)).toBe(0);
  });

  it("credits -> only Dismiss; everything else -> Retry enabled", () => {
    expect(liveErrorView(err({ code: "credits", message: "Out of credits" }), 0)).toEqual({ title: "Out of credits", primary: null, retryEnabled: false });
    for (const code of ["network", "upstream", "timeout", "unknown"] as const) {
      expect(liveErrorView(err({ code, message: "m" }), 0)).toEqual({ title: "m", primary: "retry", retryEnabled: true });
    }
  });
});

describe("showsHintCard", () => {
  it("only user-asked check/solve errors with a line get the inline card", () => {
    expect(showsHintCard(null)).toBe(false);
    expect(showsHintCard(err({ kind: "recognize", lineId: "L1" }))).toBe(false);
    expect(showsHintCard(err({ kind: "check", lineId: "L1" }))).toBe(false);
    expect(showsHintCard(err({ kind: "check", lineId: "L1", userAsked: true }))).toBe(true);
    expect(showsHintCard(err({ kind: "solve", lineId: "L1", userAsked: true }))).toBe(true);
    expect(showsHintCard(err({ kind: "solve", userAsked: true }))).toBe(false);
  });
});

describe("pillLabelFor loading states", () => {
  it("keeps Reading… / Checking… and says Solving… while a solve stream is open", () => {
    expect(pillLabelFor("reading", "mathpix")).toBe("Reading…");
    expect(pillLabelFor("reading", "vision")).toBe("Reading (slower)…");
    expect(pillLabelFor("checking", "mathpix")).toBe("Checking…");
    expect(pillLabelFor("checking", "mathpix", 0, false)).toBe("Checking…");
    expect(pillLabelFor("checking", "mathpix", 0, true)).toBe("Solving…");
    expect(pillLabelFor("idle", "mathpix", 0, true)).toBe("Live");
  });

  it("error copy follows the tone rules: no exclamation marks, never 'wrong'", () => {
    const strings = Object.values(LIVE_COPY.errors).map((v) => (typeof v === "function" ? (v as (n: number) => string)(3) : v));
    for (const s of strings) {
      expect(s).not.toMatch(/!/);
      expect(s.toLowerCase()).not.toMatch(/wrong/);
    }
  });
});
