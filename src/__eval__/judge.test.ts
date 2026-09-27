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

  it("judges a system with several solution points: every line true at each, the values paired in order", () => {
    const lines = ["x + y = 7", "xy = 12"];
    const p = problem({ topic: "system-2x2", lines, expect: { values: { x: [3, 4], y: [4, 3] } } });
    const good = judge(p, lines, solved(["y = 7 - x", "x(7 - x) = 12", "x^{2} - 7x + 12 = 0", "x = 3, \\ x = 4", "y = 4, \\ y = 3"], "solveFromLines"), drawAll);
    expect(good.pass).toBe(true);
    // the partners swapped: (3, 3) and (4, 4) are not solutions
    const swapped = judge(p, lines, solved(["y = 7 - x", "x = 3, \\ x = 4", "y = 3, \\ y = 4"], "solveFromLines"), drawAll);
    expect(swapped.answer.status).toBe("wrong");
    // a root lost on the way
    const lost = judge(p, lines, solved(["y = 7 - x", "x^{2} - 7x + 12 = 0", "x = 3", "y = 4"], "solveFromLines"), drawAll);
    expect(lost.transitions[2].status).toBe("broken");
    expect(lost.answer.status).toBe("wrong");
  });

  it("judges a trig equation on its interval, degrees read as radians", () => {
    const lines = ["\\sin x = \\frac{1}{2}"];
    const p = problem({ topic: "trig-equation", lines, expect: { values: { x: [Math.PI / 6, (5 * Math.PI) / 6] }, interval: { lo: 0, hi: 2 * Math.PI } } });
    const good = judge(p, lines, solved(["0^{\\circ} \\le x < 360^{\\circ}", "\\sin^{-1}\\left(\\frac{1}{2}\\right) = 30^{\\circ}", "x = 30^{\\circ}, \\ x = 180^{\\circ} - 30^{\\circ}", "x = 30^{\\circ}, \\ x = 150^{\\circ}"]), drawAll);
    expect(good.pass).toBe(true);
    expect(good.transitions.map((t) => t.status)).toEqual(["ok", "ok", "ok", "ok"]);
    // the wrong quadrant: blamed, and the answer is wrong
    const bad = judge(p, lines, solved(["x = 30^{\\circ}, \\ x = 360^{\\circ} - 30^{\\circ}", "x = 30^{\\circ}, \\ x = 330^{\\circ}"]), drawAll);
    expect(bad.transitions[0].status).toBe("broken");
    expect(bad.answer.status).toBe("wrong");
    // one solution missing is a narrowing, not a step
    expect(judge(p, lines, solved(["x = 30^{\\circ}"]), drawAll).transitions[0].status).toBe("broken");
    // thirty radians is not thirty degrees
    expect(judge(p, lines, solved(["x = 30, \\ x = 150"]), drawAll).answer.status).toBe("wrong");
  });

  it("a false statement beside the working is a mistake; the wrong interval is a step, and wrong", () => {
    const lines = ["\\sin x = \\frac{1}{2}"];
    const p = problem({ topic: "trig-equation", lines, expect: { values: { x: [Math.PI / 6, (5 * Math.PI) / 6] }, interval: { lo: 0, hi: 2 * Math.PI } } });
    const falseAside = judge(p, lines, solved(["\\sin^{-1}\\left(\\frac{1}{2}\\right) = 60^{\\circ}", "x = 30^{\\circ}, \\ x = 150^{\\circ}"]), drawAll);
    expect(falseAside.transitions[0].status).not.toBe("ok");
    expect(falseAside.stages.steps).toBe(false);
    const wrongInterval = judge(p, lines, solved(["0^{\\circ} \\le x < 180^{\\circ}", "x = 30^{\\circ}, \\ x = 150^{\\circ}"]), drawAll);
    expect(wrongInterval.transitions[0].status).not.toBe("ok");
  });

  it("follows a substitution: u and du checked, the integral in u compared with the one in x", () => {
    const lines = ["\\int 2x(x^{2}+1)^{5} \\, dx"];
    const p = problem({ topic: "integral-indefinite", lines, expect: { answer: "\\frac{(x^{2} + 1)^{6}}{6} + C", upToConstant: true } });
    const good = judge(p, lines, solved(["u = x^{2} + 1", "du = 2x \\, dx", "= \\int u^{5} \\, du", "= \\frac{u^{6}}{6} + C", "= \\frac{(x^{2} + 1)^{6}}{6} + C"], "simplifySteps"), drawAll);
    expect(good.transitions.map((t) => t.status)).toEqual(["ok", "ok", "ok", "ok", "ok"]);
    expect(good.pass).toBe(true);
    // the wrong derivative of u
    expect(judge(p, lines, solved(["u = x^{2} + 1", "du = x \\, dx", "= \\int u^{5} \\, du"], "simplifySteps"), drawAll).transitions[1].status).toBe("broken");
    // the integral in u that is not the one in x (the 2x is not accounted for twice)
    expect(judge(p, lines, solved(["u = x^{2} + 1", "du = 2x \\, dx", "= \\int 2u^{5} \\, du"], "simplifySteps"), drawAll).transitions[2].status).toBe("broken");
    // back in x, wrongly
    expect(judge(p, lines, solved(["u = x^{2} + 1", "du = 2x \\, dx", "= \\int u^{5} \\, du", "= \\frac{u^{6}}{6} + C", "= \\frac{(x^{2} + 1)^{5}}{6} + C"], "simplifySteps"), drawAll).transitions[4].status).toBe("broken");
  });

  it("checks integration by parts: du against u, v against dv", () => {
    const lines = ["\\int x e^{x} \\, dx"];
    const p = problem({ topic: "integral-indefinite", lines, expect: { answer: "x e^{x} - e^{x} + C", upToConstant: true } });
    const parts = ["\\int u \\, dv = uv - \\int v \\, du", "u = x, \\ dv = e^{x} \\, dx"];
    const good = judge(p, lines, solved([...parts, "du = dx, \\ v = e^{x}", "= xe^{x} - \\int e^{x} \\, dx", "= xe^{x} - e^{x} + C"], "simplifySteps"), drawAll);
    expect(good.pass).toBe(true);
    expect(good.transitions.slice(0, 3).map((t) => t.status)).toEqual(["ok", "ok", "ok"]);
    const badV = judge(p, lines, solved([...parts, "du = dx, \\ v = e^{2x}", "= xe^{x} - e^{x} + C"], "simplifySteps"), drawAll);
    expect(badV.transitions[2].status).toBe("broken");
    // a wrong answer is still wrong, whatever lines came before it
    expect(judge(p, lines, solved([...parts, "du = dx, \\ v = e^{x}", "= xe^{x} + e^{x} + C"], "simplifySteps"), drawAll).stages.answer).toBe(false);
  });

  it("checks partial-fraction lines once the coefficients are written", () => {
    const lines = ["\\int \\frac{1}{x^{2} - 1} \\, dx"];
    const p = problem({ topic: "integral-indefinite", lines, expect: { answer: "\\frac{1}{2}\\ln|x - 1| - \\frac{1}{2}\\ln|x + 1| + C", upToConstant: true } });
    const decl = ["\\frac{1}{(x - 1)(x + 1)} = \\frac{A}{x - 1} + \\frac{B}{x + 1}", "1 = A(x + 1) + B(x - 1)"];
    const good = judge(p, lines, solved([...decl, "A = \\frac{1}{2}, \\ B = -\\frac{1}{2}", "= \\frac{1}{2}\\ln|x - 1| - \\frac{1}{2}\\ln|x + 1| + C"], "simplifySteps"), drawAll);
    expect(good.transitions.map((t) => t.status)).toEqual(["ok", "ok", "ok", "ok"]);
    const bad = judge(p, lines, solved([...decl, "A = \\frac{1}{2}, \\ B = \\frac{1}{2}", "= \\frac{1}{2}\\ln|x - 1| + \\frac{1}{2}\\ln|x + 1| + C"], "simplifySteps"), drawAll);
    expect(bad.transitions.slice(0, 3).map((t) => t.status)).toEqual(["broken", "broken", "broken"]);
  });

  it("evaluates the bracket [F]_a^b itself", () => {
    const lines = ["\\int_{0}^{2} 3x^{2} \\, dx ="];
    const p = problem({ topic: "integral-definite", lines, expect: { answer: "8" } });
    expect(judge(p, lines, solved(["= \\left[x^{3}\\right]_{0}^{2}", "= 8 - 0", "= 8"], "simplifySteps"), drawAll).transitions.map((t) => t.status)).toEqual(["ok", "ok", "ok"]);
    expect(judge(p, lines, solved(["= \\left[x^{2}\\right]_{0}^{2}", "= 4"], "simplifySteps"), drawAll).transitions[0].status).toBe("broken");
  });

  it("reads prose only from text macros with letters", () => {
    expect(wordsIn("x = 2 \\text{ or } x = 3")).toEqual(["or"]);
    expect(wordsIn("5\\,\\mathrm{m}")).toEqual([]);
    expect(wordsIn("\\text{ }")).toEqual([]);
  });
});

