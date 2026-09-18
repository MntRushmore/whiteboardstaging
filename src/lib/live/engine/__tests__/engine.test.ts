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
    expect(i.resultLatex).toBe("\\frac{1}{3}");
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
    // a sum whose upper limit is symbolic is read but not evaluated: no result, never a guess
    const symbolicSum = engine.analyzeLine("\\sum_{i=1}^n i", feedback);
    expect(symbolicSum.resultLatex).toBe("");
    expect(engine.analyzeLine("\\lim_{x \\to 0} \\frac{\\sin x}{x}", feedback).kind).toBe("unknown");
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

// ---------------------------------------------------------------------------
// Calculus, sums and percentages (the "can it do harder maths?" set).
//
// Every table here is a *correct answer* table: the engine either produces the value a teacher
// would write, or it produces nothing. There is deliberately no case where a plausible-looking
// approximation stands in for an answer the engine cannot actually compute.
// ---------------------------------------------------------------------------
const answerFor = (latex: string): string => engine.analyzeLine(latex, answer).resultLatex;
/** node-rendered answers (derivatives) differ only in spacing between mathjs patch releases */
const tight = (latex: string): string => answerFor(latex).replace(/\s/g, "");

describe("engine: derivatives", () => {
  const cases: Array<[string, string]> = [
    ["\\frac{d}{dx} x^3 =", "3\\cdot{x}^{2}"],
    ["\\frac{d}{dx}(3x^2 + 2x) =", "6\\cdotx+2"],
    ["\\frac{d}{dx} 3x =", "3"],
    // a constant: the answer is 0, not the constant itself
    ["\\frac{d}{dx} 7 =", "0"],
    // a negative power: the exponent drops to -3, it does not become 2x^{-3}
    ["\\frac{d}{dx} x^{-2} =", "-\\frac{2}{{x}^{3}}"],
    ["\\frac{d}{dx} \\frac{1}{x} =", "-\\frac{1}{{x}^{2}}"],
    ["\\frac{d}{dx} \\sin x =", "\\cos\\left(x\\right)"],
    ["\\frac{d}{dx} \\ln x =", "\\frac{1}{x}"],
    ["\\frac{d}{dx} e^x =", "{e}^{x}"],
    // the variable comes from the notation, not from a guess
    ["\\frac{d}{dt}(5t^3 - t) =", "15\\cdot{t}^{2}-1"],
    ["\\frac{d^2}{dx^2} x^4 =", "12\\cdot{x}^{2}"],
  ];
  it.each(cases)("%s -> %s", (latex, expected) => {
    expect(tight(latex)).toBe(expected);
  });
  it("classifies as an expression and follows the answer-mode rule", () => {
    const a = engine.analyzeLine("\\frac{d}{dx} x^3 =", feedback);
    expect(a.kind).toBe("expression");
    expect(a.math).toBe('derivative("x ^ 3", "x")');
    // a trailing `=` is an answer-mode reveal, exactly like `36 + 2 =`
    expect(a.resultLatex).toBe("");
    expect(engine.analyzeLine("\\frac{d}{dx} x^3", feedback).resultLatex.replace(/\s/g, "")).toBe("3\\cdot{x}^{2}");
  });
  it("checks a derivative the student wrote out", () => {
    expect(engine.analyzeLine("\\frac{d}{dx} x^2 = 2x", feedback).verdict).toBe("ok");
    expect(engine.analyzeLine("\\frac{d}{dx} x^2 = 3x", feedback).verdict).toBe("mismatch");
  });
  it("differentiates through the functions it knows", () => {
    expect(tight("\\frac{d}{dx} \\sin(2x) =")).toBe("2\\cdot\\cos\\left(2\\cdotx\\right)");
    expect(tight("\\frac{d}{dx} \\left( x^2 + 1 \\right) =")).toBe("2\\cdotx");
    // juxtaposition is still multiplication, exactly as everywhere else in the engine
    expect(tight("\\frac{d}{dx} 2(x+1) =")).toBe("2");
    expect(tight("\\frac{d}{dx} x(x+1) =")).toBe("2\\cdotx+1");
  });
  it("gives no answer when it cannot differentiate", () => {
    const refused = [
      "\\frac{d}{dx} =", // no operand
      "\\frac{dy}{dx} =", // y is not defined anywhere
      "f'(x) =", // f is not defined anywhere
      // an unknown function must not be read as a constant factor and answered with `f`
      "\\frac{d}{dx} f(x) =",
      "\\frac{d}{dx} \\left(f(x)\\right) =",
      "\\frac{d}{dx} \\Gamma(x) =",
    ];
    for (const bad of refused) {
      const a = engine.analyzeLine(bad, answer);
      expect(a.resultLatex, bad).toBe("");
      expect(a.verdict, bad).not.toBe("ok");
      expect(a.kind, bad).toBe("unknown");
    }
  });
  it("reads \\frac{dy}{dx} and f'(x) against a definition on an earlier line", () => {
    const y = engine.analyzeLine("y = x^2 + 3", feedback);
    expect(y.kind).toBe("function");
    const ctx = { mode: "answer" as const, previous: y };
    expect(engine.analyzeLine("\\frac{dy}{dx} =", ctx).resultLatex.replace(/\s/g, "")).toBe("2\\cdotx");
    expect(engine.analyzeLine("\\frac{dy}{dx} = 2x", ctx).verdict).toBe("ok");
    expect(engine.analyzeLine("\\frac{dy}{dx} = 3x", ctx).verdict).toBe("mismatch");
    const f = engine.analyzeLine("f(x) = x^2 - 4", feedback);
    const fctx = { mode: "answer" as const, previous: f };
    expect(engine.analyzeLine("f'(x) =", fctx).resultLatex.replace(/\s/g, "")).toBe("2\\cdotx");
    expect(engine.analyzeLine("f'(x) = 2x", fctx).verdict).toBe("ok");
    // the wrong variable is refused rather than differentiated anyway
    expect(engine.analyzeLine("f'(t) =", fctx).kind).toBe("unknown");
    expect(engine.analyzeLine("f'(t) =", fctx).resultLatex).toBe("");
  });
});

