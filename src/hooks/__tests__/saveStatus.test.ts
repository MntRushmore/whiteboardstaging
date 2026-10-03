import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ASSET_COPY } from "@/components/live/copy";
import { SAVE_STATUS_COPY, SAVED_FADE_MS, SaveStatus, saveStatusIcon, saveStatusViewFor } from "@/components/live/SaveStatus";
import type { SyncState } from "@/lib/sync";

const base: SyncState = { status: "saved", message: null, notice: null, lastSavedAt: 1000, version: 3, pending: false, attempt: 0 };
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

  it("a save that is a retry after a failure says 'Retrying…', so a hang that keeps timing out never reads as an ordinary save", () => {
    expect(saveStatusViewFor(at({ status: "saving", attempt: 2 }), false)).toMatchObject({
      label: SAVE_STATUS_COPY.retrying,
      tone: "neutral",
      showRetry: false,
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

  it("a nearly full board keeps an amber notice up while it saves normally", () => {
    const notice = ASSET_COPY.boardNearlyFull;
    const view = { label: notice, tone: "amber", showRetry: false, title: null };
    expect(saveStatusViewFor(at({ notice }), false)).toEqual(view);
    expect(saveStatusViewFor(at({ status: "dirty", pending: true, notice }), false)).toEqual(view);
    // the brief "Saved", a save in flight and every problem state still take precedence
    expect(saveStatusViewFor(at({ notice }), true)?.label).toBe(SAVE_STATUS_COPY.saved);
    expect(saveStatusViewFor(at({ status: "saving", notice }), false)?.label).toBe(SAVE_STATUS_COPY.saving);
    expect(saveStatusViewFor(at({ status: "error", message: "x", notice }), false)?.label).toBe(SAVE_STATUS_COPY.error);
  });

  it("the fade flag never leaks into non-saved states", () => {
    for (const status of ["dirty", "saving", "offline", "merging", "error", "refused"] as const) {
      expect(saveStatusViewFor(at({ status }), true)).toEqual(saveStatusViewFor(at({ status }), false));
    }
  });
});

describe("the pill's compact form (an icon on a board under 1024 px, so an upright iPad's bar keeps one row)", () => {
  it("only the routine states shrink to an icon; anything the student must read keeps its words", () => {
    const icon = (state: SyncState, savedVisible = false) => {
      const view = saveStatusViewFor(state, savedVisible);
      return view && saveStatusIcon(view);
    };
    expect(icon(at({}), true)).toBe("saved");
    expect(icon(at({ status: "saving" }))).toBe("busy");
    expect(icon(at({ status: "saving", attempt: 1 }))).toBe("busy");
    expect(icon(at({ status: "dirty", attempt: 2 }))).toBe("busy");
    for (const status of ["offline", "merging", "error", "refused"] as const) expect(icon(at({ status, message: "x" })), status).toBeNull();
    expect(icon(at({ notice: "This board is nearly full" }))).toBeNull();
  });

  it("renders the icon on a narrow board with the words for screen readers and as the tooltip; errors in words", () => {
    const saving = renderToStaticMarkup(createElement(SaveStatus, { sync: at({ status: "saving" }), onRetry: () => {} }));
    expect(saving).toContain('title="Saving…"');
    expect(saving).toMatch(/<svg[^>]*@5xl\/bar:hidden/);
    expect(saving).toContain('<span class="sr-only @5xl/bar:not-sr-only">Saving…</span>');
    const failed = renderToStaticMarkup(createElement(SaveStatus, { sync: at({ status: "error", message: "network" }), onRetry: () => {} })).replace(/&#x27;/g, "'");
    expect(failed).not.toContain("<svg");
    expect(failed).toContain(`<span>${SAVE_STATUS_COPY.error}</span>`);
    expect(failed).toContain(">Retry</button>");
  });
});
