import { beforeAll, describe, expect, it } from "vitest";
import { LINE_KINDS, ENGINE_VERDICTS, type LiveEngine } from "../../contracts";
import { CHEM_BALANCED_NOTE, CHEM_UNBALANCED_NOTE, getEngine } from "..";

let engine: LiveEngine;
beforeAll(async () => {
  engine = await getEngine();
});

const feedback = { mode: "feedback" as const };
const answer = { mode: "answer" as const };

describe("engine: getEngine", () => {
  it("returns the same instance and a full LiveEngine", async () => {
    const again = await getEngine();
    expect(again).toBe(engine);
    for (const k of ["analyzeLine", "compileExpr", "solveLatex", "verifyExpected", "balance", "calculate"] as const) {
      expect(typeof engine[k]).toBe("function");
    }
  });
});

describe("engine: analyzeLine kinds and the calculator rule", () => {
  it("labels, incomplete, text", () => {
    expect(engine.analyzeLine("1)", feedback).kind).toBe("label");
    expect(engine.analyzeLine("x", feedback).kind).toBe("label");
    expect(engine.analyzeLine("2x + 3 =", feedback).kind).toBe("incomplete");
    expect(engine.analyzeLine("2x + (3", feedback).kind).toBe("incomplete");
    expect(engine.analyzeLine("\\text{Find the slope}", feedback).kind).toBe("text");
  });
  it("trailing '=' with numeric left side: result only in answer mode", () => {
    const a = engine.analyzeLine("36 + 2 =", feedback);
    expect(a.kind).toBe("expression");
    expect(a.resultLatex).toBe("");
    expect(engine.analyzeLine("36 + 2 =", answer).resultLatex).toBe("38");
  });
  it("calculator rule: result only for units, constants, functions or >= 3 operations", () => {
    expect(engine.analyzeLine("2 + 3", feedback).resultLatex).toBe("");
    expect(engine.analyzeLine("12", feedback).resultLatex).toBe("");
    expect(engine.analyzeLine("2 + 3 \\cdot 4 - 1", feedback).resultLatex).toBe("13");
    expect(engine.analyzeLine("\\sqrt{16}", feedback).resultLatex).toBe("4");
    expect(engine.analyzeLine("2\\pi", feedback).resultLatex).toBe("6.283");
    expect(engine.analyzeLine("\\frac{1}{2} + \\frac{1}{3}", feedback).resultLatex).toBe("\\frac{5}{6}");
    expect(engine.analyzeLine("\\log_{2} 8", feedback).resultLatex).toBe("3");
    expect(engine.analyzeLine("2x + 3", feedback).resultLatex).toBe("");
  });
  it("derivatives and integrals evaluate locally", () => {
    const d = engine.analyzeLine("\\frac{d}{dx} x^3", feedback);
    expect(d.kind).toBe("expression");
    expect(d.resultLatex.replace(/\s/g, "")).toBe("3\\cdot{x}^{2}");
    const i = engine.analyzeLine("\\int_{0}^{1} x^2 \\, dx", feedback);
    expect(i.resultLatex).toBe("0.3333");
  });
  it("functions get a plot", () => {
    const a = engine.analyzeLine("y = 2x + 1", feedback);
    expect(a.kind).toBe("function");
    expect(a.plot).toEqual({ expr: "2 * x + 1", latex: "2x + 1" });
    const f = engine.analyzeLine("f(t) = t^2 - 4", feedback);
    expect(f.plot?.expr).toBe("x ^ 2 - 4");
    expect(engine.analyzeLine("y = mx + b", feedback).plot).toBeUndefined();
    const sampler = engine.compileExpr(a.plot!.expr)!;
    expect(sampler(2)).toBe(5);
  });
  it("points and assignments", () => {
    const p = engine.analyzeLine("(3, -4)", feedback);
    expect(p.kind).toBe("point");
    expect(p.math).toBe("[3, -4]");
    const m = engine.analyzeLine("m = 3 \\mathrm{~kg}", feedback);
    expect(m.kind).toBe("assignment");
    expect(m.variable).toBe("m");
    expect(m.resultLatex).toBe("");
    const x = engine.analyzeLine("x = 4", feedback);
    expect(x.kind).toBe("assignment");
  });
  it("chem lines: unbalanced equations are a mismatch with a local hint, balanced ones are ok", () => {
    // no coefficients attempted yet: still a mismatch so the amber dot shows (B3)
    const a = engine.analyzeLine("Fe + O_2 \\rightarrow Fe_2O_3", feedback);
    expect(a.kind).toBe("chem");
    expect(a.chem).toEqual({ balanced: false, balancedLatex: "4\\,\\mathrm{Fe} + 3\\,\\mathrm{O_{2}} \\rightarrow 2\\,\\mathrm{Fe_{2}O_{3}}" });
    expect(a.verdict).toBe("mismatch");
    expect(a.note).toBe(CHEM_UNBALANCED_NOTE);
    expect(a.note).toBe("Count the atoms on each side");
    const b = engine.analyzeLine("4Fe + 3O_2 \\rightarrow 2Fe_2O_3", feedback);
    expect(b.chem).toEqual({ balanced: true, balancedLatex: "4\\,\\mathrm{Fe} + 3\\,\\mathrm{O_{2}} \\rightarrow 2\\,\\mathrm{Fe_{2}O_{3}}" });
    expect(b.verdict).toBe("ok");
    expect(b.note).toBe(CHEM_BALANCED_NOTE);
    expect(b.note.startsWith("Balanced")).toBe(true);
    // wrong coefficients
    const c = engine.analyzeLine("2Fe + 3O_2 \\rightarrow 2Fe_2O_3", feedback);
    expect(c.verdict).toBe("mismatch");
    expect(c.note).toBe(CHEM_UNBALANCED_NOTE);
    // the same in every mode: the loop decides what to reveal
    expect(engine.analyzeLine("Fe + O_2 \\rightarrow Fe_2O_3", answer).verdict).toBe("mismatch");
    expect(engine.analyzeLine("2H_2 + O_2 \\to 2H_2O", { mode: "suggest" }).verdict).toBe("ok");
    // parses as chemistry but no integer coefficients exist: still a mismatch, balancedLatex empty
    const imp = engine.analyzeLine("H_2 \\rightarrow O_2", feedback);
    expect(imp.kind).toBe("chem");
    expect(imp.verdict).toBe("mismatch");
    expect(imp.chem).toEqual({ balanced: false, balancedLatex: "" });
    // a lone formula is chemistry but not an equation: verdict none, molar mass shown
    const w = engine.analyzeLine("H_2O", feedback);
    expect(w.kind).toBe("chem");
    expect(w.verdict).toBe("none");
    expect(w.chem).toBeUndefined();
    expect(w.resultLatex).toBe("18.015\\,\\mathrm{g/mol}");
    // not chemistry at all
    expect(engine.analyzeLine("x + y \\rightarrow z", feedback).kind).not.toBe("chem");
  });
  it("lone symbols and text-only lines are silent kinds (B2/B8)", () => {
    for (const s of ["\\Delta", "\\alpha", "\\theta", "\\triangle", "\\therefore", "\\checkmark", "\\square", "\\Delta \\checkmark", "Δ", "\\text { I }"]) {
      expect(engine.analyzeLine(s, feedback).kind, s).toBe("label");
    }
    for (const s of ["\\text{hi}", "\\text{Answer}", "\\text{yes} \\checkmark", "\\text{Find the slope}"]) {
      expect(engine.analyzeLine(s, feedback).kind, s).toBe("text");
    }
    // symbols inside real math still analyze
    expect(engine.analyzeLine("\\Delta x = 4", feedback).kind).toBe("assignment");
    expect(engine.analyzeLine("\\therefore x = 4", feedback).kind).toBe("assignment");
    expect(engine.analyzeLine("2\\pi", feedback).resultLatex).toBe("6.283");
    expect(engine.analyzeLine("\\text{I} = 3", feedback).kind).toBe("assignment");
  });
  it("never throws and always returns contract-valid kinds/verdicts", () => {
    const inputs = ["", "\\sum_{i=1}^n i", "f'(x)", "\\frac{dy}{dx} = 2x", "\\begin{matrix}1\\end{matrix}", "?", "&&&", "\\frac{", "\\left(", "x = ", "= =", "\\text{}", "\\pm", "|", "2,3,4", "\\lim_{x \\to 0}", "\\infty", "1/0", "0^0", "\\sqrt{-1}", "\\log 0", "x^x = 2", "\\sin", "\\frac{1}{x} = 0"];
    for (const latex of inputs) {
      const a = engine.analyzeLine(latex, feedback);
      expect(LINE_KINDS).toContain(a.kind);
      expect(ENGINE_VERDICTS).toContain(a.verdict);
      expect(typeof a.resultLatex).toBe("string");
    }
    expect(engine.analyzeLine("\\sum_{i=1}^n i", feedback).kind).toBe("unknown");
    // @ts-expect-error hostile input
    expect(engine.analyzeLine(undefined, undefined).kind).toBe("unknown");
  });
  /**
   * analyzeLine sits on the interactive path (every pen-up), so it must stay in the
   * low milliseconds. This is a smoke test against an accidental blow-up (a network call,
   * an O(n^2) rebuild), NOT a benchmark: vitest runs files in parallel workers and CI shares
   * CPU, so the budget is deliberately generous and each sample is the best of five runs.
   * Real numbers measured on a warm instance are 0.1-3 ms typical, ~20 ms worst case for a
   * first-time quadratic rationalize. Use `npm run bench` style profiling for tuning, not this.
   */
  it("analyzeLine stays in the low milliseconds on a warm instance", () => {
    engine.analyzeLine("2x + 3 = 11", feedback);
    const prev = engine.analyzeLine("x^2 - 5x + 6 = 0", feedback);
    const samples = ["2x + 3 = 11", "3.2 \\mathrm{~kg} \\cdot 9.8 \\mathrm{~m/s^2}", "\\frac{1}{2} + \\frac{1}{3}", "(x - 2)(x - 3) = 0", "Fe + O_2 \\rightarrow Fe_2O_3", "y = \\sin x"];
    const BUDGET_MS = 250;
    for (const s of samples) {
      let best = Number.POSITIVE_INFINITY;
      for (let i = 0; i < 5; i++) {
        const t0 = performance.now();
        engine.analyzeLine(s, { previous: prev, original: prev, mode: "feedback" });
        best = Math.min(best, performance.now() - t0);
      }
      expect(best, `analyzeLine(${s}) took ${best.toFixed(1)} ms`).toBeLessThan(BUDGET_MS);
    }
  });
});

