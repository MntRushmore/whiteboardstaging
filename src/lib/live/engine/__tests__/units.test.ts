import { beforeAll, describe, expect, it } from "vitest";
import { create, all } from "mathjs";
import type { LiveEngine } from "../../contracts";
import { getEngine } from "..";
import { evaluateUnits, preferUnit, UNIT_MISMATCH_NOTE, unitsEqual, VALUELESS_ADD_NOTE } from "../units";
import { physicsScope, registerConstants } from "../constants";

let engine: LiveEngine;
const math = create(all);
registerConstants(math);

beforeAll(async () => {
  engine = await getEngine();
});

const feedback = { mode: "feedback" as const };

describe("units: engine lines", () => {
  it("3.2 kg \\cdot 9.8 m/s^2 -> 31.36 N", () => {
    const a = engine.analyzeLine("3.2 kg \\cdot 9.8 m/s^2", feedback);
    expect(a.kind).toBe("expression");
    expect(a.resultLatex).toBe("31.36\\,\\mathrm{N}");
    expect(a.units).toEqual({ ok: true });
    const b = engine.analyzeLine("3.2 \\mathrm{~kg} \\cdot 9.8 \\mathrm{~m} / \\mathrm{s}^{2}", feedback);
    expect(b.resultLatex).toBe("31.36\\,\\mathrm{N}");
  });
  it("5 mi/h -> 2.235 m/s via a conversion", () => {
    const a = engine.analyzeLine("5 \\mathrm{~mi/h} \\to \\mathrm{m/s}", feedback);
    expect(a.resultLatex).toBe("2.235\\,\\mathrm{m/s}");
    expect(engine.calculate("5 mi/h to m/s")).toEqual({ latex: "2.235\\,\\mathrm{m/s}" });
    expect(engine.calculate("5 km/h to m/s")).toEqual({ latex: "1.389\\,\\mathrm{m/s}" });
  });
  it("m + cm -> units.ok false with a note", () => {
    const a = engine.analyzeLine("m + cm", feedback);
    expect(a.units?.ok).toBe(false);
    expect(a.note.length).toBeGreaterThan(0);
    expect(a.note).toBe(VALUELESS_ADD_NOTE);
  });
  it("3 m + 2 s -> units.ok false: These units don't add together", () => {
    const a = engine.analyzeLine("3 \\mathrm{~m} + 2 \\mathrm{~s}", feedback);
    expect(a.units?.ok).toBe(false);
    expect(a.note).toBe(UNIT_MISMATCH_NOTE);
    expect(a.resultLatex).toBe("");
  });
  it("compatible additions convert", () => {
    const a = engine.analyzeLine("2 \\mathrm{~m} + 3 \\mathrm{~cm}", feedback);
    expect(a.units?.ok).toBe(true);
    expect(a.resultLatex).toBe("2.03\\,\\mathrm{m}");
  });
  it("a bare quantity shows no result", () => {
    expect(engine.analyzeLine("3 \\mathrm{~kg}", feedback).resultLatex).toBe("");
  });
  it("physics constants apply on unit lines", () => {
    const a = engine.analyzeLine("2 \\mathrm{~kg} \\cdot g", feedback);
    expect(a.resultLatex).toBe("19.61\\,\\mathrm{N}");
    const b = engine.analyzeLine("2 g", feedback);
    expect(b.kind).toBe("expression");
    expect(b.resultLatex).toBe("");
  });
  it("degrees: sin 30 deg", () => {
    expect(engine.analyzeLine("\\sin 30^{\\circ}", feedback).resultLatex).toBe("0.5");
    expect(engine.analyzeLine("\\cos 60^\\circ + 1", feedback).resultLatex).toBe("1.5");
  });
  it("prefers derived units", () => {
    expect(engine.analyzeLine("12 \\mathrm{~V} / 3 \\mathrm{~\\Omega}", feedback).resultLatex).toBe("4\\,\\mathrm{A}");
    expect(engine.analyzeLine("2 \\mathrm{~kg} \\cdot 9.8 \\mathrm{~m/s^2} \\cdot 3 \\mathrm{~m}", feedback).resultLatex).toBe("58.8\\,\\mathrm{J}");
    expect(engine.analyzeLine("100 \\mathrm{~W} \\cdot 2 \\mathrm{~s}", feedback).resultLatex).toBe("200\\,\\mathrm{J}");
  });
  it("temperature", () => {
    expect(engine.analyzeLine("20^{\\circ}C \\to K", feedback).resultLatex).toBe("293.2\\,\\mathrm{K}");
  });
});

