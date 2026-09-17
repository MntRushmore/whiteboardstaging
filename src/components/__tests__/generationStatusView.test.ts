import { describe, expect, it } from "vitest";
import {
  GENERATION_COPY,
  INFO_CLEAR_MS,
  SUCCESS_CLEAR_MS,
  generationStatusView,
  type GenerationState,
} from "@/components/StatusIndicator";

describe("generationStatusView", () => {
  it("shows nothing while idle", () => {
    expect(generationStatusView({ kind: "idle" })).toBeNull();
  });

  it("spins with the mode label while generating, no buttons", () => {
    expect(generationStatusView({ kind: "generating", label: "Adding feedback..." })).toEqual({
      label: "Adding feedback...",
      tone: "neutral",
      spinner: true,
      showRetry: false,
      showDismiss: false,
    });
    // an empty label (mode 'off' returns "") falls back to the default
    expect(generationStatusView({ kind: "generating", label: "" })?.label).toBe(GENERATION_COPY.generating);
  });

  it("confirms success briefly and fades on its own", () => {
    expect(generationStatusView({ kind: "success", label: "Feedback added" })).toMatchObject({
      label: "Feedback added",
      tone: "neutral",
      spinner: false,
      showRetry: false,
      showDismiss: false,
    });
    expect(SUCCESS_CLEAR_MS).toBe(2000);
  });

  it("the text-only 'help not needed' path shows a short info note instead of nothing", () => {
    expect(generationStatusView({ kind: "info", label: GENERATION_COPY.nothingToAdd })).toEqual({
      label: "Nothing to add yet",
      tone: "info",
      spinner: false,
      showRetry: false,
      showDismiss: false,
    });
    expect(INFO_CLEAR_MS).toBe(2500);
  });

  it("offline is amber with Retry and Dismiss", () => {
    const view = generationStatusView({ kind: "offline" });
    expect(view).toMatchObject({ tone: "amber", showRetry: true, showDismiss: true, spinner: false });
    expect(view?.label).toContain("You're offline");
  });

  it("a retryable error is red with Retry and Dismiss", () => {
    expect(
      generationStatusView({ kind: "error", message: "The tutor is unavailable right now. Try again in a moment.", retryable: true }),
    ).toEqual({
      label: "The tutor is unavailable right now. Try again in a moment.",
      tone: "red",
      spinner: false,
      showRetry: true,
      showDismiss: true,
    });
  });

  it("402 credits: message only, no Retry", () => {
    const state: GenerationState = { kind: "error", message: "Account credits are used up", retryable: false };
    expect(generationStatusView(state)).toMatchObject({ showRetry: false, showDismiss: true, tone: "red" });
  });

  it("401: never offers Retry even if flagged retryable", () => {
    expect(
      generationStatusView({ kind: "error", message: "Please sign in again", retryable: true, signIn: true }),
    ).toMatchObject({ showRetry: false, showDismiss: true });
  });

  it("429: keeps the server's wait hint, or adds one from retryAfterMs", () => {
    const withHint = generationStatusView({
      kind: "error",
      message: "You're doing that too fast. Try again in 2 seconds.",
      retryable: true,
      retryAfterMs: 2000,
    });
    expect(withHint?.label).toBe("You're doing that too fast. Try again in 2 seconds.");
    expect(withHint?.showRetry).toBe(true);

    const withoutHint = generationStatusView({ kind: "error", message: "Slow down a little", retryable: true, retryAfterMs: 1500 });
    expect(withoutHint?.label).toBe("Slow down a little. Try again in 2 seconds");
    expect(generationStatusView({ kind: "error", message: "Slow down.", retryable: true, retryAfterMs: 900 })?.label).toBe(
      "Slow down. Try again in 1 second",
    );
  });

  it("an empty error message falls back to calm copy", () => {
    expect(generationStatusView({ kind: "error", message: "", retryable: true })?.label).toBe(GENERATION_COPY.failed);
  });

  it("keeps the copy calm: no exclamation marks, never 'wrong'", () => {
    const strings = Object.values(GENERATION_COPY).map((v) => (typeof v === "function" ? v(3) : v));
    for (const text of strings) {
      expect(text).not.toMatch(/!/);
      expect(text).not.toMatch(/\bwrong\b/i);
    }
  });
});
