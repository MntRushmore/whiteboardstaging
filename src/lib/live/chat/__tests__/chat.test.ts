import { beforeAll, describe, expect, it } from "vitest";
import type { InkLine, LiveEngine, Rect } from "../../contracts";
import { getEngine } from "../../engine";
import { planHandwriting } from "../../handwriting";
import { cellOf, readProblemCells, splitColumnsAtProblems, CHAT_PROBLEM_META, type ProblemCell } from "../cells";
import { ChatActionSchema, ChatRequestSchema, ChatResponseSchema } from "../contracts";
import { figureProblems, PROBE_FIGURE } from "../figure";
import { chunkProblems, findFreeArea, gridCells, gridShape, joinPlans, planGrid, PROBLEM_GRID } from "../layout";
import { hasWords, isChain, isCleanAnswer, stepHolds, verifyLines, verifyProblem } from "../verify";

let engine: LiveEngine;
beforeAll(async () => {
  engine = await getEngine();
});

const SCREEN: Rect = { x: 0, y: 0, w: 1600, h: 900 };

describe("chat contracts", () => {
  it("a request: the message, a few turns and the screen picture", () => {
    const req = ChatRequestSchema.parse({ boardId: "b", message: " 5 two-step equations ", screen: { empty: true } });
    expect(req.message).toBe("5 two-step equations");
    expect(req.history).toEqual([]);
    expect(req.screen).toEqual({ empty: true, student: [], tutor: [], problems: [] });
    expect(ChatRequestSchema.safeParse({ boardId: "b", message: "", screen: { empty: true } }).success).toBe(false);
    expect(ChatRequestSchema.safeParse({ boardId: "b", message: "x", history: Array(7).fill({ role: "user", text: "a" }), screen: { empty: true } }).success).toBe(false);
  });

  it("every action type parses; problems come out as lists of lines (a system is one problem)", () => {
    const a = ChatActionSchema.parse({ type: "write_problems", problems: ["2x + 3 = 11", ["x + y = 10", "x - y = 2"]] });
    expect(a).toEqual({ type: "write_problems", problems: [["2x + 3 = 11"], ["x + y = 10", "x - y = 2"]] });
    for (const ok of [
      { type: "write_lines", lines: ["x = \\frac{-b \\pm \\sqrt{b^{2} - 4ac}}{2a}"] },
      { type: "graph", relations: ["y = \\sin x"], window: { xMin: -6.28, xMax: 6.28 } },
      { type: "draw_figure", figure: PROBE_FIGURE },
      { type: "new_screen" },
      { type: "clear_tutor" },
    ]) {
      expect(ChatActionSchema.safeParse(ok).success, ok.type).toBe(true);
    }
  });

  it("no words on the board, no $, no empty problem sets, a window the right way round", () => {
    expect(ChatActionSchema.safeParse({ type: "write_problems", problems: ["\\text{Solve: } 2x = 4"] }).success).toBe(false);
    expect(ChatActionSchema.safeParse({ type: "write_problems", problems: ["$2x = 4$"] }).success).toBe(false);
    expect(ChatActionSchema.safeParse({ type: "write_problems", problems: [] }).success).toBe(false);
    expect(ChatActionSchema.safeParse({ type: "write_problems", problems: Array(13).fill("x = 1") }).success).toBe(false);
    expect(ChatActionSchema.safeParse({ type: "graph", relations: ["y = x"], window: { xMin: 2, xMax: -2 } }).success).toBe(false);
    expect(ChatActionSchema.safeParse({ type: "paint" }).success).toBe(false);
    // \mathrm{d}x is maths, \mathrm{area} is a word
    expect(ChatActionSchema.safeParse({ type: "write_lines", lines: ["\\int x \\, \\mathrm{d}x"] }).success).toBe(true);
    expect(ChatActionSchema.safeParse({ type: "write_lines", lines: ["\\mathrm{area} = \\pi r^{2}"] }).success).toBe(false);
  });

  it("a response round-trips (the client parses what the route sends)", () => {
    const res = ChatResponseSchema.parse({ reply: "Here are 2.", actions: [{ type: "write_problems", problems: [["2x = 4"], ["3x = 9"]] }], model: "m", ms: 5 });
    expect(res.notes).toEqual([]);
    expect(ChatResponseSchema.parse(JSON.parse(JSON.stringify(res)))).toEqual(res);
  });
});

