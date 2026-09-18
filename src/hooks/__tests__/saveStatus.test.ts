import { describe, expect, it } from "vitest";
import { ASSET_COPY } from "@/components/live/copy";
import { SAVE_STATUS_COPY, SAVED_FADE_MS, saveStatusViewFor } from "@/components/live/SaveStatus";
import type { SyncState } from "@/lib/sync";

const base: SyncState = { status: "saved", message: null, lastSavedAt: 1000, version: 3, pending: false, attempt: 0 };
const at = (over: Partial<SyncState>): SyncState => ({ ...base, ...over });

describe("saveStatusViewFor", () => {
  it("shows 'Saved' only inside the fade window and never before the first save", () => {
    expect(saveStatusViewFor(at({}), true)).toEqual({ label: SAVE_STATUS_COPY.saved, tone: "neutral", showRetry: false, title: null });
    expect(saveStatusViewFor(at({}), false)).toBeNull();
    expect(saveStatusViewFor(at({ lastSavedAt: null }), true)).toBeNull();
    expect(SAVED_FADE_MS).toBe(1500);
  });

  it("stays quiet while a save is merely debounced, but shows retries", () => {
    expect(saveStatusViewFor(at({ status: "dirty", pending: true }), false)).toBeNull();
    expect(saveStatusViewFor(at({ status: "dirty", pending: true, attempt: 2 }), false)).toMatchObject({
      label: SAVE_STATUS_COPY.retrying,
      tone: "neutral",
      showRetry: false,
    });
  });

  it("'Saving…' is neutral without a retry", () => {
    expect(saveStatusViewFor(at({ status: "saving" }), false)).toEqual({
      label: SAVE_STATUS_COPY.saving,
      tone: "neutral",
      showRetry: false,
      title: null,
    });
  });

  it("offline is amber and explains that changes are unsaved", () => {
    const view = saveStatusViewFor(at({ status: "offline", message: "You're offline", pending: true }), false);
    expect(view).toEqual({ label: SAVE_STATUS_COPY.offline, tone: "amber", showRetry: false, title: "You're offline" });
    expect(view?.label).toContain("offline");
  });

  it("error is red with a Retry button and the underlying message as hover text", () => {
    expect(saveStatusViewFor(at({ status: "error", message: "permission denied (code: 42501)", attempt: 3 }), false)).toEqual({
      label: SAVE_STATUS_COPY.error,
      tone: "red",
      showRetry: true,
      title: "permission denied (code: 42501)",
    });
  });

  it("merging is informational", () => {
    expect(saveStatusViewFor(at({ status: "merging" }), false)).toMatchObject({
      label: SAVE_STATUS_COPY.merging,
      tone: "info",
      showRetry: false,
    });
  });

  it("refused shows the queue's message, falling back to the existing too-large copy, without Retry", () => {
    expect(saveStatusViewFor(at({ status: "refused", message: null }), false)).toEqual({
      label: ASSET_COPY.boardTooLarge,
      tone: "red",
      showRetry: false,
      title: null,
    });
    expect(saveStatusViewFor(at({ status: "refused", message: "Couldn't prepare this board to save" }), false)).toMatchObject({
      label: "Couldn't prepare this board to save",
      tone: "red",
    });
  });

  it("the fade flag never leaks into non-saved states", () => {
    for (const status of ["dirty", "saving", "offline", "merging", "error", "refused"] as const) {
      expect(saveStatusViewFor(at({ status }), true)).toEqual(saveStatusViewFor(at({ status }), false));
    }
  });
});
