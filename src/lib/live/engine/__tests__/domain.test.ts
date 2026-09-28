import { beforeAll, describe, expect, it } from "vitest";
import type { LineAnalysis, LiveEngine } from "../../contracts";
import { analyzeColumn, localSolve } from "../../localSolve";
import { domainAbove, domainChain, parseDomainPiece, splitDomain } from "../domain";
import { getEngine } from "../index";

/**
 * A problem written with its interval on the line (`2\cos x = 1, 0^{\circ} \le x < 360^{\circ}`, as
 * the board chat writes one) is an EQUATION and a DOMAIN: the student's steps under it are checked
 * against the equation like under any equation, and the answer at the bottom is held to the domain.
 */

let engine: LiveEngine;
beforeAll(async () => {
  engine = await getEngine();
});

const COS = "2\\cos x = 1, 0^{\\circ} \\le x < 360^{\\circ}";
const TAN = "\\tan x = \\sqrt{3}, 0^{\\circ} \\le x < 360^{\\circ}";
const SIN = "\\sin x = -\\frac{1}{2}, 0^{\\circ} \\le x < 360^{\\circ}";
const COS_RAD = "2\\cos x = 1, \\ 0 \\le x < 2\\pi";
const COS_IN = "2\\cos x = 1, \\quad x \\in [0, 360^{\\circ})";

/** The last line of a column, analysed as the board does (each line in the context of those above). */
const last = (...lines: string[]): LineAnalysis => analyzeColumn(engine, lines, "feedback").at(-1)!;
/** tick (`ok`), ring (`mismatch`), or no mark (`none` / `unknown`), and solved */
const mark = (...lines: string[]) => {
  const a = last(...lines);
  return { verdict: a.verdict, solved: Boolean(a.solved) };
};

describe("reading an equation and its domain", () => {
  it("splits the line: the equation, and where its unknown lives", () => {
    expect(splitDomain(COS)).toMatchObject({ equation: "2\\cos x = 1", bounds: { variable: "x", loTex: "0^{\\circ}", hiTex: "360^{\\circ}", loIn: true, hiIn: false } });
    expect(splitDomain(COS_RAD)?.bounds).toMatchObject({ loTex: "0", hiTex: "2\\pi" });
    expect(splitDomain(COS_IN)?.bounds).toMatchObject({ variable: "x", loTex: "0", hiTex: "360^{\\circ}", loIn: true, hiIn: false });
    expect(splitDomain("0 \\le \\theta < 2\\pi, \\ \\sin\\theta = \\frac{1}{2}")?.equation).toBe("\\sin\\theta = \\frac{1}{2}");
    // not a domain: one-sided, two relations, no equation, a list of branches, an answer
    expect(splitDomain("x^{2} = 4, x > 0")).toBeNull();
    expect(splitDomain("x < -2, \\ x > 4")).toBeNull();
    expect(splitDomain("2x - 3 = 5, \\ 2x - 3 = -5")).toBeNull();
    expect(splitDomain("x = 60^{\\circ}, \\ x = 300^{\\circ}")).toBeNull();
    expect(splitDomain("2\\cos x = 1")).toBeNull();
  });

  it("a domain on its own, in either notation; the `\\in` form as the chain the solver reads", () => {
    expect(parseDomainPiece("0^{\\circ} \\le x < 360^{\\circ}")).toEqual({ variable: "x", loTex: "0^{\\circ}", hiTex: "360^{\\circ}", loIn: true, hiIn: false });
    expect(parseDomainPiece("x \\in \\left[0, 2\\pi\\right]")).toEqual({ variable: "x", loTex: "0", hiTex: "2\\pi", loIn: true, hiIn: true });
    expect(parseDomainPiece("x > 3")).toBeNull();
    expect(parseDomainPiece("-3 < 2x - 1 < 5")).toBeNull();
    expect(domainChain(parseDomainPiece("x \\in (0, 360)")!)).toBe("0 < x < 360");
    expect(domainAbove(["2x = 8", COS_RAD, "\\cos x = \\frac{1}{2}"])).toBe("0 \\le x < 2\\pi");
    expect(domainAbove(["2x = 8"])).toBeNull();
  });

  it("analysed as the equation (not an inequality), with the domain and its solutions there", () => {
    for (const line of [COS, COS_RAD, COS_IN]) {
      const a = last(line);
      expect(a, line).toMatchObject({ kind: "equation", math: "2 * cos(x) == 1", variable: "x" });
      expect(a.domain, line).toMatchObject({ variable: "x", lo: 0, loIn: true, hiIn: false });
      expect(a.domain!.hi).toBeCloseTo(2 * Math.PI, 9);
      expect(a.domain!.solutions!.map((v) => (v * 180) / Math.PI)).toEqual([expect.closeTo(60, 6), expect.closeTo(300, 6)]);
    }
    expect(last(COS).domain?.unit).toBe("deg");
    expect(last(COS_RAD).domain?.unit).toBe("rad");
    // plain numbers beside an angle's equation are degrees when they are that large
    expect(last("\\sin x = \\frac{1}{2}, \\ 0 \\le x < 360").domain).toMatchObject({ unit: "deg", hi: expect.closeTo(2 * Math.PI, 9) });
  });
});

