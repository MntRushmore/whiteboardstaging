import { beforeAll, describe, expect, it } from "vitest";
import type { LiveEngine } from "../../contracts";
import { getEngine } from "..";
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