describe("verifying what a model proposed", () => {
  it.each([
    [["2x + 3 = 11"]],
    [["x^{2} + 5x + 6"]],
    [["x^{2} - 4x - 12 = 0"]],
    [["2x + 1 < 7"]],
    [["\\frac{d}{dx}(x^{3} + 2x)"]],
    [["\\int (3x^{2} + 1) \\, dx"]],
    [["\\lim_{x \\to 2} \\frac{x^{2} - 4}{x - 2}"]],
    [["\\frac{3}{4} + \\frac{1}{6}"]],
    [["x + y = 10", "x - y = 2"]],
    [["3^{2} + 4^{2} = c^{2}"]],
    [["|x - 3| = 5"]],
  ])("%j is a problem the engine solves", (lines) => {
    const v = verifyProblem(engine, lines);
    expect(v.ok).toBe(true);
    if (v.ok) expect(v.steps.length).toBeGreaterThan(0);
  });

  it("refuses words, a false statement, a line it cannot read and one nothing solves", () => {
    expect(verifyProblem(engine, ["\\text{Solve } 2x = 4"])).toEqual({ ok: false, reason: "words" });
    expect(verifyProblem(engine, ["2 + 2 = 5"])).toEqual({ ok: false, reason: "false" });
    expect(verifyProblem(engine, ["y = 2x - 5"])).toEqual({ ok: false, reason: "unsolved" });
    expect(verifyProblem(engine, [""])).toEqual({ ok: false, reason: "unreadable" });
    expect(verifyProblem(engine, ["2x + 3 = 11"], () => false)).toEqual({ ok: false, reason: "unwritable" });
  });

  it("lines as given: a formula the engine cannot judge is written; a false step is not", () => {
    expect(verifyLines(engine, ["x = \\frac{-b \\pm \\sqrt{b^{2} - 4ac}}{2a}"])).toEqual({ ok: true });
    expect(verifyLines(engine, ["a^{2} + b^{2} = c^{2}"])).toEqual({ ok: true });
    expect(verifyLines(engine, ["x^{2} + 6x + 5 = 0", "x^{2} + 6x = -5", "x^{2} + 6x + 9 = 5"])).toEqual({ ok: false, reason: "false" });
    expect(verifyLines(engine, ["\\text{area} = \\pi r^{2}"])).toEqual({ ok: false, reason: "words" });
  });

  it("words are spotted outside commands only", () => {
    expect(hasWords("\\frac{\\sqrt{x}}{\\left(x + 1\\right)}")).toBe(false);
    expect(hasWords("\\varnothing")).toBe(false);
    expect(hasWords("\\text{area}")).toBe(true);
    expect(hasWords("solve 2x = 4")).toBe(true);
  });

  it("a clean answer has no long decimals or approximations", () => {
    expect(isCleanAnswer("x = 4")).toBe(true);
    expect(isCleanAnswer("x = \\frac{3}{2}")).toBe(true);
    expect(isCleanAnswer("x \\approx 1.414")).toBe(false);
    expect(isCleanAnswer("x = 2.2361")).toBe(false);
  });
});

describe("algebra proofs are maths lines, every step checked equal", () => {
  it("a chain: each line starting with = under an expression", () => {
    expect(isChain(["(a + b)^{2}", "= a^{2} + 2ab + b^{2}"])).toBe(true);
    expect(isChain(["x^{2} + 6x + 5 = 0", "= 0"])).toBe(false);
    expect(isChain(["a^{2} + b^{2} = c^{2}"])).toBe(false);
  });

  it("every step equal: the sum of two odd numbers, (a + b)², the square of an odd number", () => {
    expect(verifyLines(engine, ["(2m + 1) + (2n + 1)", "= 2m + 2n + 2", "= 2(m + n + 1)"])).toEqual({ ok: true });
    expect(verifyLines(engine, ["(a + b)^{2}", "= (a + b)(a + b)", "= a^{2} + ab + ba + b^{2}", "= a^{2} + 2ab + b^{2}"])).toEqual({ ok: true });
    expect(verifyLines(engine, ["(2k + 1)^{2}", "= 4k^{2} + 4k + 1", "= 2(2k^{2} + 2k) + 1"])).toEqual({ ok: true });
  });

  it("a false step drops the block; one the engine cannot confirm too", () => {
    // the engine alone does not flag these (several letters): the step check does
    expect(verifyLines(engine, ["(a + b)^{2}", "= a^{2} + b^{2}"])).toEqual({ ok: false, reason: "false" });
    expect(verifyLines(engine, ["(2m + 1) + (2n + 1)", "= 2m + 2n + 1"])).toEqual({ ok: false, reason: "false" });
    expect(stepHolds(engine, "x_{1} + x_{2}", "x_{2} + x_{1}")).toBe("unknown");
    expect(stepHolds(engine, "a + b + c + d + f", "f + d + c + b + a")).toBe("unknown");
    expect(stepHolds(engine, "(m + n)^{2}", "m^{2} + 2mn + n^{2}")).toBe("ok");
    // calculus is not put through the substitution: the engine's own column check judges it, as before
    expect(verifyLines(engine, ["\\frac{d}{dx}(x^{2})", "= 2x"])).toEqual({ ok: true });
  });
});

