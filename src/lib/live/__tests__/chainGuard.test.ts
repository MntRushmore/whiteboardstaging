import { describe, expect, it } from "vitest";
import { keepsKnownNumbers, knownNumbers, numbersIn } from "../chainGuard";

/** The second look before a ring takes back a misread's ring, never a real slip's (`chainGuard.ts`). */
describe("keepsKnownNumbers", () => {
  it("never lets a re-read change a number the page knows (a kid session: 180+24=214 re-read 180+34=214)", () => {
    expect(keepsKnownNumbers("180+24=214", "180+34=214", ["180 + 24"])).toBe(false);
    expect(keepsKnownNumbers("180+24=214", "180+34=214", ["204 - 24"])).toBe(false);
  });

  it("lets it read again a number the page does not know (the misread the second look is for)", () => {
    expect(keepsKnownNumbers("x = 5", "x = 4", ["2x = 8"])).toBe(true);
    expect(keepsKnownNumbers("180+24=214", "180+24=204", ["180 + 24"])).toBe(true);
  });

  it("knows all of the problem's numbers, and the line above's of two digits or more (a lone digit there is chance)", () => {
    expect(keepsKnownNumbers("2x=3", "2x=8", knownNumbers([], "2x+3=11"))).toBe(true);
    expect(keepsKnownNumbers("180+24=214", "180+34=214", knownNumbers([], "180 + 24"))).toBe(false);
    expect(keepsKnownNumbers("x+3=9", "x+8=9", knownNumbers(["x + 3 = 9"], null))).toBe(false);
  });

  it("finds a read's numbers in order", () => {
    expect(numbersIn("\\frac{12}{5} + 0.75")).toEqual(["12", "5", "0.75"]);
  });
});
