import { describe, expect, it } from "vitest";
import { VisualModelSchema, type VisualModel } from "../../contracts";
import { modelProblems } from "../check";

/** The spec check the route's gate runs: nonsense is named in words a model can act on; sense passes. */

const problems = (m: unknown) => modelProblems(VisualModelSchema.parse(m) as VisualModel);

describe("modelProblems", () => {
  it("number lines: backwards, too many ticks, ends off the ticks, marks and jumps off the line, a jump labelled wrong", () => {
    expect(problems({ kind: "number_line", from: 10, to: 0 })).toEqual(["the line must run from a smaller number to a bigger one (it goes from 10 to 0)"]);
    expect(problems({ kind: "number_line", from: 0, to: 1000, step: 1 })[0]).toMatch(/1001 ticks, too many to read \(at most 41\); use a step of 100/);
    expect(problems({ kind: "number_line", from: 0, to: 1, step: 0.3 })).toEqual(["from 0 to 1 is not a whole number of steps of 0.3: make the ends land on ticks"]);
    expect(problems({ kind: "number_line", from: 0, to: 10, marks: [{ at: 12 }] })).toEqual(["the mark at 12 is off the line (it runs from 0 to 10)"]);
    expect(problems({ kind: "number_line", from: 0, to: 10, jumps: [{ from: 8, to: 13 }] })).toEqual(["the jump from 8 to 13 runs off the line (it runs from 0 to 10)"]);
    expect(problems({ kind: "number_line", from: 0, to: 10, jumps: [{ from: 3, to: 3 }] })).toEqual(["the jump from 3 to 3 goes nowhere"]);
    expect(problems({ kind: "number_line", from: 0, to: 10, jumps: [{ from: 3, to: 7, label: "+5" }] })).toEqual(["the jump from 3 to 7 is +4, but its label says +5"]);
    expect(problems({ kind: "number_line", from: 0, to: 10, jumps: [{ from: 7, to: 3, label: "+4" }] })).toEqual(["the jump from 7 to 3 is -4, but its label says +4"]);
    expect(problems({ kind: "number_line", from: 0, to: 1, step: 0.25, marks: [{ at: 0.75, label: "1/2" }] })).toEqual(['the mark at 0.75 is labelled "1/2", which is a different number']);
    // sense: unsigned sizes, words, letters, fractions that match
    expect(problems({ kind: "number_line", from: 0, to: 10, jumps: [{ from: 3, to: 7, label: "4" }, { from: 7, to: 9, label: "2 more" }], marks: [{ at: 3, label: "A" }] })).toEqual([]);
    expect(problems({ kind: "number_line", from: 0, to: 1, step: 0.25, marks: [{ at: 0.75, label: "\\frac{3}{4}" }] })).toEqual([]);
  });

  it("fractions: more shaded than parts, a label that is another fraction", () => {
    expect(problems({ kind: "fraction_bars", bars: [{ parts: 4, shaded: 5 }] })).toEqual(["bar 1 has 5 of 4 parts shaded: shaded must be at most parts"]);
    expect(problems({ kind: "fraction_bars", bars: [{ parts: 4, shaded: 3 }, { parts: 8, shaded: 3, label: "3/4" }] })).toEqual(["bar 2 shows 3/8 but its label says 3/4"]);
    expect(problems({ kind: "fraction_circles", circles: [{ parts: 3, shaded: 4 }] })).toEqual(["circle 1 has 4 of 3 parts shaded: shaded must be at most parts"]);
    // an equal value is the same fraction
    expect(problems({ kind: "fraction_bars", bars: [{ parts: 4, shaded: 2, label: "1/2" }] })).toEqual([]);
  });

  it("arrays and groups: a label that says other dimensions, an equation that is wrong", () => {
    expect(problems({ kind: "array", rows: 3, cols: 4, label: "3 × 5" })).toEqual(["the array is 3 rows of 4, but its label says 3 × 5"]);
    expect(problems({ kind: "array", rows: 3, cols: 4, label: "4 × 3 = 13" })).toEqual(['the array\'s label "4 × 3 = 13" is wrong: 4 × 3 is 12']);
    expect(problems({ kind: "array", rows: 3, cols: 4, label: "4 × 3 = 12" })).toEqual([]);
    expect(problems({ kind: "equal_groups", groups: 3, each: 4, label: "4 groups of 3" })).toEqual(["there are 3 groups of 4, but the label says 4 groups of 3"]);
    expect(problems({ kind: "equal_groups", groups: 3, each: 4, label: "apples in bags" })).toEqual([]);
  });

  it("area models too big to draw clearly; base ten of nothing; more than 3 decimals", () => {
    expect(problems({ kind: "area_model", a: 4321, b: 567 })).toEqual(["4,321 × 567 splits into 12 parts, too many to draw clearly (at most 9): use smaller numbers"]);
    expect(problems({ kind: "area_model", a: 4321, b: 56 })).toEqual([]);
    expect(problems({ kind: "base_ten", value: 0 })).toEqual(["0 has no blocks to draw: give a number from 1 to 999"]);
    expect(problems({ kind: "place_value", value: 2.3456 })).toEqual(["2.3456 has more than 3 decimal places: round it to thousandths"]);
  });

  it("tapes: a total the segments contradict, lengths out of proportion with their numbers", () => {
    const seg = (units: number, label?: string) => ({ units, ...(label ? { label } : {}) });
    expect(problems({ kind: "tape", rows: [{ segments: [seg(1, "12"), seg(1, "12"), seg(1, "12")] }], total: "40" })).toEqual(["the total says 40, but the segments add up to 36 (12 + 12 + 12)"]);
    expect(problems({ kind: "tape", rows: [{ segments: [seg(1, "5"), seg(2, "5")] }] })[0]).toMatch(/^the segments are not to scale: "5" is 1 unit long but "5" is 2/);
    expect(problems({ kind: "tape", rows: [{ segments: [seg(5, "30"), seg(3, "?")] }], total: "20" })).toEqual(["the segments' numbers (30) already add up to more than the total 20"]);
    // sense: an unknown part, a total of both rows, units in proportion
    expect(problems({ kind: "tape", rows: [{ segments: [seg(5, "5"), seg(8, "?")] }], total: "13" })).toEqual([]);
    expect(problems({ kind: "tape", rows: [{ label: "Sam", segments: [seg(1, "12"), seg(1, "12"), seg(1, "12")] }, { label: "Ann", segments: [seg(1, "12")] }], total: "48" })).toEqual([]);
    expect(problems({ kind: "tape", rows: [{ segments: [seg(1), seg(1), seg(1)] }], total: "24" })).toEqual([]);
  });

  it("clocks and ten frames the schema accepts are always drawable", () => {
    expect(problems({ kind: "clock", hour: 12, minute: 59 })).toEqual([]);
    expect(problems({ kind: "ten_frame", filled: 0 })).toEqual([]);
  });
});
