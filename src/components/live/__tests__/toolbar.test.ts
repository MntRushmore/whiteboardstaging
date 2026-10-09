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
    auto: true,
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
  it("always offers a stuck student something to tap: Help me in Feedback and Suggest, Solve it in Solve, none in Off", () => {
    expect(toolbar({ mode: "off" }).askButton).toBe(null);
    expect(toolbar({ mode: "feedback" }).askButton).toBe("help");
    expect(toolbar({ mode: "suggest" }).askButton).toBe("help");
    expect(toolbar({ mode: "answer" }).askButton).toBe("solve");
  });

  it("shows the Auto switch beside the dial in every help mode, as the student left it", () => {
    for (const mode of ["feedback", "suggest", "answer"] as const) {
      expect(toolbar({ mode }).autoSwitch).toEqual({ on: true, hint: LIVE_COPY.auto.onHint });
      expect(toolbar({ mode, auto: false }).autoSwitch).toEqual({ on: false, hint: LIVE_COPY.auto.offHint });
    }
  });

  it("says Auto is paused while AI shapes are hidden (the switch keeps the student's choice)", () => {
    expect(toolbar({ hideAiShapes: true }).autoSwitch).toEqual({ on: true, hint: LIVE_COPY.auto.pausedHint });
    expect(toolbar({ hideAiShapes: true, auto: false }).autoSwitch).toEqual({ on: false, hint: LIVE_COPY.auto.offHint });
  });

  it("hides the Auto switch where it would do nothing: Off, and with Live off (exactly where there is no ask button)", () => {
    for (const auto of [true, false]) {
      expect(toolbar({ mode: "off", auto }).autoSwitch).toBe(null);
      expect(toolbar({ mode: "answer", liveEnabled: false, auto }).autoSwitch).toBe(null);
      expect(toolbar({ mode: "suggest", liveAvailable: false, auto }).autoSwitch).toBe(null);
    }
    for (const mode of ["off", "feedback", "suggest", "answer"] as const) {
      for (const liveEnabled of [true, false]) {
        const view = toolbar({ mode, liveEnabled });
        expect(view.autoSwitch === null).toBe(view.askButton === null);
      }
    }
  });

  it("labels the switch with one word a young reader gets at a glance, and says what each position does", () => {
    expect(LIVE_COPY.auto.label).toBe("Auto");
    for (const hint of [LIVE_COPY.auto.onHint, LIVE_COPY.auto.offHint]) {
      expect(hint).not.toMatch(/!|wrong/i);
      expect(hint).toMatch(/your tutor/);
    }
  });

  it("hides the ask button when Live is off: only Live writes the steps", () => {
    expect(toolbar({ mode: "answer", liveEnabled: false }).askButton).toBe(null);
    expect(toolbar({ mode: "suggest", liveAvailable: false }).askButton).toBe(null);
  });

  it("knows when Live is not running (the pill, and so the board's only menu, stays in the bar)", () => {
    expect(toolbar({ liveEnabled: false })).toMatchObject({ liveRunning: false });
    expect(toolbar({ liveAvailable: false })).toMatchObject({ liveRunning: false });
  });

  it("draws hints only while Live is running", () => {
    expect(toolbar().showHintLayer).toBe(true);
    expect(toolbar({ liveEnabled: false }).showHintLayer).toBe(false);
  });
  it("Help (the menu's one ask) works in every help mode but Off, and only with Live running", () => {
    for (const mode of ["feedback", "suggest", "answer"] as const) expect(toolbar({ mode }).canHelp).toBe(true);
    expect(toolbar({ mode: "off" }).canHelp).toBe(false);
    // there is no image pipeline to fall back on: without Live, Help has nothing to call
    expect(toolbar({ mode: "answer", liveEnabled: false }).canHelp).toBe(false);
    expect(toolbar({ mode: "answer", liveAvailable: false }).canHelp).toBe(false);
  });

  it("keeps every grown-up control in the bar on the ordinary board", () => {
    const view = toolbar();
    expect(view.simple).toBe(false);
    expect(Object.values(view.place).every((p) => p === "bar")).toBe(true);
    // what turns the simple board's exceptions on changes nothing here
    expect(toolbar({ tour: true, liveError: true, solving: true }).place).toEqual(view.place);
  });

  it("simple board: a kid's bar is Help me (Back and the save pill are always there), the rest behind More", () => {
    const view = toolbar({ simple: true });
    expect(view.simple).toBe(true);
    expect(view.askButton).toBe("help");
    expect(view.place).toEqual({ dial: "more", auto: "more", ask: "more", pill: "more", ink: "more", report: "more" });
  });

  it("simple board: Auto stays on and the mode stays as it was — nothing is switched, only moved", () => {
    const simple = toolbar({ simple: true });
    const full = toolbar();
    expect(simple.autoSwitch).toEqual(full.autoSwitch);
    expect(simple.canHelp).toBe(full.canHelp);
    expect(simple.showHintLayer).toBe(full.showHintLayer);
    // a grown-up who turned the dial to Solve in More gets the kid a Solve it button
    expect(toolbar({ simple: true, mode: "answer" }).askButton).toBe("solve");
    expect(toolbar({ simple: true, mode: "off" }).askButton).toBe(null);
  });

  it("simple board: the pill comes out for a kid who tapped Help me — Solving… or an error and its Retry", () => {
    expect(toolbar({ simple: true, solving: true }).place.pill).toBe("bar");
    expect(toolbar({ simple: true, liveError: true }).place.pill).toBe("bar");
    // with Live off the pill only rests at "Live off": nothing worth the space
    expect(toolbar({ simple: true, liveError: true, liveEnabled: false }).place.pill).toBe("more");
    // and nothing else comes with it
    expect(toolbar({ simple: true, liveError: true }).place).toMatchObject({ dial: "more", auto: "more", ask: "more", ink: "more", report: "more" });
  });

  it("simple board: Ask stays in the bar while the guided tour's coach mark points at it", () => {
    expect(toolbar({ simple: true, tour: true }).place.ask).toBe("bar");
    expect(toolbar({ simple: true, tour: false }).place.ask).toBe("more");
  });

  it("names the action Help, never Draw help", () => {
    expect(LIVE_COPY.pill.help).toBe("Help");
    const strings = JSON.stringify(LIVE_COPY);
    expect(strings).not.toMatch(/draw help|drawn help|sketch/i);
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

  it("gates nothing else: Clear marks and Hide AI shapes act on the canvas, not on Live", () => {
    // A student who switched Live off with their marks hidden must still be able to get
    // them back, so the view exposes exactly one conditional item.
    const off = boardMenuView({ liveEnabled: false, liveAvailable: true });
    expect(Object.keys(off).filter((k) => k.startsWith("show"))).toEqual(["showHandwriting"]);
  });
});
