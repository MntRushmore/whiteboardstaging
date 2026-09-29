import { describe, expect, it } from "vitest";
import type { Rect } from "../../contracts";
import { planFigure } from "../../figureDraw";
import { wallMsOf } from "../../handwriting";
import { freeAreas, layoutClearOf, layoutTeach, TEACH_LAYOUT, teachArea, type TeachLayout } from "../teachLayout";
import { LINEAR_TEACH, OWNER_FIGURE, OWNER_TEACH } from "./teachFixtures";

/**
 * Where a worked solution goes on a 1600×900 screen (`layoutTeach`): inside the screen's margins,
 * nothing on anything else, the figure top right, the steps in reading order down the left, every
 * chain's `=` in one column, the answer boxed under the last step, written within its time.
 */

const SCREEN: Rect = { x: 0, y: 0, w: 1600, h: 900 };
const AREA = teachArea(SCREEN);
const steps = (t: typeof OWNER_TEACH) => t.steps.map((s) => ({ say: s.say, math: s.math ?? [] }));
const figure = (box: { w: number; h: number }) => planFigure(OWNER_FIGURE, { seed: 5, box })?.plan ?? null;

const inside = (r: Rect, a: Rect, tol = 4) => r.x >= a.x - tol && r.y >= a.y - tol && r.x + r.w <= a.x + a.w + tol && r.y + r.h <= a.y + a.h + tol;
const overlap = (a: Rect, b: Rect) => a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;

function expectClean(layout: TeachLayout, area: Rect) {
  for (const p of layout.pieces) expect(inside(p.rect, area), `${p.kind} ${p.latex ?? ""} off the area`).toBe(true);
  // no two pieces touch (the answer sits inside its own box)
  const pieces = layout.pieces.filter((p) => p.kind !== "box");
  for (let i = 0; i < pieces.length; i++) {
    for (let j = i + 1; j < pieces.length; j++) expect(overlap(pieces[i].rect, pieces[j].rect), `${pieces[i].kind} ${pieces[i].latex ?? ""} × ${pieces[j].kind} ${pieces[j].latex ?? ""}`).toBe(false);
  }
}

