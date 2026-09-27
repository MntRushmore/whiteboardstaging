import * as mathjs from "mathjs";
import { describe, expect, it } from "vitest";
import { q } from "../algebra";
import { fromNode, gLatex, reduceAll, type G } from "../geometryExpr";
import {
  NoValue,
  NotExact,
  vAdd,
  vDegree,
  vDiv,
  vInt,
  vInverseDegrees,
  vLatex,
  vMul,
  vPi,
  vQ,
  vRoot,
  vSqrt,
  vTrig,
  vUnit,
} from "../geometryValue";
import { createMathInstance, translate } from "../math";

const math = createMathInstance(mathjs);
const tree = (latex: string): G => {
  const t = translate(math, latex);
  return fromNode(math.parse(t.source), { units: new Set(t.units.filter((u) => u !== "deg")) });
};
/** Every round of a closed expression, as the tutor writes it. */
const rounds = (latex: string) => reduceAll(tree(latex)).map((g) => gLatex(g));

describe("exact values", () => {
  it("keeps roots and π exact, and simplifies them", () => {
    expect(vLatex(vSqrt(vInt(72)))).toBe("6\\sqrt{2}");
    expect(vLatex(vSqrt(vQ(q(1, 2))))).toBe("\\frac{\\sqrt{2}}{2}");
    expect(vLatex(vMul(vSqrt(vInt(2)), vSqrt(vInt(2))))).toBe("2");
    expect(vLatex(vDiv(vInt(10), vSqrt(vInt(2))))).toBe("5\\sqrt{2}");
    expect(vLatex(vMul(vQ(q(250, 3)), vPi()))).toBe("\\frac{250\\pi}{3}");
    expect(vLatex(vDiv(vInt(50), vPi()))).toBe("\\frac{50}{\\pi}");
    expect(vLatex(vAdd(vInt(4), vMul(vInt(2), vSqrt(vInt(3)))))).toBe("4 + 2\\sqrt{3}");
    expect(vLatex(vRoot(vInt(64), 3))).toBe("4");
    expect(() => vRoot(vInt(10), 3)).toThrow(NotExact);
    // π under a root is not a value a teacher writes exactly
    expect(() => vSqrt(vDiv(vInt(50), vPi()))).toThrow(NotExact);
  });

  it("carries degrees and a length unit", () => {
    expect(vLatex(vMul(vInt(70), vDegree()))).toBe("70^{\\circ}");
    expect(vLatex(vMul(vQ(q(70, 3)), vDegree()))).toBe("\\left(\\frac{70}{3}\\right)^{\\circ}");
    expect(vLatex(vMul(vMul(vInt(25), vPi()), vMul(vUnit("cm"), vUnit("cm"))))).toBe("25\\pi\\,\\mathrm{cm}^{2}");
    // degrees over degrees is a number
    expect(vLatex(vDiv(vMul(vInt(60), vDegree()), vMul(vInt(360), vDegree())))).toBe("\\frac{1}{6}");
    // an angle and a length do not add
    expect(() => vAdd(vMul(vInt(3), vDegree()), vInt(4))).toThrow(NotExact);
  });

  it("knows the trig values at the special angles, and nothing else", () => {
    const at = (d: number) => vMul(vInt(d), vDegree());
    expect(vLatex(vTrig("sin", at(30)))).toBe("\\frac{1}{2}");
    expect(vLatex(vTrig("cos", at(45)))).toBe("\\frac{\\sqrt{2}}{2}");
    expect(vLatex(vTrig("tan", at(60)))).toBe("\\sqrt{3}");
    expect(vLatex(vTrig("cos", at(150)))).toBe("-\\frac{\\sqrt{3}}{2}");
    expect(vLatex(vTrig("sin", vMul(vQ(q(1, 6)), vPi())))).toBe("\\frac{1}{2}");
    expect(() => vTrig("tan", at(90))).toThrow(NoValue);
    expect(() => vTrig("sin", at(20))).toThrow(NotExact);
    expect(vInverseDegrees("asin", vQ(q(1, 2)))).toBe(30);
    expect(vInverseDegrees("acos", vQ(q(-1, 2)))).toBe(120);
    expect(vInverseDegrees("atan", vSqrt(vInt(3)))).toBe(60);
    expect(() => vInverseDegrees("asin", vInt(2))).toThrow(NoValue);
    expect(() => vInverseDegrees("atan", vQ(q(3, 4)))).toThrow(NotExact);
  });
});

describe("evaluation rounds (one kind of operation at a time, innermost first)", () => {
  it("works a distance the way a teacher does", () => {
    expect(rounds("\\sqrt{(4 - 1)^{2} + (6 - 2)^{2}}")).toEqual(["\\sqrt{3^{2} + 4^{2}}", "\\sqrt{9 + 16}", "\\sqrt{25}", "5"]);
  });

  it("powers before products before sums", () => {
    expect(rounds("2\\pi(3)^{2} + 2\\pi(3)(5)")).toEqual(["2\\pi(9) + 2\\pi(3)(5)", "18\\pi + 30\\pi", "48\\pi"]);
  });

  it("drops a bracket with the operation it grouped", () => {
    expect(rounds("\\frac{(8 - 2) \\cdot 180^{\\circ}}{8}")).toEqual(["\\frac{6 \\cdot 180^{\\circ}}{8}", "\\frac{1080^{\\circ}}{8}", "135^{\\circ}"]);
  });

  it("leaves a value that is not exact written, and combines the numbers beside it", () => {
    expect(rounds("8^{2} + 11^{2} - 2(8)(11)\\cos 37^{\\circ}")).toEqual(["64 + 121 - 2(8)(11)\\cos 37^{\\circ}", "64 + 121 - 176\\cos 37^{\\circ}", "185 - 176\\cos 37^{\\circ}"]);
  });

  it("refuses a value that does not exist", () => {
    expect(() => reduceAll(tree("\\tan 90^{\\circ}"))).toThrow(NoValue);
  });
});