describe("engine: solveLatex", () => {
  it("2x+3=11 -> x = 4 with steps", () => {
    const r = engine.solveLatex("2x+3=11");
    expect(r?.latex).toBe("x = 4");
    expect(r?.steps).toEqual(["2x = 8", "x = 4"]);
  });
  it("linear with a fraction answer", () => {
    expect(engine.solveLatex("3x + 1 = 2")?.latex).toBe("x = \\frac{1}{3}");
    expect(engine.solveLatex("3\\left(x-2\\right)=2 x+5")?.latex).toBe("x = 11");
  });
  it("quadratics: factored steps and formula steps", () => {
    const r = engine.solveLatex("x^2 - 5x + 6 = 0");
    expect(r?.latex).toBe("x = 2 \\text{ or } x = 3");
    expect(r?.steps).toContain("(x - 2)(x - 3) = 0");
    const q = engine.solveLatex("x^2 - 2x - 1 = 0");
    expect(q?.steps.some((s) => s.includes("\\pm \\sqrt"))).toBe(true);
    expect(q?.latex).toBe("x \\approx -0.4142 \\text{ or } x \\approx 2.414");
    const c = engine.solveLatex("x^2 + 1 = 0");
    expect(c?.latex).toBe("x = -i \\text{ or } x = i");
  });
  it("cubic and numeric fallback", () => {
    expect(engine.solveLatex("x^3 - 6x^2 + 11x - 6 = 0")?.latex).toBe("x = 1 \\text{ or } x = 2 \\text{ or } x = 3");
    expect(engine.solveLatex("2^x = 8")?.latex).toBe("x \\approx 3");
    expect(engine.solveLatex("\\sin x = 2")).toBeNull();
  });
  it("returns null when unsupported", () => {
    expect(engine.solveLatex("x + y = 5")).toBeNull();
    expect(engine.solveLatex("2x + 3")).toBeNull();
    expect(engine.solveLatex("\\sum x = 1")).toBeNull();
    expect(engine.solveLatex("x = x")).toBeNull();
  });
});

