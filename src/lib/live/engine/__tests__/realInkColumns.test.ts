import { beforeAll, describe, expect, it } from "vitest";
import type { LiveEngine } from "../../contracts";
import { getEngine } from "..";
import { youngReadOf } from "@/lib/brain";
import { judgeColumn } from "../columnWork";

/**
 * Columns the real-ink bench found misjudged with perfect reads (docs/REAL-INK-BENCH.md): what real
 * children write, re-said as plain LaTeX — no child's ink or words here; the corpus never enters the
 * repo. The tutor's logic alone; the loop's tests hold the ink side.
 */

let engine: LiveEngine;
beforeAll(async () => {
  engine = await getEngine();
}, 60_000);

const marks = (column: { problem?: string[]; lines: string[] }) =>
  judgeColumn(engine, column).map((a) => (a ? `${a.verdict}${a.solved ? "+solved" : ""}${a.carried ? "+carried" : ""}` : null));

describe("a lone number under an equation in one letter", () => {
  it("is the letter's value when it is right: a tick, and the problem solved", () => {
    expect(marks({ problem: ["\\frac{x}{2} - 5 = 1"], lines: ["12"] })).toEqual(["ok+solved"]);
    expect(marks({ problem: ["3x + 4 = 19"], lines: ["5"] })).toEqual(["ok+solved"]);
    expect(marks({ problem: ["2x + 3 = 11"], lines: ["2x = 8", "4"] })).toEqual(["ok", "ok+solved"]);
  });

  it("after a line that works out a letter's value, is that value", () => {
    expect(marks({ problem: ["y = -\\frac{2}{3}x + 8", "x = 9"], lines: ["y = -\\frac{2}{3}(9) + 8", "y = -6 + 8", "2"] }).slice(1)).toEqual(["ok", "ok"]);
  });

  it("is never ringed when it is not the value: it may be a side sum (a ring there would be on right work)", () => {
    expect(marks({ problem: ["\\frac{x}{2} - 5 = 1"], lines: ["14"] })).toEqual(["none"]);
    expect(marks({ problem: ["2x + 3 = 11"], lines: ["8"] })).toEqual(["none"]);
  });

  it("leaves the arithmetic rules as they were", () => {
    expect(marks({ problem: ["11 + 9 \\times 2"], lines: ["11 + 18", "29"] })).toEqual(["ok", "ok+solved"]);
    expect(marks({ problem: ["5x - 4 = 21"], lines: ["+4 +4", "5x = 25", "x = 5"] })).toEqual(["ok", "ok", "ok+solved"]);
  });
});

describe("a child's notes of what they do to both sides, read into the line", () => {
  it("are not judged: the equation is (a ring was on right work)", () => {
    expect(marks({ problem: ["\\frac{x}{4} - 4 = -1"], lines: ["+4 \\quad +4", "\\frac{x}{4}=3 \\quad \\times 4", "x=12"] })).toEqual(["ok", "ok", "ok+solved"]);
    expect(marks({ problem: ["\\frac{x}{4} - 4 = -1"], lines: ["\\frac{x}{4}=3 \\times 4 \\times 4"] })).toEqual(["ok"]);
    expect(marks({ problem: ["3(x - 2) = 15"], lines: ["\\begin{array}{l}\nx-2=5 \\\\\n+2+2\n\\end{array}", "x=7"] })).toEqual(["ok", "ok+solved"]);
  });

  it("never hide a slip, and a product stays a product", () => {
    expect(marks({ problem: ["\\frac{x}{4} - 4 = -1"], lines: ["\\frac{x}{4}=5 \\quad \\times 4"] })).toEqual(["mismatch"]);
    expect(marks({ problem: ["\\frac{x}{4} = 3"], lines: ["x = 3 \\times 4"] })).toEqual(["ok+solved"]);
  });
});


/**
 * Open: found by the real-ink bench, not fixed yet. `it.fails` passes while the tutor still gets it
 * wrong and fails the day it is put right — then make it an `it`.
 */
describe("open classes (known issues)", () => {
  it.fails("a function's value worked in one chained line is judged: `= 4(1) + 1 = 5` for h(1)", () => {
    expect(marks({ problem: ["h(x) = 4x + 1", "h(1)"], lines: ["= 4(1) + 1 = 5"] })).toEqual(["ok+solved"]);
  });

  it.fails("…and a wrong substitution in it is a slip: `= -2(4) + 4 = -4` for h(4) when h(x) = -2x + 1", () => {
    expect(marks({ problem: ["h(x) = -2x + 1", "h(4)"], lines: ["= -2(4) + 4 = -4"] })).toEqual(["mismatch"]);
  });

  it.fails("her own tick after the answer, read as a dash, is dropped (a \"?\" was on her right answer)", () => {
    expect(youngReadOf({ latex: "-4 \\quad-", problem: ["-7 + 3"] }).latex.trim()).toBe("-4");
  });

  it.fails("…or read as a comma and a letter", () => {
    expect(youngReadOf({ latex: "27^{\\circ}, \\quad x", problem: ["x + 63^{\\circ} = 90^{\\circ}"] }).latex.replace(/\s/g, "")).toBe("27^{\\circ}");
  });
});