describe("checking the student's steps under it", () => {
  it("the owner's three problems: the steps and the answers ticked, wrong and outside ringed", () => {
    // 2cos x = 1
    expect(mark(COS, "\\cos x = \\frac{1}{2}")).toEqual({ verdict: "ok", solved: false });
    expect(mark(COS, "\\cos^{-1}\\left(\\frac{1}{2}\\right) = 60^{\\circ}").verdict).toBe("ok");
    expect(mark(COS, "x = 60^{\\circ}, 300^{\\circ}")).toEqual({ verdict: "ok", solved: true });
    expect(mark(COS, "x = 60^{\\circ}, \\ x = 360^{\\circ} - 60^{\\circ}")).toEqual({ verdict: "ok", solved: true });
    expect(mark(COS, "x = 50^{\\circ}").verdict).toBe("mismatch");
    expect(mark(COS, "\\cos x = 2").verdict).toBe("mismatch");
    // tan x = √3: 60°, 240°
    expect(mark(TAN, "\\tan^{-1}(\\sqrt{3}) = 60^{\\circ}").verdict).toBe("ok");
    expect(mark(TAN, "x = 60^{\\circ}, 240^{\\circ}")).toEqual({ verdict: "ok", solved: true });
    expect(mark(TAN, "x = 60^{\\circ}, 120^{\\circ}").verdict).toBe("mismatch");
    // sin x = -1/2: 210°, 330°
    expect(mark(SIN, "x = 210^{\\circ}, 330^{\\circ}")).toEqual({ verdict: "ok", solved: true });
    expect(mark(SIN, "x = 30^{\\circ}, 150^{\\circ}").verdict).toBe("mismatch");
  });

  it("an answer outside the interval is ringed, though it solves the equation", () => {
    const a = last(COS, "x = 420^{\\circ}");
    expect(a.verdict).toBe("mismatch");
    expect(a.solved).toBe(false);
    expect(a.note).toBe("Outside the interval");
    expect(mark(COS, "x = 60^{\\circ}, 300^{\\circ}, 420^{\\circ}").verdict).toBe("mismatch");
    // with no interval written, 420° is as good an answer as 60°
    expect(mark("2\\cos x = 1", "x = 420^{\\circ}").verdict).toBe("ok");
  });

  it("the answer written under a ringed line is still ticked: it is the problem's, whatever the line above", () => {
    expect(mark(SIN, "x = 50^{\\circ}", "x = 210^{\\circ}, 330^{\\circ}")).toEqual({ verdict: "ok", solved: true });
    expect(mark(SIN, "x = 50^{\\circ}", "x = 210^{\\circ}")).toEqual({ verdict: "ok", solved: false });
    expect(mark(SIN, "x = 50^{\\circ}", "x = 200^{\\circ}").verdict).not.toBe("ok");
  });

  it("one of two solutions: a tick (it is right), but not solved — the other is still to find", () => {
    expect(mark(COS, "x = 60^{\\circ}")).toEqual({ verdict: "ok", solved: false });
    expect(mark(SIN, "x = 330^{\\circ}")).toEqual({ verdict: "ok", solved: false });
  });

  it("deep in the column: the domain is carried down to the answer", () => {
    expect(mark(COS, "\\cos x = \\frac{1}{2}", "x = 60^{\\circ}, 300^{\\circ}")).toEqual({ verdict: "ok", solved: true });
    expect(mark(COS, "\\cos x = \\frac{1}{2}", "\\cos^{-1}\\left(\\frac{1}{2}\\right) = 60^{\\circ}", "x = 60^{\\circ}, 300^{\\circ}")).toEqual({ verdict: "ok", solved: true });
    expect(mark(COS, "\\cos x = \\frac{1}{2}", "x = 420^{\\circ}").verdict).toBe("mismatch");
    expect(mark(COS, "\\cos x = \\frac{1}{2}", "x = 60^{\\circ}")).toEqual({ verdict: "ok", solved: false });
  });

  it("in radians: π answers checked in the same interval; degrees still read as angles", () => {
    expect(mark(COS_RAD, "x = \\frac{\\pi}{3}, \\frac{5\\pi}{3}")).toEqual({ verdict: "ok", solved: true });
    expect(mark(COS_RAD, "x = \\frac{\\pi}{3}")).toEqual({ verdict: "ok", solved: false });
    expect(mark(COS_RAD, "x = \\frac{7\\pi}{3}").verdict).toBe("mismatch");
    expect(mark(COS_RAD, "x = 60^{\\circ}, 300^{\\circ}")).toEqual({ verdict: "ok", solved: true });
  });

  it("an interval in plain degrees: `x = 210, 330` is read in degrees", () => {
    const plain = "\\sin x = -\\frac{1}{2}, \\ 0 \\le x < 360";
    expect(mark(plain, "x = 210, 330")).toEqual({ verdict: "ok", solved: true });
    expect(mark(plain, "x = 200").verdict).toBe("mismatch");
  });

  it("the interval written again: a tick, and the answer under it still checked; another interval is ringed", () => {
    expect(mark(COS, "0^{\\circ} \\le x < 360^{\\circ}").verdict).toBe("ok");
    expect(mark(COS, "0^{\\circ} \\le x < 360^{\\circ}", "x = 60^{\\circ}, 300^{\\circ}")).toEqual({ verdict: "ok", solved: true });
    expect(mark(COS, "0^{\\circ} \\le x < 360^{\\circ}", "\\cos x = \\frac{1}{2}").verdict).toBe("ok");
    expect(mark(COS, "0^{\\circ} \\le x < 180^{\\circ}").verdict).toBe("mismatch");
    // the whole problem written again, interval and all
    expect(mark(COS, "2\\cos x = 1, \\ 0^{\\circ} \\le x < 360^{\\circ}").verdict).toBe("ok");
  });

  it("with no interval written, naming one is a tick for the one turn Solve writes; the answer is then held to it", () => {
    expect(mark("2\\cos x = 1", "0^{\\circ} \\le x < 360^{\\circ}").verdict).toBe("ok");
    expect(mark("2\\cos x = 1", "0^{\\circ} \\le x < 90^{\\circ}").verdict).toBe("none");
    expect(mark("2\\cos x = 1", "0^{\\circ} \\le x < 360^{\\circ}", "x = 420^{\\circ}").verdict).toBe("mismatch");
  });

  it("compound inequalities that are answers stay what they were", () => {
    expect(last("|2x - 1| < 5", "-5 < 2x - 1 < 5")).toMatchObject({ kind: "inequality", verdict: "ok" });
    expect(last("-3 < x - 1 < 3").kind).toBe("inequality");
    expect(last("-3 < x - 1 < 3").domain).toBeUndefined();
  });
});

