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