describe("engine: definite integrals", () => {
  const cases: Array<[string, string]> = [
    // polynomials are integrated exactly, so the answer is a fraction and not 0.3333
    ["\\int_0^1 x^2 dx =", "\\frac{1}{3}"],
    ["\\int_{0}^{1} x^2 \\, dx =", "\\frac{1}{3}"],
    // limits that are not 0 and 1
    ["\\int_{1}^{3} 2x \\, dx =", "8"],
    ["\\int_{-1}^{2} (3x^2 - 2x) dx =", "6"],
    // a constant integrand is width x height, not 0
    ["\\int_{2}^{5} 4 \\, dx =", "12"],
    // odd function over a symmetric interval
    ["\\int_{-1}^{1} x^3 dx =", "0"],
    // swapped limits flip the sign; equal limits are 0
    ["\\int_{3}^{1} x dx =", "-4"],
    ["\\int_{2}^{2} x^2 dx =", "0"],
    ["\\int_{0}^{\\frac{1}{2}} x dx =", "\\frac{1}{8}"],
    // not polynomials: a numeric value to 4 significant figures, never dressed up as exact
    ["\\int_{0}^{\\pi} \\sin x \\, dx =", "2"],
    ["\\int_{1}^{2} x^{-2} dx =", "0.5"],
    ["\\int_{1}^{2} \\frac{1}{x} dx =", "0.6931"],
    ["\\int_{0}^{2} e^x dx =", "6.389"],
  ];
  it.each(cases)("%s -> %s", (latex, expected) => {
    expect(answerFor(latex)).toBe(expected);
  });
  it("classifies as an expression with a bound integration variable", () => {
    const a = engine.analyzeLine("\\int_0^1 x^2 dx", feedback);
    expect(a.kind).toBe("expression");
    expect(a.math).toBe('integral("x ^ 2", "x", 0, 1)');
    // dx binds x, so the line is a number and shows its value without a trailing `=`
    expect(a.resultLatex).toBe("\\frac{1}{3}");
  });
  it("checks an integral the student wrote out", () => {
    expect(engine.analyzeLine("\\int_0^1 x^2 \\, dx = \\frac{1}{3}", feedback).verdict).toBe("ok");
    expect(engine.analyzeLine("\\int_0^1 x^2 \\, dx = 0.5", feedback).verdict).toBe("mismatch");
  });
  it("gives no answer for integrals it cannot do", () => {
    const refused = [
      "\\int x^2 dx =", // indefinite
      "\\int_{-1}^{1} \\frac{1}{x} dx =", // singular inside the interval
      "\\int_{0}^{1} \\frac{1}{x} dx =", // divergent at the endpoint
      "\\int_{-1}^{1} \\sqrt{x} dx =", // not real on the whole interval
      "\\int_{0}^{1} x^2 dt =", // the dx does not match the integrand
      "\\int_{0}^{\\infty} e^{-x} dx =", // an infinite limit
    ];
    for (const latex of refused) {
      const a = engine.analyzeLine(latex, answer);
      expect(a.resultLatex, latex).toBe("");
      expect(a.verdict, latex).not.toBe("ok");
    }
  });
});