describe("Solve under it", () => {
  it("from the problem: its solutions in its interval, in its unit", () => {
    expect(localSolve(engine, [COS]).steps.at(-1)).toBe("x = 60^{\\circ}, \\ x = 300^{\\circ}");
    expect(localSolve(engine, [COS_IN]).steps.at(-1)).toBe("x = 60^{\\circ}, \\ x = 300^{\\circ}");
    expect(localSolve(engine, [COS_RAD]).steps.at(-1)).toBe("x = \\frac{\\pi}{3}, \\ x = \\frac{5\\pi}{3}");
  });

  it("from the student's step under it: in the problem's interval, not a default turn in degrees", () => {
    const rad = localSolve(engine, [COS_RAD, "\\cos x = \\frac{1}{2}"]);
    expect(rad.steps.at(-1)).toBe("x = \\frac{\\pi}{3}, \\ x = \\frac{5\\pi}{3}");
    expect(rad.steps).not.toContain("0^{\\circ} \\le x < 360^{\\circ}");
    const half = localSolve(engine, ["\\sin x = \\frac{1}{2}, \\ 0^{\\circ} \\le x < 180^{\\circ}", "\\sin x = \\frac{1}{2}"]);
    expect(half.steps.at(-1)).toBe("x = 30^{\\circ}, \\ x = 150^{\\circ}");
    // the loop passes a chat problem's domain, the problem not being among the lines
    expect(localSolve(engine, ["\\cos x = \\frac{1}{2}"], undefined, { domain: "0 \\le x < 2\\pi" }).steps.at(-1)).toBe("x = \\frac{\\pi}{3}, \\ x = \\frac{5\\pi}{3}");
  });
});