describe("units: module helpers", () => {
  it("preferUnit simplifies kg m / s^2 to N", () => {
    const u = preferUnit(math, math.evaluate("3.2 kg * 9.8 m/s^2"));
    expect(u.formatUnits()).toBe("N");
    expect(u.toNumber("N")).toBeCloseTo(31.36, 6);
  });
  it("evaluateUnits maps mismatches to notes", () => {
    expect(evaluateUnits(math, "1 m + 1 s").note).toBe(UNIT_MISMATCH_NOTE);
    expect(evaluateUnits(math, "m + cm").note).toBe(VALUELESS_ADD_NOTE);
    expect(evaluateUnits(math, "1 m + 1 cm").latex).toBe("1.01\\,\\mathrm{m}");
  });
  it("unitsEqual compares across units", () => {
    expect(unitsEqual(math, math.evaluate("1 m"), math.evaluate("100 cm"))).toBe(true);
    expect(unitsEqual(math, math.evaluate("1 m"), math.evaluate("1 s"))).toBe(false);
    expect(unitsEqual(math, 3, 3.0000001)).toBe(false);
    expect(unitsEqual(math, 3, 3)).toBe(true);
  });
  it("physicsScope carries g, c, h, G, R, e", () => {
    const scope = physicsScope(math);
    expect(Object.keys(scope).sort()).toEqual(["G", "R", "c", "e", "g", "h"]);
    expect(String(math.evaluate("2 kg * g", scope))).toMatch(/19\.6133 N/);
  });
});

describe("units: student notation edge cases", () => {
  it("mph and kph convert through hours, not Planck's constant", () => {
    expect(engine.analyzeLine("60 \\mathrm{~mph} \\to \\mathrm{km/h}", feedback).resultLatex).toBe("96.56\\,\\mathrm{km/h}");
  });
  it("`in` after a number is inches, otherwise a conversion", () => {
    expect(engine.analyzeLine("3 \\mathrm{~ft} + 4 \\mathrm{~in}", feedback).resultLatex).toBe("3.333\\,\\mathrm{ft}");
    expect(engine.analyzeLine("5 \\mathrm{~km} \\text{ in } \\mathrm{m}", feedback).resultLatex).toBe("5000\\,\\mathrm{m}");
  });
  it("ALL-CAPS symbols are algebra, not prefixed units", () => {
    const a = engine.analyzeLine("\\mathrm{PV} = \\mathrm{nRT}", feedback);
    expect(a.kind).toBe("equation");
    expect(a.verdict).toBe("unknown");
    expect(a.math).toBe("PV == nRT");
    expect(engine.analyzeLine("KE = \\frac{1}{2} m v^2", feedback).verdict).toBe("unknown");
    expect(engine.analyzeLine("3 \\mathrm{~MJ} + 500 \\mathrm{~kJ}", feedback).resultLatex).toBe("3.5\\,\\mathrm{MJ}");
  });
  it("physics assignments evaluate with units and chain", () => {
    const [d1] = [engine.analyzeLine("d = 5 \\mathrm{~m/s} \\cdot 3 \\mathrm{~s}", feedback)];
    expect(d1.kind).toBe("assignment");
    expect(d1.resultLatex).toBe("15\\,\\mathrm{m}");
    const d2 = engine.analyzeLine("d = 15 \\mathrm{~m}", { previous: d1, mode: "feedback" });
    expect(d2.verdict).toBe("ok");
    const e = engine.analyzeLine("E = 2 \\mathrm{~kg} \\cdot c^2", feedback);
    expect(e.resultLatex).toBe("1.798 \\times 10^{17}\\,\\mathrm{J}");
    const n = engine.analyzeLine("n = \\frac{18 \\mathrm{~g}}{18 \\mathrm{~g/mol}}", feedback);
    expect(n.resultLatex).toBe("1\\,\\mathrm{mol}");
  });
});
