import { describe, expect, it, vi } from "vitest";
import { ApiError } from "@/lib/api-client";
import { classifyLiveFailure } from "@/components/live/errorView";
import { CHAT_COPY, chatErrorFor } from "@/components/chat/chatView";
import { LECTURE_COPY } from "@/components/lecture/lectureView";
import { INK_EMPTY_MESSAGE } from "@/lib/server/billing";
import { OPEN_INK_DIALOG_EVENT, PEN_REST_MS, inkDialogWanted, openInkDialog, penIsResting } from "../inkDialog";
import { OUT_OF_INK_COPY, inkArrived, inkPanelMood } from "../outOfInk";

describe("the dialog's words", () => {
  it("say what happened, that the board is safe and drawing is free", () => {
    expect(OUT_OF_INK_COPY.title).toBe("You're out of ink");
    expect(OUT_OF_INK_COPY.body).toMatch(/board is saved/);
    expect(OUT_OF_INK_COPY.body).toMatch(/drawing on your own is always free/);
    expect(OUT_OF_INK_COPY.buyBody(42)).toBe("You have 42 ink left. Ink never expires, so a pack lasts as long as you need it to.");
    expect(OUT_OF_INK_COPY.addedBody(5000)).toBe("You have 5,000 ink now. The tutor is ready when you are.");
  });

  it("the Ask and lecture panels use the same title (literals there keep the panel's module lazy)", () => {
    expect(CHAT_COPY.errors.ink).toBe(OUT_OF_INK_COPY.title);
    expect(LECTURE_COPY.errors.ink).toBe(OUT_OF_INK_COPY.title);
  });

  it("the server's 402 says the same thing in its own words", () => {
    expect(INK_EMPTY_MESSAGE).toBe("You're out of ink. Grab an ink pack to keep going.");
  });
});

describe("inkPanelMood / inkArrived", () => {
  it("reads 'empty' at no ink (or a 402 before the balance loads), else 'buy'", () => {
    expect(inkPanelMood(0, false)).toBe("empty");
    expect(inkPanelMood(250, true)).toBe("buy");
    expect(inkPanelMood(null, true)).toBe("empty");
    expect(inkPanelMood(undefined, false)).toBe("buy");
  });
  it("says ink arrived once the balance grows above what the panel opened with", () => {
    expect(inkArrived(0, 5000)).toBe(true);
    expect(inkArrived(null, 300)).toBe(true);
    expect(inkArrived(0, 0)).toBe(false);
    expect(inkArrived(40, 40)).toBe(false);
    expect(inkArrived(40, 5040)).toBe(true);
    expect(inkArrived(0, null)).toBe(false);
  });
});

describe("the 402 -> dialog mapping", () => {
  it("a Live 402 ink_empty becomes an 'ink' error, which asks for the dialog once", () => {
    const fields = classifyLiveFailure(new ApiError(INK_EMPTY_MESSAGE, 402, "ink_empty"), { kind: "recognize", online: true });
    expect(fields).toMatchObject({ code: "ink", message: INK_EMPTY_MESSAGE });
    expect(inkDialogWanted(fields, false)).toBe(true);
    expect(inkDialogWanted(fields, true)).toBe(false);
  });
  it("other Live failures never open it, including the provider's own outage (a 503)", () => {
    for (const err of [new ApiError("slow down", 429, "rate_limited"), new ApiError("x", 502, "upstream_error"), new ApiError("x", 503, "upstream_error"), new ApiError("x", 401, "unauthorized")]) {
      expect(inkDialogWanted(classifyLiveFailure(err, { kind: "check", online: true }), false)).toBe(false);
    }
    expect(inkDialogWanted(null, false)).toBe(false);
  });
  it("the Ask panel's 402 uses the dialog's words", () => {
    expect(chatErrorFor(new ApiError("x", 402, "ink_empty"))).toEqual({ kind: "ink", message: OUT_OF_INK_COPY.title, retry: false });
  });
});

describe("openInkDialog", () => {
  it("fires the event the board's watcher listens for", () => {
    const seen: string[] = [];
    vi.stubGlobal("window", { dispatchEvent: (e: Event) => seen.push(e.type) });
    try {
      openInkDialog();
    } finally {
      vi.unstubAllGlobals();
    }
    expect(seen).toEqual([OPEN_INK_DIALOG_EVENT]);
  });
});

describe("penIsResting (never mid-stroke)", () => {
  it("waits while a pointer is down, and for a quiet moment after the last stroke", () => {
    expect(penIsResting({ pointerDown: true, lastPenAt: 0, now: 60_000 })).toBe(false);
    expect(penIsResting({ pointerDown: false, lastPenAt: 10_000, now: 10_000 + PEN_REST_MS - 1 })).toBe(false);
    expect(penIsResting({ pointerDown: false, lastPenAt: 10_000, now: 10_000 + PEN_REST_MS })).toBe(true);
  });
});