describe("the problem grid", () => {
  it("problems per screen: at most six, spread evenly", () => {
    expect(chunkProblems(5)).toEqual([5]);
    expect(chunkProblems(6)).toEqual([6]);
    expect(chunkProblems(8)).toEqual([4, 4]);
    expect(chunkProblems(12)).toEqual([6, 6]);
    expect(chunkProblems(7)).toEqual([4, 3]);
    expect(chunkProblems(0)).toEqual([]);
  });

  it("grid shapes: 1–3 side by side, 4 as 2×2, 5–6 as 3×2", () => {
    expect([1, 2, 3, 4, 5, 6].map((n) => gridShape(n))).toEqual([
      { cols: 1, rows: 1 },
      { cols: 2, rows: 1 },
      { cols: 3, rows: 1 },
      { cols: 2, rows: 2 },
      { cols: 3, rows: 2 },
      { cols: 3, rows: 2 },
    ]);
  });

  it("cells tile the screen inside its margins, in reading order, with room under the bar", () => {
    const cells = gridCells(SCREEN, 3, 2);
    expect(cells).toHaveLength(6);
    expect(cells[0]).toMatchObject({ x: PROBLEM_GRID.marginX, y: PROBLEM_GRID.marginTop });
    expect(cells[1].x).toBeGreaterThan(cells[0].x);
    expect(cells[3].y).toBeGreaterThan(cells[0].y);
    const last = cells[5];
    expect(last.x + last.w).toBeCloseTo(SCREEN.w - PROBLEM_GRID.marginX, 6);
    expect(last.y + last.h).toBeCloseTo(SCREEN.h - PROBLEM_GRID.marginBottom, 6);
    // ~400 px under each problem to work in
    expect(cells[0].h).toBeGreaterThan(380);
  });

  it("a problem too wide for three columns gets two; one too wide for any shrinks the hand", () => {
    expect(planGrid(SCREEN, 6, () => 300)).toMatchObject({ cols: 3, rows: 2, size: PROBLEM_GRID.size });
    expect(planGrid(SCREEN, 6, (i) => (i === 2 ? 600 : 300))).toMatchObject({ cols: 2, rows: 3 });
    const shrunk = planGrid(SCREEN, 1, (_, size) => size * 40);
    expect(shrunk?.cols).toBe(1);
    expect(shrunk!.size).toBeLessThan(PROBLEM_GRID.size);
    expect(planGrid(SCREEN, 1, () => 5000)).toBeNull();
  });

  it("free space: the first gap in reading order, clear of what is there; null when full", () => {
    expect(findFreeArea({ w: 300, h: 200 }, SCREEN, [])).toEqual({ x: 56, y: 80, w: 300, h: 200 });
    const work = { x: 30, y: 60, w: 600, h: 500 };
    const slot = findFreeArea({ w: 300, h: 200 }, SCREEN, [work])!;
    expect(slot.x).toBeGreaterThanOrEqual(work.x + work.w);
    expect(findFreeArea({ w: 300, h: 200 }, SCREEN, [SCREEN])).toBeNull();
  });

  it("joined plans keep their places and run one after the other", () => {
    const a = planHandwriting(["1."], { size: 40, seed: 1 }).plan!;
    const b = planHandwriting(["2x + 3 = 11"], { size: 40, seed: 2 }).plan!;
    const moved = { ...b, lines: b.lines.map((l) => ({ ...l, x: l.x + 60 })), bounds: { ...b.bounds, x: b.bounds.x + 60 } };
    const joined = joinPlans([a, moved], 250)!;
    expect(joined.lines).toHaveLength(2);
    expect(joined.lines[1].startMs).toBeCloseTo(a.totalMs + 250, 6);
    expect(joined.totalMs).toBeCloseTo(a.totalMs + 250 + b.totalMs, 6);
    expect(joined.bounds.x).toBe(0);
    expect(joined.bounds.w).toBeCloseTo(moved.bounds.x + moved.bounds.w, 6);
  });
});

