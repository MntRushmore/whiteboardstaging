import { describe, expect, it } from "vitest";
import type { LiveError } from "@/lib/live/liveStore";
import { LIVE_COPY } from "../copy";
import {
  boardMenuView,
  boardToolbarView,
  statusPillView,
  type BoardToolbarState,
  type StatusPillState,
} from "../toolbar";

/**
 * What the board's top bar shows. The bar is a student's first impression, so the rules
 * that decide it are pure and pinned here rather than read off the JSX.
 */

function toolbar(partial: Partial<BoardToolbarState> = {}) {
  return boardToolbarView({
    mode: "feedback",
    liveEnabled: true,
    liveAvailable: true,
    voiceActive: false,
    ...partial,
  });
}

function pill(partial: Partial<StatusPillState> = {}) {
  return statusPillView({
    liveRunning: true,
    liveAvailable: true,
    status: "idle",
    shownStatus: "idle",
    recognizer: "unknown",
    offlineQueued: 0,
    solving: false,
    error: null,
    atCap: false,
    ...partial,
  });
}

const ERROR: LiveError = {
  id: "e1",
  kind: "recognize",
  code: "upstream",
  message: "The tutor service had a hiccup",
  at: 10_000,
};

describe("boardToolbarView", () => {
  it("shows the bar with the status pill in every help mode", () => {
    for (const mode of ["off", "feedback", "suggest", "answer"] as const) {
      expect(toolbar({ mode })).toMatchObject({ showTopBar: true, showStatusPill: true });
    }
  });

  it("offers Solve steps only in Solve, not as a permanent button", () => {
    expect(toolbar({ mode: "off" }).showSolveSteps).toBe(false);
    expect(toolbar({ mode: "feedback" }).showSolveSteps).toBe(false);
    expect(toolbar({ mode: "suggest" }).showSolveSteps).toBe(false);
    expect(toolbar({ mode: "answer" }).showSolveSteps).toBe(true);
  });

  it("hides Solve steps when Live is off: only Live writes the steps", () => {
    expect(toolbar({ mode: "answer", liveEnabled: false }).showSolveSteps).toBe(false);
    expect(toolbar({ mode: "answer", liveAvailable: false }).showSolveSteps).toBe(false);
  });

  it("keeps the pill (and so the board's only menu) reachable while Live is off", () => {
    expect(toolbar({ liveEnabled: false })).toMatchObject({ showStatusPill: true, liveRunning: false });
    expect(toolbar({ liveAvailable: false })).toMatchObject({ showStatusPill: true, liveRunning: false });
  });

  it("stands the whole bar down for the voice tutor", () => {
    expect(toolbar({ voiceActive: true })).toMatchObject({
      showTopBar: false,
      showStatusPill: false,
      showSolveSteps: false,
      showHintLayer: false,
    });
  });

  it("draws hints only while Live is running and voice is not", () => {
    expect(toolbar().showHintLayer).toBe(true);
    expect(toolbar({ liveEnabled: false }).showHintLayer).toBe(false);
    expect(toolbar({ voiceActive: true }).showHintLayer).toBe(false);
  });
});

describe("statusPillView", () => {
  it("reports what Live is doing, and fades the label once it goes idle", () => {
    expect(pill({ status: "reading" })).toMatchObject({
      label: LIVE_COPY.pill.reading,
      dataStatus: "reading",
      fading: false,
    });
    expect(pill({ status: "idle", shownStatus: "checking" })).toMatchObject({
      label: LIVE_COPY.pill.checking,
      dataStatus: "idle",
      fading: true,
    });
    expect(pill({ status: "checking", solving: true }).label).toBe(LIVE_COPY.pill.solving);
    expect(pill({ status: "reading", recognizer: "vision" }).label).toBe(LIVE_COPY.pill.readingSlow);
    expect(pill({ status: "offline", offlineQueued: 2 }).label).toBe(LIVE_COPY.pill.offlineWaiting(2));
  });

  it("lets an error outrank every other state", () => {
    expect(pill({ status: "reading", error: ERROR })).toMatchObject({
      label: null,
      dataStatus: "error",
      showError: true,
    });
  });

  it("rests at 'Live off' when the student switched Live off, and drops a stale error", () => {
    expect(pill({ liveRunning: false })).toMatchObject({
      label: LIVE_COPY.pill.off,
      dataStatus: "off",
      showError: false,
    });
    expect(pill({ liveRunning: false, status: "reading", error: ERROR })).toMatchObject({
      label: LIVE_COPY.pill.off,
      showError: false,
    });
  });

  it("says 'Live unavailable' when the build has taken Live away", () => {
    expect(pill({ liveRunning: false, liveAvailable: false }).label).toBe(LIVE_COPY.pill.unavailable);
  });

  it("points a student who switched Live off back at the menu", () => {
    expect(pill().hint).toBe(LIVE_COPY.toggleHint);
    expect(pill({ liveRunning: false }).hint).toBe(LIVE_COPY.pill.offHint);
    expect(pill({ liveRunning: false, liveAvailable: false }).hint).toBe(LIVE_COPY.pill.liveOffHint);
  });

  it("offers the Clear marks shortcut at the shape cap, but not mid-flight", () => {
    expect(pill({ atCap: true }).showClearMarks).toBe(true);
    expect(pill({ atCap: true, status: "reading" }).showClearMarks).toBe(false);
    expect(pill({ atCap: true, error: ERROR }).showClearMarks).toBe(false);
    expect(pill({ atCap: true, liveRunning: false }).showClearMarks).toBe(false);
  });
});

describe("boardMenuView", () => {
  it("carries the Live preference that used to be a switch in the bar", () => {
    expect(boardMenuView({ liveEnabled: true, liveAvailable: true })).toMatchObject({
      liveChecked: true,
      liveDisabled: false,
      liveHint: LIVE_COPY.toggleHint,
    });
    expect(boardMenuView({ liveEnabled: false, liveAvailable: true }).liveChecked).toBe(false);
  });

  it("freezes the Live preference, honestly unchecked, behind the kill switch", () => {
    expect(boardMenuView({ liveEnabled: true, liveAvailable: false })).toMatchObject({
      liveChecked: false,
      liveDisabled: true,
      liveHint: LIVE_COPY.pill.liveOffHint,
    });
  });

  it("drops 'Tutor writes by hand' while Live is off: it has nothing to render", () => {
    expect(boardMenuView({ liveEnabled: true, liveAvailable: true }).showHandwriting).toBe(true);
    expect(boardMenuView({ liveEnabled: false, liveAvailable: true }).showHandwriting).toBe(false);
    expect(boardMenuView({ liveEnabled: true, liveAvailable: false }).showHandwriting).toBe(false);
  });

  it("gates nothing else: Draw help, Clear marks and Hide AI shapes act on the canvas, not on Live", () => {
    // A student who switched Live off with their marks hidden must still be able to get
    // them back, so the view exposes exactly one conditional item.
    const off = boardMenuView({ liveEnabled: false, liveAvailable: true });
    expect(Object.keys(off).filter((k) => k.startsWith("show"))).toEqual(["showHandwriting"]);
  });
});
