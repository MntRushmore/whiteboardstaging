import { describe, expect, it } from "vitest";
import { ApiError } from "@/lib/api-client";
import {
  CREDITS_EXHAUSTED_MESSAGE,
  NETWORK_MESSAGE,
  OFFLINE_MESSAGE,
  RATE_LIMITED_MESSAGE,
  SERVER_MESSAGE,
  SIGN_IN_AGAIN_MESSAGE,
  describeApiError,
} from "@/hooks/useApiErrorHandler";
import { PDF_COPY, pdfReadErrorFor } from "@/components/PdfUpload";

describe("describeApiError", () => {
  it("401 asks to sign in again and is not retryable", () => {
    expect(describeApiError(new ApiError("unauthorized", 401, "unauthorized"))).toEqual({
      message: SIGN_IN_AGAIN_MESSAGE,
      retryable: false,
      signIn: true,
      aborted: false,
      kind: "unauthorized",
    });
    // no session at all (authedFetch) looks the same to the UI
    expect(describeApiError(new ApiError("You need to be signed in.", 401, "unauthorized")).signIn).toBe(true);
  });

  it("402 shows the credits message with no Retry, preferring the server's human text", () => {
    expect(describeApiError(new ApiError("credits_exhausted", 402, "credits_exhausted"))).toMatchObject({
      message: CREDITS_EXHAUSTED_MESSAGE,
      retryable: false,
      kind: "credits",
    });
    expect(describeApiError(new ApiError("Out of credits for today", 402, "credits_exhausted")).message).toBe(
      "Out of credits for today",
    );
    // apiJson's own fallback text is not a human message either
    expect(describeApiError(new ApiError("Request failed (402)", 402)).message).toBe(CREDITS_EXHAUSTED_MESSAGE);
  });

  it("429 is retryable and carries retryAfterMs from details, the body, or the message", () => {
    const fromDetails = describeApiError(
      new ApiError("You're doing that too fast. Try again in 2 seconds.", 429, "rate_limited", { retryAfterMs: 1500 }),
    );
    expect(fromDetails).toEqual({
      message: "You're doing that too fast. Try again in 2 seconds.",
      retryable: true,
      retryAfterMs: 1500,
      aborted: false,
      kind: "rate-limited",
    });

    const bodyErr = Object.assign(new ApiError("rate_limited", 429, "rate_limited"), { retryAfterMs: 4000 });
    expect(describeApiError(bodyErr)).toMatchObject({ retryAfterMs: 4000, message: "Try again in 4 seconds" });

    const parsed = describeApiError(new ApiError("Try again in 3 seconds.", 429, "rate_limited"));
    expect(parsed.retryAfterMs).toBe(3000);

    const bare = describeApiError(new ApiError("rate_limited", 429, "rate_limited"));
    expect(bare).toMatchObject({ message: RATE_LIMITED_MESSAGE, retryable: true });
    expect(bare.retryAfterMs).toBeUndefined();
  });

  it("5xx is retryable with the server's message or a calm default", () => {
    expect(describeApiError(new ApiError("Request failed (502)", 502, "upstream_error"))).toMatchObject({
      message: SERVER_MESSAGE,
      retryable: true,
      kind: "server",
    });
    expect(describeApiError(new ApiError("Model timed out", 502, "upstream_error")).message).toBe("Model timed out");
    expect(describeApiError(new ApiError("internal_error", 500, "internal_error")).message).toBe(SERVER_MESSAGE);
  });

  it("other 4xx keep the server's message and are retryable only when transient", () => {
    expect(describeApiError(new ApiError("Image too large", 400, "invalid_request"))).toMatchObject({
      message: "Image too large",
      retryable: false,
      kind: "request",
    });
    expect(describeApiError(new ApiError("invalid_request", 400, "invalid_request"), { fallback: "Couldn't do that" }).message).toBe(
      "Couldn't do that",
    );
    expect(describeApiError(new ApiError("Request Timeout", 408)).retryable).toBe(true);
    expect(describeApiError(new ApiError("Conflict", 409)).retryable).toBe(true);
  });

  it("a network TypeError is retryable: connection message online, offline message otherwise", () => {
    const err = new TypeError("Failed to fetch");
    expect(describeApiError(err, { online: true })).toEqual({
      message: NETWORK_MESSAGE,
      retryable: true,
      aborted: false,
      kind: "network",
    });
    expect(describeApiError(err, { online: false })).toMatchObject({ message: OFFLINE_MESSAGE, kind: "offline", retryable: true });
    // message-based detection for non-TypeError transports
    expect(describeApiError(new Error("network request failed"), { online: true }).kind).toBe("network");
  });

  it("AbortError is not an error: empty message, nothing to retry", () => {
    const abort = new DOMException("The user aborted a request.", "AbortError");
    expect(describeApiError(abort)).toEqual({ message: "", retryable: false, aborted: true, kind: "abort" });
    const named = Object.assign(new Error("aborted"), { name: "AbortError" });
    expect(describeApiError(named).aborted).toBe(true);
  });

  it("unknown errors keep their message (or the fallback) and stay retryable", () => {
    expect(describeApiError(new Error("Failed to load generated image"))).toMatchObject({
      message: "Failed to load generated image",
      retryable: true,
      kind: "other",
    });
    expect(describeApiError("boom", { fallback: "Couldn't finish this one" })).toMatchObject({
      message: "Couldn't finish this one",
      retryable: true,
    });
  });

  it("keeps the copy calm: no exclamation marks, never 'wrong'", () => {
    for (const text of [CREDITS_EXHAUSTED_MESSAGE, SIGN_IN_AGAIN_MESSAGE, RATE_LIMITED_MESSAGE, OFFLINE_MESSAGE, NETWORK_MESSAGE, SERVER_MESSAGE]) {
      expect(text).not.toMatch(/!/);
      expect(text).not.toMatch(/\bwrong\b/i);
    }
  });
});

describe("pdfReadErrorFor", () => {
  it("a password-protected PDF is not retryable", () => {
    expect(pdfReadErrorFor(new Error("PasswordException: No password given"))).toEqual({
      message: PDF_COPY.passwordProtected,
      retryable: false,
      step: "read",
    });
    expect(pdfReadErrorFor("document is encrypted").retryable).toBe(false);
  });

  it("anything else (damaged file, reader failed to load) offers Retry", () => {
    expect(pdfReadErrorFor(new Error("Invalid PDF structure"))).toEqual({
      message: PDF_COPY.unreadable,
      retryable: true,
      step: "read",
    });
    expect(pdfReadErrorFor(undefined).retryable).toBe(true);
  });
});
