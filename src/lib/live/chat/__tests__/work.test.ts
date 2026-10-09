import { describe, expect, it } from "vitest";
import type { Rect } from "../../contracts";
import { normalizeStep } from "../../liveLoop";
import { CHAT_PROBLEM_META, problemLines, type ProblemCell } from "../cells";
import { currentProblem, pickForSolve, pickForStep, placeInCell, problemLineId, problemSteps, WORK_PLACE, type ProblemState } from "../work";

const cell = (key: string, n: number, lines: string[], at: Rect): ProblemCell => ({ key, n, lines, head: { x: at.x + 14, y: at.y + 14, w: 300, h: 50 }, cell: at });
const ONE = cell("hb_1", 1, ["2x + 3 = 11"], { x: 48, y: 72, w: 500, h: 400 });
const TWO = cell("hb_2", 2, ["3x = 12"], { x: 548, y: 72, w: 500, h: 400 });
const THREE = cell("hb_3", 3, ["x + 8 = 12"], { x: 1048, y: 72, w: 500, h: 400 });
const CELLS = [ONE, TWO, THREE];
const open: ProblemState = { work: false, solved: false, started: false };
const states = (s: Record<string, Partial<ProblemState>>) => (c: ProblemCell): ProblemState => ({ ...open, ...s[c.key] });