describe("judge: geometry's answer shapes still catch wrong answers", () => {
  const LENGTH = { lo: 0, hi: Infinity };
  const deg = (d: number) => (d * Math.PI) / 180;

  it("a length is its positive root: c = 13, not ±13 and not -13", () => {
    const lines = ["5^{2} + 12^{2} = c^{2}"];
    const p = problem({ topic: "geometry-right-triangles", lines, expect: { values: { c: [13] }, interval: LENGTH } });
    const good = judge(p, lines, solved(["25 + 144 = c^{2}", "169 = c^{2}", "c = \\sqrt{169}", "c = 13"]), drawAll);
    expect(good.pass).toBe(true);
    expect(good.transitions.map((t) => t.status)).toEqual(["ok", "ok", "ok", "ok"]);
    expect(judge(p, lines, solved(["169 = c^{2}", "c = \\pm 13"]), drawAll).answer.status).toBe("wrong");
    const bad = judge(p, lines, solved(["25 + 144 = c^{2}", "196 = c^{2}", "c = 14"]), drawAll);
    expect(bad.answer.status).toBe("wrong");
    expect(bad.transitions[1].status).toBe("broken");
  });

  it("a named angle in degrees is its own unknown", () => {
    const lines = ["\\angle A + 50^{\\circ} + 60^{\\circ} = 180^{\\circ}"];
    const p = problem({ topic: "geometry-angles", lines, expect: { values: { angle_A: [deg(70)] } } });
    expect(judge(p, lines, solved(["\\angle A + 110^{\\circ} = 180^{\\circ}", "\\angle A = 70^{\\circ}"]), drawAll).pass).toBe(true);
    const bad = judge(p, lines, solved(["\\angle A + 100^{\\circ} = 180^{\\circ}", "\\angle A = 80^{\\circ}"]), drawAll);
    expect(bad.answer.status).toBe("wrong");
    expect(bad.transitions[0].status).toBe("broken");
    // `A = 70` is a different unknown from ∠A
    expect(judge(p, lines, solved(["A = 70^{\\circ}"]), drawAll).answer.status).toBe("unsolved");
  });

  it("a check worked out must be the same statement, side by side", () => {
    const lines = ["6^{2} + 7^{2} = 9^{2}"];
    const p = problem({ topic: "geometry-right-triangles", lines, expect: { answer: "85 \\neq 81" } });
    expect(judge(p, lines, solved(["36 + 49 \\neq 81", "85 \\neq 81"]), drawAll).answer.status).toBe("ok");
    expect(judge(p, lines, solved(["85 \\neq 80"]), drawAll).answer.status).toBe("wrong");
    expect(judge(p, lines, solved(["85 = 81"]), drawAll).answer.status).toBe("wrong");
    expect(judge(p, lines, solved(["6^{2} + 7^{2} = 9^{2}"]), drawAll).answer.status).toBe("unsolved");
  });

  it("a point answer, and every point written on the way to it", () => {
    const lines = ["T_{\\langle 3, -2 \\rangle}(1, 4)"];
    const p = problem({ topic: "geometry-coordinates", lines, expect: { point: [4, 2] } });
    const good = judge(p, lines, solved(["(x, y) \\to (x + 3, y - 2)", "(1, 4) \\to (1 + 3, 4 - 2)", "(1, 4) \\to (4, 2)"]), drawAll);
    expect(good.pass).toBe(true);
    expect(good.transitions.map((t) => t.status)).toEqual(["ok", "ok", "ok"]);
    const bad = judge(p, lines, solved(["(x, y) \\to (x + 3, y - 2)", "(1, 4) \\to (1 + 3, 4 + 2)", "(1, 4) \\to (4, 6)"]), drawAll);
    expect(bad.answer.status).toBe("wrong");
    expect(bad.transitions.map((t) => t.status)).toEqual(["ok", "broken", "broken"]);
    expect(judge(p, lines, solved(["(x, y) \\to (x + 3, y - 2)"]), drawAll).answer.status).toBe("unsolved");
  });

  it("a circle's centre and radius, and each rewrite of its equation", () => {
    const lines = ["x^{2} + y^{2} - 6x + 4y - 12 = 0"];
    const p = problem({ topic: "geometry-circles", lines, expect: { point: [3, -2], values: { r: [5] } } });
    const work = ["x^{2} - 6x + y^{2} + 4y = 12", "x^{2} - 6x + 9 + y^{2} + 4y + 4 = 12 + 9 + 4"];
    const good = judge(p, lines, solved([...work, "(x - 3)^{2} + (y + 2)^{2} = 25", "(h, k) = (3, -2), \\ r = 5"]), drawAll);
    expect(good.pass).toBe(true);
    expect(good.transitions.map((t) => t.status)).toEqual(["ok", "ok", "ok", "ok"]);
    // a slip in the square (24 for 25): the curve changes, and the radius is wrong
    const bad = judge(p, lines, solved([...work, "(x - 3)^{2} + (y + 2)^{2} = 24", "(h, k) = (3, -2), \\ r = 2\\sqrt{6}"]), drawAll);
    expect(bad.transitions[2].status).toBe("broken");
    expect(bad.answer.status).toBe("wrong");
    expect(judge(p, lines, solved(["(h, k) = (-3, 2), \\ r = 5"]), drawAll).answer.status).toBe("wrong");
  });

  it("a formula's value checked at the expected answer, to the rounding written", () => {
    const lines = ["A = \\pi r^{2}", "A = 50", "r = ?"];
    const p = problem({ topic: "geometry-measure", lines, expect: { values: { r: [Math.sqrt(50 / Math.PI)] }, approxOk: true, interval: LENGTH } });
    const steps = ["50 = \\pi r^{2}", "r^{2} = \\frac{50}{\\pi}", "r = \\sqrt{\\frac{50}{\\pi}}"];
    expect(judge(p, lines, solved([...steps, "r \\approx 3.99"], "solveFromLines"), drawAll).pass).toBe(true);
    const bad = judge(p, lines, solved([...steps, "r \\approx 4.5"], "solveFromLines"), drawAll);
    expect(bad.answer.status).toBe("wrong");
    expect(bad.transitions[3].status).toBe("broken");
  });

  it("a distance asked by name is checked at every step", () => {
    const lines = ["A(1, 2), \\ B(4, 6)", "AB = ?"];
    const p = problem({ topic: "geometry-coordinates", lines, expect: { values: { AB: [5] } } });
    expect(judge(p, lines, solved(["AB = \\sqrt{(4 - 1)^{2} + (6 - 2)^{2}}", "AB = \\sqrt{25}", "AB = 5"], "solveFromLines"), drawAll).transitions.map((t) => t.status)).toEqual(["ok", "ok", "ok"]);
    const bad = judge(p, lines, solved(["AB = \\sqrt{(4 - 1)^{2} + (6 - 2)^{2}}", "AB = \\sqrt{9 + 8}", "AB = \\sqrt{17}"], "solveFromLines"), drawAll);
    expect(bad.transitions.map((t) => t.status)).toEqual(["ok", "broken", "broken"]);
    expect(bad.answer.status).toBe("wrong");
  });
});