describe("engine: finite sums", () => {
  const cases: Array<[string, string]> = [
    ["\\sum_{i=1}^{10} i =", "55"],
    ["\\sum_{k=1}^{4} k^2 =", "30"],
    ["\\sum_{n=0}^{3} 2^n =", "15"],
    ["\\sum_{j=2}^{5} (j - 1) =", "10"],
    ["\\sum_{i=1}^{3} \\frac{1}{i} =", "\\frac{11}{6}"],
    ["\\sum_{i=1}^{100} i =", "5050"],
  ];
  it.each(cases)("%s -> %s", (latex, expected) => {
    expect(answerFor(latex)).toBe(expected);
  });
  it("classifies as an expression with a bound index", () => {
    const a = engine.analyzeLine("\\sum_{i=1}^{10} i", feedback);
    expect(a.kind).toBe("expression");
    expect(a.math).toBe('summation("i", "i", 1, 10)');
    expect(a.resultLatex).toBe("55");
    expect(engine.analyzeLine("\\sum_{i=1}^{10} i = 55", feedback).verdict).toBe("ok");
    expect(engine.analyzeLine("\\sum_{i=1}^{10} i = 50", feedback).verdict).toBe("mismatch");
  });
  it("gives no answer for sums it cannot do", () => {
    for (const latex of ["\\sum_{i=1}^{\\infty} i =", "\\sum_{i=1}^{n} i =", "\\sum_{i=1}^{3} i + 1 =", "\\sum i =", "\\sum_{i=1}^{1000000} i ="]) {
      const a = engine.analyzeLine(latex, answer);
      expect(a.resultLatex, latex).toBe("");
      expect(a.verdict, latex).not.toBe("ok");
    }
    // an ambiguous summand is refused outright rather than read one of the two ways
    expect(engine.analyzeLine("\\sum_{i=1}^{3} i + 1 =", answer).kind).toBe("unknown");
  });
});

describe("engine: percent of", () => {
  const cases: Array<[string, string]> = [
    ["15\\% \\text{ of } 80 =", "12"],
    ["15% of 80", "12"],
    ["20\\% \\text{ of } 45 =", "9"],
    ["\\frac{1}{4} \\text{ of } 60 =", "15"],
    // percentages answer in decimals: 0.36, never \frac{9}{25}
    ["12\\% \\text{ of } 3 =", "0.36"],
  ];
  it.each(cases)("%s -> %s", (latex, expected) => {
    expect(answerFor(latex)).toBe(expected);
  });
  it("classifies as an expression and checks a written-out answer", () => {
    const a = engine.analyzeLine("15\\% \\text{ of } 80 =", answer);
    expect(a.kind).toBe("expression");
    expect(a.math).toBe("15 / 100 * 80");
    expect(engine.analyzeLine("15\\% \\text{ of } 80 = 12", feedback).verdict).toBe("ok");
    expect(engine.analyzeLine("15\\% \\text{ of } 80 = 20", feedback).verdict).toBe("mismatch");
    // a bare percentage is not a calculation worth echoing
    expect(engine.analyzeLine("50\\%", feedback).resultLatex).toBe("");
    // `%` still means modulo in calculator text
    expect(engine.calculate("7 % 3")).toEqual({ latex: "1" });
    expect(engine.calculate("15% of 80")).toEqual({ latex: "12" });
  });
});

