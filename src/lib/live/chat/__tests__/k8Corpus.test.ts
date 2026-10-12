import { beforeAll, describe, expect, it } from "vitest";
import type { LineAnalysis, LiveEngine } from "../../contracts";
import { getEngine } from "../../engine";
import { isArithmetic, isSlip, judgeLine } from "../../engine/columnWork";
import { givensFor, givensOf } from "../../givens";
import { analyzeColumn } from "../../localSolve";
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
}, 60_000);

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

/**
 * A student's lines under a problem the board wrote, judged as `LiveLoop.judge` judges them: the
 * problem analysed as the column's head (`LiveLoop.problemAnalyses` → `analyzeColumn`, its givens
 * too), each line against the last right line above it (a slip is never that), the column's givens
 * (`givens.ts`), and — a problem with no letters (`isArithmetic`) — the young-work judge against the
 * problem (`judgeLine` → `LiveEngine.judgeWork`).
 */
function boardJudge(problem: readonly string[], lines: readonly string[]): LineAnalysis[] {
  const heads = analyzeColumn(engine, problem, "feedback");
  const arithmetic = problem.length > 0 && problem.every(isArithmetic) ? problem : null;
  const out: LineAnalysis[] = [];
  for (let i = 0; i < lines.length; i++) {
    let previous: LineAnalysis | undefined;
    let original: LineAnalysis | undefined;
    let last: LineAnalysis | undefined;
    const take = (a: LineAnalysis | null | undefined) => {
      if (!a || NOT_A_STEP.has(a.kind)) return;
      previous = a;
      if (!original && (a.kind === "equation" || a.kind === "inequality")) original = a;
    };
    heads.forEach(take);
    for (const a of out) {
      if (!NOT_A_STEP.has(a.kind)) last = a;
      if (!isSlip(a)) take(a);
    }
    const columnGivens = givensOf(lines, [...out, ...lines.slice(i).map(() => null)]);
    const givens = givensFor(columnGivens, i);
    out.push(
      judgeLine(engine, lines[i], {
        ctx: { previous, original, mode: "feedback", ...(givens ? { givens } : {}) },
        arithmetic,
        above: arithmetic ? lines.slice(0, i) : [],
        slip: last && isSlip(last) ? last : undefined,
        given: !arithmetic && Boolean(previous?.substituted) && columnGivens.some((g) => g.lines.includes(i)),
      }),
    );
  }
  return out;
}
const NOT_A_STEP = new Set(["label", "incomplete", "unknown", "operation"]);

/** What the board does with the last line: a tick, a tick that solves the problem, a ring — or nothing. */
type Mark = "tick" | "solved" | "ring";
const markOf = (a: LineAnalysis): Mark | "nothing" => (a.verdict === "mismatch" ? "ring" : a.verdict === "ok" ? (a.solved ? "solved" : "tick") : "nothing");

/**
 * A right answer and a wrong one for every form, as a student writes them under the problem: the
 * answer alone where a teacher expects a number (solved), the working where the form asks for it.
 * `tick`: right but not finished (the board ticks it; `solved` passes too).
 */