describe("which problem the tutor works", () => {
  it("the current problem: the one the student last wrote in, else the first with nothing under it", () => {
    expect(currentProblem(CELLS, null, states({}))).toBe(ONE);
    expect(currentProblem(CELLS, "hb_2", states({}))).toBe(TWO);
    // a touched problem that is gone from the screen does not count
    expect(currentProblem(CELLS, "hb_9", states({}))).toBe(ONE);
    expect(currentProblem(CELLS, null, states({ hb_1: { solved: true }, hb_2: { work: true } }))).toBe(THREE);
    expect(currentProblem(CELLS, null, states({ hb_1: { solved: true }, hb_2: { solved: true }, hb_3: { work: true } }))).toBeNull();
    expect(currentProblem([], null, states({}))).toBeNull();
  });

  it("Solve: the student's work first; a solved problem moves on to the next open one, then to nothing", () => {
    expect(pickForSolve(CELLS, null, states({}))).toEqual({ kind: "tutor", cell: ONE });
    expect(pickForSolve(CELLS, "hb_2", states({ hb_2: { work: true } }))).toEqual({ kind: "student", cell: TWO });
    expect(pickForSolve(CELLS, "hb_2", states({ hb_2: { solved: true } }))).toEqual({ kind: "tutor", cell: THREE });
    // after the last, round to the first
    expect(pickForSolve(CELLS, "hb_3", states({ hb_3: { solved: true } }))).toEqual({ kind: "tutor", cell: ONE });
    expect(pickForSolve(CELLS, "hb_1", states({ hb_1: { solved: true }, hb_2: { solved: true }, hb_3: { work: true } }))).toEqual({ kind: "none" });
  });

  it("a step never moves on to another problem", () => {
    expect(pickForStep(CELLS, null, states({}))).toEqual({ kind: "tutor", cell: ONE });
    expect(pickForStep(CELLS, "hb_1", states({ hb_1: { started: true } }))).toEqual({ kind: "tutor", cell: ONE });
    expect(pickForStep(CELLS, "hb_2", states({ hb_2: { work: true } }))).toEqual({ kind: "student", cell: TWO });
    expect(pickForStep(CELLS, null, states({ hb_1: { solved: true }, hb_2: { solved: true }, hb_3: { solved: true } }))).toEqual({ kind: "none" });
  });

  it("a problem the tutor is writing now is the one an ask is about: never the next one meanwhile", () => {
    // writing problem 1 (its state says solved and started, as the loop reports a busy problem)
    const writing = { solved: true, started: true, busy: true };
    expect(pickForSolve(CELLS, null, states({ hb_1: writing }))).toEqual({ kind: "busy", cell: ONE });
    expect(pickForStep(CELLS, null, states({ hb_1: writing }))).toEqual({ kind: "busy", cell: ONE });
    expect(currentProblem(CELLS, null, states({ hb_1: { solved: true }, hb_2: writing }))).toBe(TWO);
    // a problem the student wrote under (or picked) still wins: that ask is about it
    expect(pickForSolve(CELLS, "hb_3", states({ hb_1: writing }))).toEqual({ kind: "tutor", cell: THREE });
    // written out: the next ask is the next problem, as before
    expect(pickForSolve(CELLS, null, states({ hb_1: { solved: true, started: true } }))).toEqual({ kind: "tutor", cell: TWO });
  });

  it("a problem the student has answered is not the current one: the next one still to do is", () => {
    const FOUR = cell("hb_4", 4, ["5 + 3"], { x: 48, y: 472, w: 500, h: 400 });
    const GRID = [ONE, TWO, THREE, FOUR];
    // 1 answered (ticked): Help is about 2, the next in reading order — Solve and a step alike
    expect(currentProblem(GRID, "hb_1", states({ hb_1: { work: true, done: true } }))).toBe(TWO);
    expect(pickForStep(GRID, "hb_1", states({ hb_1: { work: true, done: true } }))).toEqual({ kind: "tutor", cell: TWO });
    expect(pickForSolve(GRID, "hb_1", states({ hb_1: { work: true, done: true } }))).toEqual({ kind: "tutor", cell: TWO });
    // 2 already given its step by the tutor (started, not worked out): still 2 — a second tap never goes back to 1
    expect(pickForStep(GRID, "hb_1", states({ hb_1: { work: true, done: true }, hb_2: { started: true } }))).toEqual({ kind: "tutor", cell: TWO });
    // 2 answered too, and 3 worked out by the tutor: 4
    expect(currentProblem(GRID, "hb_2", states({ hb_1: { work: true, done: true }, hb_2: { work: true, done: true }, hb_3: { solved: true } }))).toBe(FOUR);
    // a problem with a wrong answer under it is still to do: its work gets the help
    expect(pickForStep(GRID, "hb_1", states({ hb_1: { work: true, done: true }, hb_2: { work: true } }))).toEqual({ kind: "student", cell: TWO });
    // the pen's last stroke is under 3 (an `=` started there, no line yet): 3, the one nearest it
    expect(currentProblem(GRID, "hb_1", states({ hb_1: { work: true, done: true } }), "hb_3")).toBe(THREE);
    // ...but not when 3 is answered too, nor when the pen is still in the answered one
    expect(currentProblem(GRID, "hb_1", states({ hb_1: { work: true, done: true }, hb_3: { work: true, done: true } }), "hb_3")).toBe(TWO);
    expect(currentProblem(GRID, "hb_1", states({ hb_1: { work: true, done: true } }), "hb_1")).toBe(TWO);
    // after the last, round to the first still to do
    expect(currentProblem(GRID, "hb_4", states({ hb_4: { work: true, done: true }, hb_1: { work: true, done: true } }))).toBe(TWO);
    // every problem answered: nothing, never the answered one again
    const all = states({ hb_1: { work: true, done: true }, hb_2: { work: true, done: true }, hb_3: { work: true, done: true }, hb_4: { work: true, done: true } });
    expect(currentProblem(GRID, "hb_2", all)).toBeNull();
    expect(pickForStep(GRID, "hb_2", all)).toEqual({ kind: "none" });
    expect(pickForSolve(GRID, "hb_2", all)).toEqual({ kind: "none" });
  });

  it("the tutor's work on a problem has a line id of its own, stable across a reload", () => {
    expect(problemLineId(ONE)).toBe("problem:hb_1");
  });
});

