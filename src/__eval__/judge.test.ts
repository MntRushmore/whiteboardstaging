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

  it("reads prose only from text macros with letters", () => {
    expect(wordsIn("x = 2 \\text{ or } x = 3")).toEqual(["or"]);
    expect(wordsIn("5\\,\\mathrm{m}")).toEqual([]);
    expect(wordsIn("\\text{ }")).toEqual([]);
  });
});