const FORM_ANSWERS: Record<string, ReadonlyArray<readonly [lines: readonly string[], mark: Mark]>> = {
  "add, subtract, multiply, divide": [[["623"], "solved"], [["345 + 278 = 623"], "solved"], [["613"], "ring"], [["345 + 278 = 613"], "ring"]],
  "fill in the blank, missing number (K–3)": [[["5"], "solved"], [["6"], "ring"]],
  "the answer's box": [[["56"], "solved"], [["54"], "ring"]],
  "missing number with a letter (grade 3 and up)": [[["n = 7"], "solved"], [["n = 8"], "ring"]],
  "compare with <, >, =": [[[">"], "solved"], [["<"], "ring"]],
  "fractions and mixed numbers": [[["4\\frac{1}{4}"], "solved"], [["\\frac{17}{4}"], "solved"], [["3\\frac{1}{4}"], "ring"]],
  "equivalent fractions": [[["8"], "solved"], [["6"], "ring"]],
  money: [[["4.75"], "solved"], [["\\$4.75"], "solved"], [["= \\$4.75"], "solved"], [["3 + 1 = 4", "4.75"], "solved"], [["4.85"], "ring"], [["\\$4.85"], "ring"], [["475"], "ring"]],
  "big numbers": [[["1801"], "solved"], [["1{,}801"], "solved"], [["1,801"], "solved"], [["1791"], "ring"], [["1{,}791"], "ring"]],
  "place value": [[["500"], "solved"], [["50"], "ring"]],
  "division with a remainder": [[["9 R 2"], "solved"], [["9 R 3"], "ring"], [["8 R 7"], "ring"]],
  "order of operations": [[["17"], "solved"], [["64"], "ring"]],
  "word problem": [[["29"], "solved"], [["39"], "ring"]],
  decimals: [[["1.26"], "solved"], [["12.6"], "ring"]],
  percent: [[["20"], "solved"], [["= 20"], "solved"], [["0.25 \\times 80 = 20"], "solved"], [["80 \\div 4 = 20"], "solved"], [["25"], "ring"], [["2000"], "ring"], [["0.25 \\times 80 = 25"], "ring"]],
  "ratio and proportion": [[["x = 9"], "solved"], [["x = 8"], "ring"]],
  "negative numbers": [[["-3"], "solved"], [["-7"], "ring"]],
  "exponents and roots": [[["13"], "solved"], [["9 + 4 = 13"], "solved"], [["9", "4", "13"], "solved"], [["10"], "ring"], [["9 + 4 = 14"], "ring"]],
  "GCF and LCM": [[["6"], "solved"], [["\\gcd(12, 18) = 6"], "solved"], [["3"], "ring"], [["2"], "ring"]],
  "evaluate an expression": [[["11"], "solved"], [["= 11"], "solved"], [["2(3) + 5 = 11"], "solved"], [["13"], "ring"], [["= 13"], "ring"], [["2(3) + 5 = 12"], "ring"]],
  "area, perimeter, volume": [[["A = 40"], "tick"], [["A = 45"], "ring"]],
  "equations and inequalities": [[["x = 4"], "solved"], [["2x = 8", "x = 4"], "solved"], [["x = 5"], "ring"]],
  "a system of equations": [[["2x = 12", "x = 6"], "solved"], [["2x = 12", "x = 5"], "ring"]],
};

describe("every problem form the board writes: a right answer is ticked or solved, a wrong one ringed (as the loop judges)", () => {
  it("each form, through the board's own check and the loop's judge", () => {
    const missed: string[] = [];
    for (const form of BOARD_PROBLEM_FORMS) {
      const answers = FORM_ANSWERS[form.kind];
      expect(answers, `answers for "${form.kind}"`).toBeDefined();
      expect(answers.some(([, m]) => m !== "ring") && answers.some(([, m]) => m === "ring"), form.kind).toBe(true);
      // the problem as the board wrote it: the column's head
      const v = board(lines(form.example));
      if (!v.ok) {
        missed.push(`${form.kind}: refused (${v.reason})`);
        continue;
      }
      for (const [work, want] of answers) {
        const got = markOf(boardJudge(v.lines, work).at(-1)!);
        const right = want === "ring" ? got === "ring" : want === "solved" ? got === "solved" : got === "tick" || got === "solved";
        if (!right) missed.push(`${form.kind}: ${v.lines.join("; ")} | ${work.join(" | ")} → ${got}, want ${want}`);
      }
    }
    expect(missed).toEqual([]);
  }, 60_000);

  it("money and percents reach the young-work judge (`\\$`, `\\%`, `{,}` are numbers), so a wrong answer is ringed, never a label", () => {
    for (const [problem, wrong] of [
      ["\\$3.25 + \\$1.50", "4.85"],
      ["\\$10 - \\$3.45", "\\$7.65"],
      // (`\$4` is 10% of it: a step on the way, unmarked)
      ["15\\% \\times \\$40", "\\$5"],
      ["25\\% \\times 80", "25"],
      ["1{,}234 + 567", "1{,}791"],
      ["3^{2} + \\sqrt{16}", "10"],
    ] as const) {
      expect(isArithmetic(problem), problem).toBe(true);
      const judged = engine.judgeWork?.({ problem: [problem], above: [], latex: wrong, ctx: { mode: "feedback" } });
      expect(judged, `${problem} | ${wrong}`).toMatchObject({ verdict: "mismatch", bareAnswer: true });
    }
    // and the rest of the K–8 corpus's money, percents, roots, GCF and LCM: the answer alone solves it
    for (const [problem, answer] of [
      ["\\$5.00 - \\$2.75", "2.25"],
      ["4 \\times \\$1.25", "\\$5"],
      ["15\\% \\times \\$40", "6"],
      ["\\frac{30}{120} \\cdot 100\\%", "25\\%"],
      ["\\sqrt{144} - \\sqrt{25}", "7"],
      ["\\operatorname{lcm}(4, 6)", "12"],
      ["\\gcd(24,36)", "12"],
    ] as const) {
      expect(markOf(boardJudge([problem], [answer]).at(-1)!), `${problem} | ${answer}`).toBe("solved");
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