describe("engine: verifyExpected, balance, calculate, compileExpr", () => {
  it("verifyExpected", () => {
    expect(engine.verifyExpected("11-3", "2x=8")).toBe("equal");
    expect(engine.verifyExpected("11-3", "2x=14")).toBe("unequal");
    expect(engine.verifyExpected("8/2", "x = 4")).toBe("equal");
    expect(engine.verifyExpected("2 kg * 9.8 m/s^2", "F = 19.6 \\mathrm{~N}")).toBe("equal");
    expect(engine.verifyExpected("11-3", "2x = y")).toBe("unknown");
    expect(engine.verifyExpected("nonsense(", "2x=8")).toBe("unknown");
    expect(engine.verifyExpected("5/6", "\\frac{1}{2} + \\frac{1}{3}")).toBe("equal");
  });
  it("balance", () => {
    expect(engine.balance("Fe+O2->Fe2O3")).toEqual({ coeffs: [4, 3, 2], latex: "4\\,\\mathrm{Fe} + 3\\,\\mathrm{O_{2}} \\rightarrow 2\\,\\mathrm{Fe_{2}O_{3}}" });
    expect(engine.balance("H2 -> O2")).toBeNull();
    expect(engine.balance("")).toBeNull();
  });
  it("calculate", () => {
    expect(engine.calculate("3.2*4.5")).toEqual({ latex: "14.4" });
    expect(engine.calculate("5 km/h to m/s")).toEqual({ latex: "1.389\\,\\mathrm{m/s}" });
    expect(engine.calculate("d/dx x^3")?.latex.replace(/\s/g, "")).toBe("3\\cdot{x}^{2}");
    expect(engine.calculate("balance Fe+O2->Fe2O3")?.latex).toContain("4\\,\\mathrm{Fe}");
    expect(engine.calculate("2^10")).toEqual({ latex: "1024" });
    expect(engine.calculate("sqrt(16) + sin(30 deg)")).toEqual({ latex: "4.5" });
    expect(engine.calculate("solve 2x+3=11")).toEqual({ latex: "x = 4" });
    expect(engine.calculate("molar mass H2O")).toEqual({ latex: "18.015\\,\\mathrm{g/mol}" });
    expect(engine.calculate("integral x^2 from 0 to 1")).toEqual({ latex: "0.3333" });
    expect(engine.calculate("\\frac{1}{2} + \\frac{1}{4}")).toEqual({ latex: "\\frac{3}{4}" });
    expect(engine.calculate("2 kg * g")).toEqual({ latex: "19.61\\,\\mathrm{N}" });
    expect(engine.calculate("")).toBeNull();
    expect(engine.calculate("???")).toBeNull();
  });
  it("compileExpr", () => {
    const f = engine.compileExpr("x^2 - 1")!;
    expect(f(3)).toBe(8);
    expect(engine.compileExpr("sin(x) / x")!(0)).toBeNaN();
    expect(engine.compileExpr("1/x")!(0)).toBe(Infinity);
    expect(engine.compileExpr("x +")).toBeNull();
    expect(engine.compileExpr("x + y")).toBeNull();
    expect(engine.compileExpr("sqrt(x)")!(-1)).toBeNaN();
  });
});
