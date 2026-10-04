import { describe, expect, it } from "vitest";
import type { HelpTarget } from "@/lib/live/helpTarget";
import { HIGHLIGHT, highlightBox, highlightVisible, highlightWakeIn, type HighlightInput } from "../problemHighlightView";

/**
 * When the outline around Help's problem shows (`ProblemHighlight`): only with two or more problems
 * on the screen, and only around an ask — hovered, being answered, or just after the target moved.
 */

const T0 = 1_000_000;

function target(over: Partial<HelpTarget> = {}): HelpTarget {
  return { key: "c:b1", column: 1, bounds: { x: 700, y: 200, w: 220, h: 40 }, by: "pen", problems: 2, changedAt: 0, ...over };
}

function input(over: Partial<HighlightInput> = {}): HighlightInput {
  return { target: target(), hovered: false, askedAt: 0, busy: false, busySince: 0, now: T0, ...over };
}

describe("highlightVisible", () => {
  it("at rest: nothing, however many problems", () => {
    expect(highlightVisible(input())).toBe(false);
    expect(highlightVisible(input({ target: target({ problems: 5 }) }))).toBe(false);
  });

  it("the button hovered or keyboard-focused: shows what it would act on", () => {
    expect(highlightVisible(input({ hovered: true }))).toBe(true);
  });

  it("one problem on the screen: never — there is no question which", () => {
    const one = target({ problems: 1, changedAt: T0 });
    expect(highlightVisible(input({ target: one, hovered: true }))).toBe(false);
    expect(highlightVisible(input({ target: one, askedAt: T0, busy: true, busySince: T0 }))).toBe(false);
  });

  it("nothing to act on: nothing", () => {
    expect(highlightVisible(input({ target: null, hovered: true }))).toBe(false);
  });

  it("the target moved to another problem: a moment, then gone (a touch student sees 'now this one')", () => {
    const moved = target({ changedAt: T0 });
    expect(highlightVisible(input({ target: moved, now: T0 + 200 }))).toBe(true);
    expect(highlightVisible(input({ target: moved, now: T0 + HIGHLIGHT.changeMs - 1 }))).toBe(true);
    expect(highlightVisible(input({ target: moved, now: T0 + HIGHLIGHT.changeMs }))).toBe(false);
  });

  it("asked: a moment even when the answer is instant (the engine, by hand)", () => {
    expect(highlightVisible(input({ askedAt: T0, now: T0 + 100 }))).toBe(true);
    expect(highlightVisible(input({ askedAt: T0, now: T0 + HIGHLIGHT.askMs + 1 }))).toBe(false);
  });

  it("asked: for as long as the check or solve it opened is open", () => {
    const answering = input({ askedAt: T0, busy: true, busySince: T0 + 300 });
    expect(highlightVisible({ ...answering, now: T0 + 12_000 })).toBe(true);
    expect(highlightVisible({ ...answering, busy: false, now: T0 + 12_000 })).toBe(false);
  });

  it("a check already open when they asked carries their ask too", () => {
    expect(highlightVisible(input({ askedAt: T0, busy: true, busySince: T0 - 800, now: T0 + 5_000 }))).toBe(true);
  });

  it("a check that opened long after the ask was answered is not that ask's", () => {
    expect(highlightVisible(input({ askedAt: T0, busy: true, busySince: T0 + 30_000, now: T0 + 31_000 }))).toBe(false);
  });
});

describe("highlightWakeIn", () => {
  it("wakes when the moment after a move or an ask runs out, whichever is first", () => {
    expect(highlightWakeIn(input({ target: target({ changedAt: T0 }), now: T0 + 500 }))).toBe(HIGHLIGHT.changeMs - 500);
    expect(highlightWakeIn(input({ target: target({ changedAt: T0 }), askedAt: T0 + 1000, now: T0 + 1200 }))).toBe(HIGHLIGHT.changeMs - 1200);
  });

  it("nothing timed: no wake (hover and the open call end by themselves)", () => {
    expect(highlightWakeIn(input())).toBeNull();
    expect(highlightWakeIn(input({ hovered: true, askedAt: T0 - 60_000, busy: true }))).toBeNull();
    expect(highlightWakeIn(input({ target: null }))).toBeNull();
  });
});

describe("highlightBox", () => {
  it("the page box through the camera, inside the board's container, padded", () => {
    // zoomed to 2x, the page origin at screen (40, 60), the container at (10, 20)
    const toScreen = (p: { x: number; y: number }) => ({ x: 40 + p.x * 2, y: 60 + p.y * 2 });
    expect(highlightBox({ x: 100, y: 200, w: 50, h: 20 }, toScreen, { x: 10, y: 20 }, 8)).toEqual({ left: 222, top: 432, width: 116, height: 56 });
  });
});