describe("the columns under the chat's problems", () => {
  const cell = (n: number, x: number, y: number, lines = ["2x + 3 = 11"]): ProblemCell => ({
    key: `hb_${n}`,
    n,
    lines,
    head: { x: x + 14, y: y + 14, w: 200, h: 30 },
    cell: { x, y, w: 500, h: 400 },
  });
  const line = (id: string, x: number, y: number, column: number, row: number): InkLine => ({ id, strokeIds: [], bounds: { x, y, w: 150, h: 40 }, column, row, hash: "" });

  it("reads the cells back from the problem strokes, one per block, head round all its ink", () => {
    const meta = (n: number) => ({ [CHAT_PROBLEM_META]: { n, lines: ["2x = 8"], cell: { x: 0, y: 0, w: 500, h: 400 } } });
    const cells = readProblemCells([
      { block: "hb_1", meta: meta(1), bounds: { x: 20, y: 20, w: 10, h: 30 } },
      { block: "hb_1", meta: meta(1), bounds: { x: 60, y: 22, w: 100, h: 28 } },
      { block: "hb_x", meta: { live: true }, bounds: { x: 0, y: 0, w: 5, h: 5 } },
    ]);
    expect(cells).toHaveLength(1);
    expect(cells[0]).toMatchObject({ n: 1, lines: ["2x = 8"], head: { x: 20, y: 20, w: 140, h: 30 } });
  });

  it("a line under a problem (or beside it) is in its cell; one above it or elsewhere is not", () => {
    const cells = [cell(1, 0, 0), cell(2, 500, 0)];
    expect(cellOf({ x: 30, y: 100, w: 100, h: 40 }, cells)?.n).toBe(1);
    expect(cellOf({ x: 300, y: 12, w: 100, h: 40 }, cells)?.n).toBe(1);
    expect(cellOf({ x: 560, y: 200, w: 100, h: 40 }, cells)?.n).toBe(2);
    expect(cellOf({ x: 30, y: -30, w: 100, h: 20 }, cells)).toBeNull();
    expect(cellOf({ x: 30, y: 600, w: 100, h: 40 }, cells)).toBeNull();
  });

  it("work in two cells is never one column, and each column under a problem knows its head", () => {
    const cells = [cell(1, 0, 0, ["2x + 3 = 11"]), cell(4, 0, 400, ["5x - 2 = 13"])];
    // clusterLines put all three in one column: the last line under problem 1 sits close above problem 4's work
    const lines = [line("a", 30, 100, 0, 0), line("b", 30, 330, 0, 1), line("c", 30, 470, 0, 2)];
    const { lines: out, heads } = splitColumnsAtProblems(lines, cells);
    const col = (id: string) => out.find((l) => l.id === id)!;
    expect(col("a").column).toBe(col("b").column);
    expect(col("c").column).not.toBe(col("a").column);
    expect([col("a").row, col("b").row, col("c").row]).toEqual([0, 1, 0]);
    expect(heads.get(col("a").column)?.lines).toEqual(["2x + 3 = 11"]);
    expect(heads.get(col("c").column)?.lines).toEqual(["5x - 2 = 13"]);
  });

  it("with no line in any cell nothing changes", () => {
    const lines = [line("a", 30, 700, 0, 0), line("b", 900, 700, 1, 0)];
    const { lines: out, heads } = splitColumnsAtProblems(lines, [cell(1, 0, 0)]);
    expect(out).toEqual(lines);
    expect(heads.size).toBe(0);
  });
});

describe("the figure drawer's check", () => {
  it("the probe triangle is clean; a spec the drawer would draw wrong gets sentences a model can act on", () => {
    expect(figureProblems(PROBE_FIGURE)).toEqual([]);
    const lying = { ...PROBE_FIGURE, points: { ...PROBE_FIGURE.points, C: { x: 0, y: 8 } } };
    const problems = figureProblems(lying);
    expect(problems.length).toBeGreaterThan(0);
    expect(problems.join(" ")).toMatch(/AC|AB|3|4/);
  });

  it("never throws: a check that throws is one problem", () => {
    expect(
      figureProblems(PROBE_FIGURE, () => {
        throw new Error("bad spec");
      }),
    ).toEqual(["bad spec"]);
  });
});