describe("engine: constructs the engine refuses", () => {
  /**
   * Rule: what the engine cannot do comes back `unknown` with no result. `unknown` is the one
   * kind that says "this is maths I could not read" -- it is never a wrong answer, and it is not
   * `text` (a caption) or `incomplete` (keep writing), both of which would be pretending.
   */
  it("limits are unsupported, in both directions", () => {
    for (const latex of ["\\lim_{x \\to 0} \\frac{\\sin x}{x} =", "\\lim_{x \\to 0} \\frac{\\sin x}{x}", "\\lim_{x \\to \\infty} \\frac{1}{x}", "\\lim_{n \\to \\infty} (1 + 1/n)^n ="]) {
      const a = engine.analyzeLine(latex, answer);
      expect(a.kind, latex).toBe("unknown");
      expect(a.resultLatex, latex).toBe("");
      expect(a.verdict, latex).toBe("unknown");
    }
  });
  it("matrices are unknown, not prose", () => {
    for (const latex of ["\\begin{pmatrix}1&2\\\\3&4\\end{pmatrix}", "\\begin{bmatrix}1&2\\\\3&4\\end{bmatrix} =", "\\begin{vmatrix}1&2\\\\3&4\\end{vmatrix}", "\\begin{cases} x > 0 \\\\ x < 5 \\end{cases}"]) {
      const a = engine.analyzeLine(latex, answer);
      expect(a.kind, latex).toBe("unknown");
      expect(a.resultLatex, latex).toBe("");
    }
  });
  it("never answers a line it could not read, whatever the mode", () => {
    const hostile = ["\\lim_{x \\to 0} x =", "\\begin{matrix}1\\end{matrix} =", "\\frac{dy}{dx} =", "f'(x) =", "\\int x dx =", "\\sum_{i=1}^{n} i =", "\\oint_C F dr =", "\\nabla \\cdot F ="];
    for (const latex of hostile) {
      for (const ctx of [feedback, answer]) {
        const a = engine.analyzeLine(latex, ctx);
        expect(a.resultLatex, latex).toBe("");
        expect(a.verdict, latex).not.toBe("ok");
        expect(LINE_KINDS).toContain(a.kind);
      }
    }
  });
});

describe("engine: regression net — everything that already worked", () => {
  const cases: Array<[string, string]> = [
    ["36 + 2 =", "38"],
    ["\\frac{3}{4} + \\frac{1}{6}", "\\frac{11}{12}"],
    ["\\frac{1}{2} + \\frac{1}{3}", "\\frac{5}{6}"],
    ["2 + 3 \\cdot 4 - 1", "13"],
    ["2^{10} =", "1024"],
    ["\\sqrt{144}", "12"],
    ["\\sqrt{16}", "4"],
    ["\\sin(30^\\circ)", "0.5"],
    ["\\log_{2}(8)", "3"],
    ["\\ln(e^2)", "2"],
    ["2\\pi", "6.283"],
    ["5 km/h \\text{ to } m/s", "1.389\\,\\mathrm{m/s}"],
  ];
  it.each(cases)("%s -> %s", (latex, expected) => {
    expect(answerFor(latex)).toBe(expected);
  });
  it("keeps the calculator rule, kinds and verdicts", () => {
    expect(engine.analyzeLine("2 + 3", feedback).resultLatex).toBe("");
    expect(engine.analyzeLine("12", feedback).resultLatex).toBe("");
    expect(engine.analyzeLine("36 + 2 =", feedback).resultLatex).toBe("");
    expect(engine.analyzeLine("2x + 3", feedback).resultLatex).toBe("");
    expect(engine.analyzeLine("1)", feedback).kind).toBe("label");
    expect(engine.analyzeLine("2x + 3 =", feedback).kind).toBe("incomplete");
    expect(engine.analyzeLine("2x + (3", feedback).kind).toBe("incomplete");
    expect(engine.analyzeLine("\\text{Find the slope}", feedback).kind).toBe("text");
    expect(engine.analyzeLine("\\checkmark", feedback).kind).toBe("label");
    expect(engine.analyzeLine("(3, -4)", feedback).kind).toBe("point");
    expect(engine.analyzeLine("y = 2x + 1", feedback).kind).toBe("function");
    expect(engine.analyzeLine("x = 4", feedback).kind).toBe("assignment");
    expect(engine.analyzeLine("2 + 2 = 4", feedback).verdict).toBe("ok");
    expect(engine.analyzeLine("2 + 2 = 5", feedback).verdict).toBe("mismatch");
  });
  it("keeps solveLatex, chemistry and the calculator", () => {
    expect(engine.solveLatex("x^2 - 5x + 6 = 0")?.latex).toBe("x = 2 \\text{ or } x = 3");
    expect(engine.solveLatex("2x+3=11")?.latex).toBe("x = 4");
    expect(engine.analyzeLine("Fe + O_2 \\rightarrow Fe_2O_3", feedback).kind).toBe("chem");
    expect(engine.balance("Fe+O2->Fe2O3")?.coeffs).toEqual([4, 3, 2]);
    expect(engine.calculate("3.2*4.5")).toEqual({ latex: "14.4" });
    expect(engine.calculate("5 km/h to m/s")).toEqual({ latex: "1.389\\,\\mathrm{m/s}" });
  });
});