describe("the steps it writes", () => {
  const TRIG = ["0^{\\circ} \\le x < 360^{\\circ}", "2\\sin x = 1", "\\sin x = \\frac{1}{2}", "\\sin^{-1}\\left(\\frac{1}{2}\\right) = 30^{\\circ}", "x = 30^{\\circ}, \\ x = 150^{\\circ}"];
  const base = { solution: TRIG, head: ["2\\sin x = 1"], written: [] as string[], normalize: normalizeStep };

  it("solve: the whole solution, without writing the problem out again", () => {
    expect(problemSteps({ ...base, depth: "solve" })).toEqual([TRIG[0], TRIG[2], TRIG[3], TRIG[4]]);
  });

  it("the first step is the first a student would get a tick for; each next one follows the tutor's last", () => {
    const ticked = (s: string) => s === "\\sin x = \\frac{1}{2}";
    expect(problemSteps({ ...base, depth: "step", ticked })).toEqual(["\\sin x = \\frac{1}{2}"]);
    // without the engine's say, simply the first
    expect(problemSteps({ ...base, depth: "step" })).toEqual([TRIG[0]]);
    expect(problemSteps({ ...base, depth: "step", ticked, written: ["\\sin x = \\frac{1}{2}"] })).toEqual([TRIG[3]]);
    // the rest after a step; nothing after the last line
    expect(problemSteps({ ...base, depth: "solve", written: ["\\sin x=\\frac{1}{2}"] })).toEqual([TRIG[3], TRIG[4]]);
    expect(problemSteps({ ...base, depth: "step", written: [TRIG[4]] })).toEqual([]);
    expect(problemSteps({ ...base, depth: "solve", written: [TRIG[4]] })).toEqual([]);
  });
});

describe("where it writes", () => {
  const CELL: Rect = { x: 0, y: 0, w: 600, h: 400 };

  it("under what is there, at the problem's left edge, moved down past ink in the way", () => {
    expect(placeInCell({ w: 200, h: 80 }, { x: 40, y: 100 }, CELL, [])).toEqual({ x: 40, y: 100, w: 200, h: 80 });
    const ink = { x: 30, y: 120, w: 60, h: 40 };
    const slot = placeInCell({ w: 200, h: 80 }, { x: 40, y: 100 }, CELL, [ink])!;
    expect(slot.x).toBe(40);
    expect(slot.y).toBe(160 + WORK_PLACE.gap / 2);
  });

  it("the column blocked to the bottom of the cell: a little to the right; no room at all: null", () => {
    const wall = { x: 0, y: 90, w: 60, h: 310 };
    const slot = placeInCell({ w: 200, h: 80 }, { x: 40, y: 100 }, CELL, [wall])!;
    expect(slot.x).toBeGreaterThanOrEqual(60);
    expect(slot.y).toBe(100);
    expect(placeInCell({ w: 700, h: 80 }, { x: 40, y: 100 }, CELL, [])).toBeNull();
    expect(placeInCell({ w: 200, h: 350 }, { x: 40, y: 100 }, CELL, [])).toBeNull();
    expect(placeInCell({ w: 200, h: 80 }, { x: 40, y: 100 }, CELL, [{ x: 0, y: 90, w: 600, h: 310 }])).toBeNull();
  });

  it("a problem's lines, each where the hand wrote it, without its number", () => {
    const meta = (lines: string[]) => ({ [CHAT_PROBLEM_META]: { n: 4, lines, cell: { x: 0, y: 0, w: 600, h: 400 } } });
    const sys = ["x + y = 10", "x - y = 2"];
    const c = cell("hb_9", 4, sys, { x: 0, y: 0, w: 600, h: 400 });
    const shapes = [
      { block: "hb_9", meta: meta(sys), bounds: { x: 14, y: 20, w: 30, h: 40 }, line: "4." },
      { block: "hb_9", meta: meta(sys), bounds: { x: 60, y: 20, w: 40, h: 40 }, line: "x + y = 10" },
      { block: "hb_9", meta: meta(sys), bounds: { x: 110, y: 22, w: 90, h: 36 }, line: "x + y = 10" },
      { block: "hb_9", meta: meta(sys), bounds: { x: 60, y: 90, w: 140, h: 40 }, line: "x - y = 2" },
      // another problem's stroke with the same line is not this one's
      { block: "hb_8", meta: meta(sys), bounds: { x: 900, y: 20, w: 40, h: 40 }, line: "x + y = 10" },
    ];
    expect(problemLines(shapes, c)).toEqual([
      { x: 60, y: 20, w: 140, h: 40 },
      { x: 60, y: 90, w: 140, h: 40 },
    ]);
    // a line with no stroke (typeset, or rubbed out) is the head
    expect(problemLines(shapes.slice(0, 3), c)[1]).toEqual(c.head);
  });
});
