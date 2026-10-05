import { describe, expect, it } from "vitest";
import type { TLShapeId } from "tldraw";
import type { InkLine, Rect } from "../contracts";
import { nextHelpTarget, penLine, pickedLine, problemCount, problemTarget, type HelpTarget, type HelpTargetDraft } from "../helpTarget";

/**
 * Which problem Help acts on (`src/lib/live/helpTarget.ts`): the line the pen last wrote in, unless
 * the student picked one with the select tool; and what the loop publishes for the outline.
 */

function line(id: string, column: number, row: number, bounds: Rect, strokes: string[] = [`${id}_s1`, `${id}_s2`]): { line: InkLine } {
  return { line: { id, column, row, bounds, strokeIds: strokes as TLShapeId[], hash: "" } };
}

// two problems side by side: A (two lines) on the left, B (one line) on the right
const A1 = line("a1", 0, 0, { x: 100, y: 200, w: 200, h: 40 });
const A2 = line("a2", 0, 1, { x: 100, y: 290, w: 160, h: 40 });
const B1 = line("b1", 1, 0, { x: 700, y: 200, w: 220, h: 40 });
const LINES = { a1: A1, a2: A2, b1: B1 };

describe("penLine: the line the pen last wrote in", () => {
  it("is the line holding the pen's last stroke, wherever Live last read", () => {
    expect(penLine(LINES, "b1_s2", null)).toBe(B1);
    // the line id it was seen in does not matter while the stroke is still on a line (lines re-cluster)
    expect(penLine(LINES, "b1_s2", "a2")).toBe(B1);
  });

  it("that stroke rubbed out: the line it was in, while that line is still there", () => {
    expect(penLine(LINES, "gone", "b1")).toBe(B1);
    expect(penLine(LINES, "gone", "dropped")).toBeNull();
  });

  it("the pen has not written: nothing (the loop falls back to the line read last)", () => {
    expect(penLine(LINES, null, null)).toBeNull();
  });
});

describe("pickedLine: what a tap or a lasso picks", () => {
  it("one line tapped: that line", () => {
    expect(pickedLine([A1])).toBe(A1);
  });

  it("a whole problem lassoed: its lowest line, as the pen's line is the latest", () => {
    expect(pickedLine([A1, A2])).toBe(A2);
    expect(pickedLine([A2, A1])).toBe(A2);
  });

  it("a lasso that clips the problem beside still means the one holding most of it", () => {
    expect(pickedLine([B1, A1, A2])).toBe(A2);
  });

  it("an even split: the lowest line", () => {
    const B2 = line("b2", 1, 1, { x: 700, y: 400, w: 120, h: 40 });
    expect(pickedLine([A1, A2, B1, B2])).toBe(B2);
  });

  it("nothing picked: none", () => {
    expect(pickedLine([])).toBeNull();
  });
});

describe("problemTarget: the box the outline goes around", () => {
  const all = Object.values(LINES);

  it("a column: the union of its lines, keyed by its top line (stable while the student writes on under it)", () => {
    expect(problemTarget(all, 0, null)).toEqual({ key: "c:a1", column: 0, bounds: { x: 100, y: 200, w: 200, h: 130 } });
    expect(problemTarget(all, 1, null)).toEqual({ key: "c:b1", column: 1, bounds: { x: 700, y: 200, w: 220, h: 40 } });
  });

  it("a column under one of the chat's problems: the problem too, keyed by the problem", () => {
    const head = { key: "blk_1", head: { x: 90, y: 100, w: 300, h: 50 } };
    expect(problemTarget(all, 0, head)).toEqual({ key: "p:blk_1", column: 0, bounds: { x: 90, y: 100, w: 300, h: 230 } });
  });

  it("a chat problem with nothing of the student's under it: the problem alone", () => {
    const head = { key: "blk_2", head: { x: 600, y: 100, w: 300, h: 50 } };
    expect(problemTarget(all, null, head)).toEqual({ key: "p:blk_2", column: -1, bounds: head.head });
  });

  it("nothing there: no box", () => {
    expect(problemTarget(all, 7, null)).toBeNull();
    expect(problemTarget([], null, null)).toBeNull();
  });
});

describe("problemCount", () => {
  it("counts columns, and the chat's problems with nothing under them yet", () => {
    expect(problemCount([A1, A2], 0)).toBe(1);
    expect(problemCount([A1, A2, B1], 0)).toBe(2);
    expect(problemCount([A1], 2)).toBe(3);
    expect(problemCount([], 0)).toBe(0);
  });
});

describe("nextHelpTarget: what the loop publishes", () => {
  const draft = (key: string, over: Partial<HelpTargetDraft> = {}): HelpTargetDraft => ({
    key,
    column: 0,
    bounds: { x: 100, y: 200, w: 200, h: 130 },
    by: "pen",
    problems: 2,
    ...over,
  });

  it("appearing (a load, a new screen) is not a move: no moment of outline", () => {
    expect(nextHelpTarget(null, draft("c:a1"), 5000)).toEqual({ ...draft("c:a1"), changedAt: 0 });
  });

  it("moving to another problem stamps the moment", () => {
    const prev: HelpTarget = { ...draft("c:a1"), changedAt: 0 };
    expect(nextHelpTarget(prev, draft("c:b1", { column: 1 }), 9000)?.changedAt).toBe(9000);
  });

  it("moved by the tutor's own work (quiet): the new problem, with no flash of its own", () => {
    const prev: HelpTarget = { ...draft("c:a1"), changedAt: 4000 };
    const next = nextHelpTarget(prev, draft("c:b1", { column: 1 }), 9000, { quiet: true });
    expect(next?.key).toBe("c:b1");
    expect(next?.changedAt).toBe(4000);
  });

  it("the same problem, unchanged: the same object (nothing re-renders at every flush)", () => {
    const prev: HelpTarget = { ...draft("c:a1"), changedAt: 1234 };
    expect(nextHelpTarget(prev, draft("c:a1"), 9000)).toBe(prev);
  });

  it("the same problem grown (a new line under it): new bounds, the moment kept", () => {
    const prev: HelpTarget = { ...draft("c:a1"), changedAt: 1234 };
    const next = nextHelpTarget(prev, draft("c:a1", { bounds: { x: 100, y: 200, w: 200, h: 220 } }), 9000);
    expect(next).not.toBe(prev);
    expect(next).toEqual({ ...draft("c:a1", { bounds: { x: 100, y: 200, w: 200, h: 220 } }), changedAt: 1234 });
  });

  it("nothing to act on: null", () => {
    expect(nextHelpTarget({ ...draft("c:a1"), changedAt: 0 }, null, 9000)).toBeNull();
  });
});
