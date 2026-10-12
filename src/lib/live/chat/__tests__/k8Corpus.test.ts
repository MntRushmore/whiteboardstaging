import { beforeAll, describe, expect, it } from "vitest";
import type { LiveEngine } from "../../contracts";
import { getEngine } from "../../engine";
import { planHandwriting } from "../../handwriting";
import { PROBLEM_GRID } from "../layout";
import { handCanWrite, verifyProblem, type ProblemVerdict } from "../verify";
import { verifyForBoard } from "@/lib/server/chatProblems";
import { K8_CHECKABLE, K8_MODEL_PROBLEMS, K8_MODEL_UNCHECKABLE, K8_UNCHECKABLE } from "./k8Fixtures";
import { BOARD_PROBLEM_FORMS } from "../problemForms";

/**
 * The route and the board agree, on a K–8 corpus. Prod (2026-10-04 to 10-11): `live.chat`
 * `note_write_problems` 6 times — "I couldn't check that problem, so I didn't write it." — reported
 * by the BOARD after the route had sent the problems on. Two root causes, both reproduced here:
 *
 *  1. The route checked without the hand. `1 + 2 = \square` (gpt-5.4-mini's "fill in the blank
 *     addition for 1st grade") read fine on the engine, so it passed; the board's hand had no box,
 *     so the board refused the set. The route now runs the board's own hand check (`handCanWrite`),
 *     and the hand draws a worksheet's box, circle and dollar sign.
 *  2. The engine could not check what K–8 problems look like: a missing number (`4 + \square = 9`,
 *     `? \times 6 = 42`), a comparison to fill in (`\frac{3}{4} ? \frac{5}{8}`), a thousands comma
 *     as LaTeX writes it (`1{,}234`). Both sides refused them (before the route checked, the
 *     board alone). The engine now reads them (`engine/blanks.ts`).
 *
 * Board = the desk's check with the hand on (`verifyProblem` + `handCanWrite`); route = the gate's
 * (`verifyForBoard`). They must give the same verdict on every problem, write the same lines, and
 * those lines must be ones the hand's own planner draws.
 */

let engine: LiveEngine;
beforeAll(async () => {
  engine = await getEngine();
});

const board = (p: readonly string[]) => verifyProblem(engine, p, handCanWrite);
const typesetBoard = (p: readonly string[]) => verifyProblem(engine, p);
const route = (p: readonly string[]) => verifyForBoard(engine, p);
const verdictOf = (v: ProblemVerdict) => (v.ok ? "ok" : v.reason);
const lines = (p: string | readonly string[]): readonly string[] => (typeof p === "string" ? [p] : p);

describe("K–8 corpus: what the board must write, the route and the board write alike", () => {
  it("every checkable K–8 form verifies on the route and on the board (hand on or off), as the same lines", () => {
    const failed: string[] = [];
    for (const [kind, problem] of K8_CHECKABLE) {
      const r = route(problem);
      const b = board(problem);
      const t = typesetBoard(problem);
      if (!r.ok || !b.ok || !t.ok) failed.push(`${kind}: ${problem.join("; ")} → route ${verdictOf(r)}, board ${verdictOf(b)}, typeset ${verdictOf(t)}`);
      else expect(b.lines, problem.join("; ")).toEqual(r.lines);
    }
    expect(failed).toEqual([]);
    expect(K8_CHECKABLE.length).toBeGreaterThan(140);
  }, 60_000);

  it("what is written is what the hand's own planner draws, at the problem size", () => {
    for (const [, problem] of K8_CHECKABLE) {
      const v = route(problem);
      if (!v.ok) continue;
      expect(planHandwriting(v.lines, { size: PROBLEM_GRID.size, seed: 1 }).unsupported, v.lines.join("; ")).toEqual([]);
    }
  });

  it("answers a child can check: missing numbers, comparisons and money come out right", () => {
    const last = (p: readonly string[]) => {
      const v = route(p);
      return v.ok ? v.steps[v.steps.length - 1] : `refused: ${v.reason}`;
    };
    expect(last(["7 + ? = 12"])).toBe("\\square = 5");
    expect(last(["\\square + 6 = 10"])).toBe("\\square = 4");
    expect(last(["\\frac{2}{3} = \\frac{\\square}{12}"])).toBe("\\square = 8");
    expect(last(["\\frac{3}{4} \\; ? \\; \\frac{5}{8}"])).toBe("\\frac{3}{4} > \\frac{5}{8}");
    expect(last(["345 \\square 354"])).toBe("345 < 354");
    expect(last(["\\$3.25 + \\$1.50"])).toBe("= 4.75");
    expect(last(["1{,}234 + 567"])).toBe("= 1801");
    // the board writes a worksheet's blanks in one form: the box (and the circle to compare in)
    const written = (p: readonly string[]) => (route(p) as Extract<ProblemVerdict, { ok: true }>).lines;
    expect(written(["7 + ? = 12"])).toEqual(["7 + \\square = 12"]);
    expect(written(["7 + \\underline{\\quad} = 12"])).toEqual(["7 + \\square = 12"]);
    expect(written(["\\frac{3}{4} \\; ? \\; \\frac{5}{8}"])).toEqual(["\\frac{3}{4} \\bigcirc \\frac{5}{8}"]);
  });

  it("what cannot be checked is refused on both, for the same reason (rare, and said so)", () => {
    for (const [kind, problem, reason] of K8_UNCHECKABLE) {
      expect(verdictOf(route(problem)), `${kind}: route`).toBe(reason);
      expect(verdictOf(board(problem)), `${kind}: board`).toBe(reason);
    }
  });

  it("route and board never disagree, on anything in the corpus", () => {
    for (const [, problem] of [...K8_CHECKABLE, ...K8_UNCHECKABLE.map(([k, p]) => [k, p] as const)]) {
      expect(verdictOf(board(problem)), problem.join("; ")).toBe(verdictOf(route(problem)));
    }
  });
});

describe("the forms a prompt should ask for (`problemForms.ts`)", () => {
  it("every example is one the route and the board check and write, hand on", () => {
    for (const form of BOARD_PROBLEM_FORMS) {
      const p = lines(form.example);
      expect(verdictOf(route(p)), `${form.kind}: ${p.join("; ")}`).toBe("ok");
      expect(verdictOf(board(p)), `${form.kind}: ${p.join("; ")}`).toBe("ok");
    }
  });
});

describe("K–8 asks through the production chat prompt (real model output, 2026-10-11)", () => {
  it("every problem the models proposed for 39 K–8 asks is written — but clock times and finished facts", () => {
    let proposed = 0;
    const refused: string[] = [];
    for (const [ask, problems] of K8_MODEL_PROBLEMS) {
      for (const p of problems) {
        proposed++;
        const r = route(lines(p));
        const b = board(lines(p));
        expect(verdictOf(b), `${ask}: ${lines(p).join("; ")}`).toBe(verdictOf(r));
        if (!r.ok) refused.push(lines(p).join("; "));
      }
    }
    expect(proposed).toBeGreaterThan(240);
    expect(new Set(refused)).toEqual(K8_MODEL_UNCHECKABLE);
    // before 2026-10-11 the route passed 4 the board then refused (`1 + 2 = \square`), and 12 more
    // were refused on both (blanks, comparisons): 249 of 269 written
  });
});
