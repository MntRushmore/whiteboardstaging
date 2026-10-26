import { describe, expect, it } from "vitest";
import { numbersIn, strayNumbers } from "../readback";

describe("numbersIn", () => {
  it("reads digit runs, decimals and superscripts, and drops a thousands comma", () => {
    expect(numbersIn("(100 - 1296) + 1 = -1195")).toEqual(["100", "1296", "1", "1195"]);
    expect(numbersIn("x² + 3.5 = 1,296")).toEqual(["2", "3.5", "1296"]);
    expect(numbersIn("\\frac{3}{4}")).toEqual(["3", "4"]);
    expect(numbersIn("Next: take 3 from both sides")).toEqual(["3"]);
  });
});

describe("strayNumbers", () => {
  const asked = "Below the work, write: (100 - 1296) + 1 = -1195";

  it("finds the owner's garbled 100 (2026-10-25: written as \"1 0\", read as 10)", () => {
    expect(strayNumbers("(10-1296)+1=-1195", asked)).toEqual(["10"]);
  });

  it("passes a picture that wrote exactly what was asked, in any layout", () => {
    expect(strayNumbers("\\begin{array}{l}(100-1296)+1 \\\\ =-1195\\end{array}", asked)).toEqual([]);
  });

  it("has nothing to say when the tutor asked for no numbers", () => {
    expect(strayNumbers("1 2 3", "Circle the mistake and draw an arrow to it")).toEqual([]);
  });

  it("lets a graph's tick digits through, but not a wrong value", () => {
    const graph = "Draw the graph of y = 2x + 1 with labelled axes and the point (0, 1)";
    expect(strayNumbers("y=2x+1 \\quad 1 \\quad 2 \\quad 3 \\quad (0,1)", graph)).toEqual([]);
    expect(strayNumbers("y=2x+11", graph)).toEqual(["11"]);
  });
});
