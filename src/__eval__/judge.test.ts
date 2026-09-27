import { describe, expect, it } from "vitest";
import type { LocalSolveResult } from "@/lib/live/localSolve";
import type { EvalProblem } from "./corpus";
import { judge, wordsIn } from "./judge";

/**
 * The judge on hand-made solutions whose verdict is known — so a pass on the scoreboard means
 * the maths is right, and a failure points at the step that is wrong.
 */
const drawAll = { unsupported: () => [] as string[] };
const solved = (steps: string[], source: LocalSolveResult["source"] = "solveLatex"): LocalSolveResult => ({ source, steps });
const problem = (p: Partial<EvalProblem> & Pick<EvalProblem, "lines" | "expect">): EvalProblem => ({ id: "t", topic: "linear", ...p });

describe("judge", () => {
  it("passes a correct worked solution", () => {
    const v = judge(problem({ lines: ["2x + 3 = 11"], expect: { values: { x: [4] } } }), ["2x + 3 = 11"], solved(["2x = 8", "x = 4"]), drawAll);
    expect(v.pass).toBe(true);
    expect(v.transitions.map((t) => t.status)).toEqual(["ok", "ok"]);
  });

  it("blames the wrong step once, and the wrong answer", () => {
    const v = judge(problem({ lines: ["2x + 3 = 11"], expect: { values: { x: [4] } } }), ["2x + 3 = 11"], solved(["2x = 9", "x = 4.5"]), drawAll);
    expect(v.stages.answer).toBe(false);
    expect(v.answer.status).toBe("wrong");
    // `2x = 9` is the mistake; `x = 4.5` follows from it and is not blamed again
    expect(v.transitions.map((t) => t.status)).toEqual(["broken", "ok"]);
    expect(v.failures.map((f) => f.stage)).toEqual(["answer", "steps"]);
  });

  it("catches the quadratic formula written with an unbracketed negative b", () => {
    const lines = ["x^{2} - 6x + 9 = 0"];
    const v = judge(problem({ topic: "quadratic", lines, expect: { values: { x: [3] } } }), lines, solved(["x = \\frac{6 \\pm \\sqrt{-6^{2} - 4 \\cdot 1 \\cdot 9}}{2 \\cdot 1}", "x = \\frac{6 \\pm \\sqrt{0}}{2}", "x = 3"]), drawAll);
    expect(v.transitions[0].status).toBe("broken");
    expect(v.transitions.slice(1).map((t) => t.status)).toEqual(["ok", "ok"]);
    expect(v.stages.answer).toBe(true);
  });

  it("allows squaring both sides, then rejecting the extraneous root", () => {
    const lines = ["\\sqrt{x + 2} = x"];
    const v = judge(problem({ topic: "radical", lines, expect: { values: { x: [2] } } }), lines, solved(["x + 2 = x^{2}", "x^{2} - x - 2 = 0", "x = 2"]), drawAll);
    expect(v.transitions.map((t) => t.status)).toEqual(["widened", "ok", "ok"]);
    expect(v.pass).toBe(true);
  });

  it("scores ≈ on an exact answer, and a decimal for a surd, as approx", () => {
    const lines = ["\\sqrt{x} = 5"];
    expect(judge(problem({ lines, expect: { values: { x: [25] } } }), lines, solved(["x \\approx 25"]), drawAll).answer.status).toBe("approx");
    const q = ["x^{2} - 2 = 0"];
    expect(judge(problem({ lines: q, expect: { values: { x: [-Math.SQRT2, Math.SQRT2] } } }), q, solved(["x = \\pm \\sqrt{2}"]), drawAll).answer.status).toBe("ok");
    expect(judge(problem({ lines: q, expect: { values: { x: [-Math.SQRT2, Math.SQRT2] } } }), q, solved(["x = -1.414, x = 1.414"]), drawAll).answer.status).toBe("approx");
  });

  it("judges expressions by value and by shape", () => {
    const lines = ["x^{2} + 5x + 6"];
    const p = problem({ topic: "expand-factor", lines, expect: { answer: "(x + 2)(x + 3)", form: "factored" } });
    expect(judge(p, lines, solved(["= (x + 3)(x + 2)"], "simplifySteps"), drawAll).answer.status).toBe("ok");
    expect(judge(p, lines, solved(["= x^{2} + 5x + 6 + 0"], "simplifySteps"), drawAll).answer.status).toBe("form");
    expect(judge(p, lines, solved(["= (x + 1)(x + 6)"], "simplifySteps"), drawAll).answer.status).toBe("wrong");
  });

  it("differentiates an antiderivative to check it, whatever its constant", () => {
    const lines = ["\\int \\cos x \\, dx"];
    const p = problem({ topic: "integral-indefinite", lines, expect: { answer: "\\sin x + C", upToConstant: true } });
    const ok = judge(p, lines, solved(["= \\sin x + C"], "localAnswer"), drawAll);
    expect(ok.pass).toBe(true);
    const bad = judge(p, lines, solved(["= -\\sin x + C"], "localAnswer"), drawAll);
    expect(bad.transitions[0].status).toBe("broken");
    expect(bad.answer.status).toBe("wrong");
  });

  it("checks a system's steps against its solution", () => {
    const lines = ["x + y = 18", "x - y = 4"];
    const p = problem({ topic: "system-2x2", lines, expect: { values: { x: [11], y: [7] } } });
    const good = judge(p, lines, solved(["y = 18 - x", "x - (18 - x) = 4", "2x = 22", "x = 11", "y = 7"], "solveFromLines"), drawAll);
    expect(good.pass).toBe(true);
    const bad = judge(p, lines, solved(["y = 18 - x", "x - 18 - x = 4", "x = 11", "y = 7"], "solveFromLines"), drawAll);
    expect(bad.transitions[1].status).toBe("broken");
  });

  it("fails an empty step, a missing solution, words and undrawable steps", () => {
    const lines = ["2x = 8"];
    const p = problem({ lines, expect: { values: { x: [4] } } });
    expect(judge(p, lines, solved(["", "x = 4"]), drawAll).transitions[0]).toMatchObject({ status: "broken", reason: "empty step" });
    const none = judge(p, lines, { source: null, steps: [] }, drawAll);
    expect(none.answer.status).toBe("missing");
    expect(none.failures.map((f) => f.stage)).toEqual(["local"]);
    expect(judge(p, lines, solved(["x = 4 \\text{ so done}"]), drawAll).stages.words).toBe(false);
    expect(judge(p, lines, solved(["x = 4"]), { unsupported: () => ["\\foo"] }).stages.drawable).toBe(false);
  });

  it("follows an unknown that cancels: a false statement is ∅, a true one every x", () => {
    const none = ["3x + 7 = 3x - 2"];
    const p = problem({ lines: none, expect: { answer: "\\varnothing" } });
    expect(judge(p, none, solved(["3x - 3x = -2 - 7", "0 = -9", "\\varnothing"]), drawAll).transitions.map((t) => t.status)).toEqual(["ok", "ok", "ok"]);
    expect(judge(p, none, solved(["3x - 3x = -2 - 7", "0 = -9", "x \\in \\mathbb{R}"]), drawAll).transitions[2].status).toBe("broken");
    const all = ["2(x + 3) = 2x + 6"];
    const q = problem({ lines: all, expect: { answer: "\\mathbb{R}" } });
    expect(judge(q, all, solved(["2x + 6 = 2x + 6", "0 = 0", "x \\in \\mathbb{R}"]), drawAll).pass).toBe(true);
    expect(judge(q, all, solved(["2x + 6 = 2x + 6", "0 = 0", "\\varnothing"]), drawAll).transitions[2].status).toBe("broken");
  });

  it("checks an inequality's critical values and the intervals built on them", () => {
    const lines = ["x^{2} - 5x + 6 < 0"];
    const p = problem({ topic: "inequality", lines, expect: { answer: "2 < x < 3" } });
    const good = judge(p, lines, solved(["(x - 2)(x - 3) < 0", "x = 2, \\ x = 3", "2 < x < 3"]), drawAll);
    expect(good.transitions.map((t) => t.status)).toEqual(["ok", "ok", "ok"]);
    expect(good.pass).toBe(true);
    // the wrong critical values, and the outside intervals for the inside ones
    expect(judge(p, lines, solved(["(x - 2)(x - 3) < 0", "x = -2, \\ x = 3", "2 < x < 3"]), drawAll).transitions[1].status).toBe("broken");
    const outside = judge(p, lines, solved(["(x - 2)(x - 3) < 0", "x = 2, \\ x = 3", "x < 2, \\ x > 3"]), drawAll);
    expect(outside.transitions[2].status).toBe("broken");
    expect(outside.answer.status).toBe("wrong");
    // every number / no number, against the inequality
    const never = ["x^{2} + 1 < 0"];
    const n = problem({ topic: "inequality", lines: never, expect: { answer: "\\varnothing" } });
    expect(judge(n, never, solved(["x^{2} + 1 = 0", "x^{2} = -1", "\\varnothing"]), drawAll).pass).toBe(true);
    expect(judge(n, never, solved(["x^{2} + 1 = 0", "x^{2} = -1", "-\\infty < x < \\infty"]), drawAll).transitions[2].status).toBe("broken");
  });

  it("allows a denominator's zero dropped from the answer, and not a value the problem takes", () => {
    const lines = ["\\frac{3 - x}{x + 1} \\ge 0"];
    const p = problem({ topic: "inequality", lines, expect: { answer: "-1 < x \\le 3" } });
    expect(judge(p, lines, solved(["x \\neq -1", "(x + 1)(x - 3) \\le 0", "x = -1, \\ x = 3", "-1 < x \\le 3"]), drawAll).pass).toBe(true);
    expect(judge(p, lines, solved(["x \\neq -1", "(x + 1)(x - 3) \\le 0", "x = -1, \\ x = 3", "-1 < x < 3"]), drawAll).transitions[3].status).toBe("broken");
    // an equation whose only candidate is excluded: ∅ is right; with a real root it is not
    const ra = ["\\frac{x}{x - 2} = \\frac{2}{x - 2} + 3"];
    const r = problem({ topic: "rational", lines: ra, expect: { values: { x: [] } } });
    expect(judge(r, ra, solved(["x = 3x - 4", "x = 2", "\\varnothing"]), drawAll).transitions[2]).toMatchObject({ status: "ok", reason: "rejects the extraneous candidates" });
    const lin = ["x + 2 = 4"];
    expect(judge(problem({ lines: lin, expect: { values: { x: [2] } } }), lin, solved(["x = 2", "\\varnothing"]), drawAll).transitions[1].status).toBe("broken");
  });

  it("reads prose only from text macros with letters", () => {
    expect(wordsIn("x = 2 \\text{ or } x = 3")).toEqual(["or"]);
    expect(wordsIn("5\\,\\mathrm{m}")).toEqual([]);
    expect(wordsIn("\\text{ }")).toEqual([]);
  });
});