describe("layoutTeach", () => {
  it("the owner's solution fits one screen: figure top right, steps in order down the left, nothing overlapping, answer boxed last", () => {
    const layout = layoutTeach({ area: AREA, steps: steps(OWNER_TEACH), answer: OWNER_TEACH.answer, figure, seed: 42 })!;
    expect(layout).not.toBeNull();
    expect(layout.rest).toBe(OWNER_TEACH.steps.length);
    expect(layout.figure).not.toBeNull();
    expect(layout.answer).not.toBeNull();
    expect(layout.size).toBeGreaterThanOrEqual(31);
    expectClean(layout, AREA);
    const fig = layout.pieces.find((p) => p.kind === "figure")!.rect;
    // top right
    expect(fig.x + fig.w).toBeGreaterThan(AREA.x + AREA.w - 8);
    expect(fig.y).toBeLessThan(AREA.y + 8);
    // the steps in reading order: each step's first piece below the last one's (same column) or in a later column
    const firsts = [1, 2, 3, 4].map((s) => layout.pieces.find((p) => p.step === s)!.rect);
    for (let k = 1; k < firsts.length; k++) expect(firsts[k].y > firsts[k - 1].y || firsts[k].x > firsts[k - 1].x + 100).toBe(true);
    // the answer after the last step, with its box round it
    const answer = layout.pieces.find((p) => p.kind === "answer")!.rect;
    const box = layout.pieces.find((p) => p.kind === "box")!.rect;
    const lastLine = [...layout.pieces].reverse().find((p) => p.kind === "math")!.rect;
    expect(answer.y).toBeGreaterThan(lastLine.y + lastLine.h);
    expect(box.x).toBeLessThan(answer.x);
    expect(box.y).toBeLessThan(answer.y);
    expect(box.x + box.w).toBeGreaterThan(answer.x + answer.w);
    expect(box.y + box.h).toBeGreaterThan(answer.y + answer.h);
  });

  it("a chain's `=` line up in one column; its sentence is smaller than its maths", () => {
    const layout = layoutTeach({ area: AREA, steps: steps(OWNER_TEACH), answer: OWNER_TEACH.answer, figure, seed: 42 })!;
    for (const step of [2, 4]) {
      const rels = layout.pieces.filter((p) => p.step === step && p.kind === "math").map((p) => p.relX!);
      expect(rels.length).toBeGreaterThanOrEqual(5);
      expect(Math.max(...rels) - Math.min(...rels), `step ${step}: ${rels.map((r) => r.toFixed(1)).join(", ")}`).toBeLessThan(6);
    }
    expect(layout.wordsSize).toBeLessThan(layout.size);
    expect(layout.wordsSize).toBeGreaterThanOrEqual(TEACH_LAYOUT.minWords);
  });

  it("equations solved over several steps keep one column of `=` down the whole solution", () => {
    const layout = layoutTeach({ area: AREA, steps: steps(LINEAR_TEACH), answer: LINEAR_TEACH.answer, seed: 7 })!;
    expectClean(layout, AREA);
    const rels = layout.pieces.filter((p) => p.kind === "math").map((p) => p.relX!);
    expect(rels).toHaveLength(4);
    expect(Math.max(...rels) - Math.min(...rels)).toBeLessThan(6);
    // no figure asked for: none drawn, the largest hand
    expect(layout.figure).toBeNull();
    expect(layout.size).toBe(TEACH_LAYOUT.sizes[0]);
  });

  it("beside other work: one column, the figure top right of the room, the text beside and under it", () => {
    const room = { x: 600, y: AREA.y, w: AREA.x + AREA.w - 600, h: AREA.h };
    const layout = layoutTeach({ area: room, steps: steps(OWNER_TEACH), answer: OWNER_TEACH.answer, figure, seed: 42 })!;
    expect(layout.rest).toBe(OWNER_TEACH.steps.length);
    expectClean(layout, room);
    expect(layout.pieces.every((p) => p.rect.x >= 600 - 4)).toBe(true);
  });

  it("free room beside what is on a screen: right of it, under it, left of it — large enough to teach in", () => {
    const taken: Rect[] = [{ x: 60, y: 90, w: 460, h: 380 }];
    const rooms = freeAreas(AREA, taken);
    expect(rooms.length).toBeGreaterThan(0);
    for (const r of rooms) {
      expect(overlap(r, taken[0])).toBe(false);
      expect(r.w).toBeGreaterThanOrEqual(TEACH_LAYOUT.minArea.w);
    }
    expect(freeAreas(AREA, [])).toEqual([AREA]);
    // a screen covered corner to corner has none
    expect(freeAreas(AREA, [AREA])).toEqual([]);
    const layout = layoutTeach({ area: rooms[0], steps: steps(LINEAR_TEACH), answer: LINEAR_TEACH.answer, seed: 3 })!;
    expect(layoutClearOf(layout, taken)).toBe(true);
    expect(layoutClearOf(layout, [layout.pieces[0].rect])).toBe(false);
  });

  it("too long for one screen even at the smallest hand: the steps that fit, and where the next screen starts", () => {
    const long = Array.from({ length: 8 }, (_, i) => ({ say: `Step ${i + 1}: simplify the next part of the expression, one small step.`, math: ["y = (x + 1)^{2} - (x - 1)^{2}", "= x^{2} + 2x + 1 - (x^{2} - 2x + 1)", "= 4x", "= 4(3)", "= 12", "= 12"] }));
    const layout = layoutTeach({ area: AREA, steps: long, answer: "y = 12", seed: 9 })!;
    expect(layout).not.toBeNull();
    expect(layout.rest).toBeGreaterThan(0);
    expect(layout.rest).toBeLessThan(long.length);
    expect(layout.answer).toBeNull();
    // the largest hand that fits as many steps as any
    expect(layout.size).toBeLessThan(TEACH_LAYOUT.sizes[0]);
    expectClean(layout, AREA);
    // the rest on the next screen, the answer with it
    const next = layoutTeach({ area: AREA, steps: long.slice(layout.rest), answer: "y = 12", seed: 10 })!;
    expect(next.rest).toBe(long.length - layout.rest);
    expect(next.answer).not.toBeNull();
  });

  it("paced like a person teaching: each step a few seconds, the whole within its budget", () => {
    const layout = layoutTeach({ area: AREA, steps: steps(OWNER_TEACH), answer: OWNER_TEACH.answer, figure, seed: 42 })!;
    for (const s of layout.steps) expect(wallMsOf(s)).toBeLessThanOrEqual(TEACH_LAYOUT.pace.maxWallMs + 1);
    const total = layout.steps.reduce((t, s) => t + wallMsOf(s), 0) + wallMsOf(layout.answer!);
    expect(total).toBeLessThanOrEqual(TEACH_LAYOUT.pace.totalMaxWallMs + 1);
    expect(total).toBeGreaterThan(6000);
  });
});
