/**
 * "Show me a step" (`nextTryStep`) on every try problem, from nothing written: a step the try check
 * ticks (the tutor never writes a line it would ring), the one the board's Suggest writes under the
 * problem, and `solves` exactly when it finishes the problem. Then from the visitor's own work: on
 * from their last right line, past a slip, nothing once solved. And the hand writes every step
 * (`tryInk`).
 */
import { beforeAll, describe, expect, it } from "vitest";
import type { LiveEngine } from "@/lib/live/contracts";
import { getEngine } from "@/lib/live/engine";
import { analyzeColumn, localSolve } from "@/lib/live/localSolve";
import { problemSteps } from "@/lib/live/chat/work";
import { badgeFor } from "@/lib/live/policy";
import { stepKey } from "@/lib/live/solveSteps";
import { TryInkSchema } from "@/lib/try/contracts";
import { TRY_PROBLEMS, tryProblem } from "@/lib/try/problems";
import { nextTryStep } from "../help";
import { TRY_HAND_SIZE, tryInk, trySeed } from "../ink";
import { judgeTryLine } from "../judge";

let engine: LiveEngine;
beforeAll(async () => {
  engine = await getEngine();
}, 60_000);

const p = (id: string) => tryProblem(id)!;

describe.each(TRY_PROBLEMS.map((pr) => ({ id: pr.id, lines: pr.lines.join("; "), pr })))("$id: $lines, from nothing written", ({ pr }) => {
  it("writes the step the board's Suggest writes, one the check ticks, in the tutor's hand", () => {
    const step = nextTryStep(engine, pr, []);
    expect(step.latex).toBeTruthy();
    // as courses.test.ts's coach mark 2 (`LiveLoop.problemStepsFor`)
    const solution = localSolve(engine, [...pr.lines]).steps;
    const ticked = (s: string) => {
      const a = analyzeColumn(engine, [...pr.lines, s], "feedback").at(-1) ?? null;
      return !(a?.domain && !a.math) && ["ok", "solved"].includes(badgeFor("feedback", a));
    };
    const [suggest] = problemSteps({ solution, head: pr.lines, written: [], depth: "step", normalize: stepKey, ticked });
    expect(step.latex).toBe(suggest);
    const { verdict } = judgeTryLine(engine, pr, [], step.latex!);
    expect(verdict).toBe(step.solves ? "solved" : "check");
    // a one-step problem's first step is its answer
    if (pr.oneStep) expect(step.solves).toBe(true);
    const ink = tryInk(pr, step.latex!);
    expect(ink, "the hand writes it").not.toBeNull();
    expect(TryInkSchema.safeParse(ink).success).toBe(true);
    expect(ink!.strokes.length).toBeGreaterThan(0);
  }, 20_000);
});

describe("nextTryStep from the visitor's work", () => {
  it("goes on from the visitor's own last right line, not the problem's first step", () => {
    // 5x - 3 = 2x + 9: the engine's solution starts 5x - 2x = 9 + 3; the visitor took 2x off first
    expect(nextTryStep(engine, p("g68-6"), ["3x - 3 = 9"])).toEqual({ latex: "3x = 12", solves: false });
    expect(nextTryStep(engine, p("g68-6"), ["3x - 3 = 9", "3x = 12"])).toEqual({ latex: "x = 4", solves: true });
    // the problem's own steps, continued after the last one written
    expect(nextTryStep(engine, p("hs-2"), ["3x + 6 = 18"])).toEqual({ latex: "3x = 12", solves: false });
    // a young student's working under a sum: the answer
    expect(nextTryStep(engine, p("k2-6"), ["80 + 5"])).toEqual({ latex: "= 85", solves: true });
  }, 30_000);

  it("steps past a slip, from the last right line", () => {
    expect(nextTryStep(engine, p("g68-3"), ["2x = 22"])).toEqual(nextTryStep(engine, p("g68-3"), []));
    expect(nextTryStep(engine, p("g68-3"), ["2x = 12", "x = 7"])).toEqual({ latex: "x = 6", solves: true });
    // half a line or an unread line is not work to go on from
    expect(nextTryStep(engine, p("g68-3"), ["", "2x ="])).toEqual(nextTryStep(engine, p("g68-3"), []));
  }, 30_000);

  it("has nothing once the problem is solved", () => {
    expect(nextTryStep(engine, p("k2-0"), ["7"])).toEqual({ latex: null, solves: false });
    expect(nextTryStep(engine, p("g68-0"), ["x = 8"])).toEqual({ latex: null, solves: false });
    expect(nextTryStep(engine, p("g68-3"), ["2x = 12", "x = 6"])).toEqual({ latex: null, solves: false });
  }, 30_000);
});

describe("tryInk", () => {
  it("writes the same step the same way, at the page's size", () => {
    const a = tryInk(p("g68-3"), "2x = 12");
    expect(a).toEqual(tryInk(p("g68-3"), "2x = 12"));
    expect(a!.height).toBeGreaterThan(TRY_HAND_SIZE * 0.5);
    expect(a!.durationMs).toBeGreaterThan(0);
    expect(trySeed("g68-3|2x = 12")).toBe(trySeed("g68-3|2x = 12"));
    expect(trySeed("g68-3|2x = 12")).not.toBe(trySeed("g68-4|2x = 12"));
  });

  it("is null for a line the hand cannot write, never half a line", () => {
    expect(tryInk(p("g68-3"), "\\unknowncmd{x}")).toBeNull();
  });
});
