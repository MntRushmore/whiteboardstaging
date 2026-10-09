import { describe, expect, it } from "vitest";
import { SPEAK_MAX_CHARS } from "../contracts";
import { capSpoken, fractionWords, powerWords, spokenText } from "../spoken";

describe("spokenText: maths a child hears correctly", () => {
  it.each([
    ["\\frac{3}{4}", "three quarters"],
    ["\\frac{1}{2}", "one half"],
    ["\\dfrac{2}{3}", "two thirds"],
    ["\\frac{5}{8}", "five eighths"],
    ["\\frac{13}{4}", "13 over 4"],
    ["\\frac{3}{40}", "3 over 40"],
    ["\\frac{x}{4}", "x over 4"],
    ["\\frac{x+1}{2}", "x plus 1, all over 2"],
    ["\\frac{-3}{4}", "negative three quarters"],
    ["3/4", "three quarters"],
    ["1 1/2", "1 and one half"],
    ["2\\frac{1}{4}", "2 and one quarter"],
  ])("fractions: %s -> %s", (input, said) => {
    expect(spokenText(input)).toBe(said);
  });

  it.each([
    ["x^2", "x squared"],
    ["x^{2}", "x squared"],
    ["2^3", "2 cubed"],
    ["x^{10}", "x to the power of 10"],
    ["e^{-1}", "e to the power of negative 1"],
    ["90^\\circ", "90 degrees"],
    ["90°", "90 degrees"],
    ["x²", "x squared"],
    ["\\sqrt{16}", "the square root of 16"],
    ["\\sqrt[3]{8}", "the cube root of 8"],
    ["a_1 + a_2", "a 1 plus a 2"],
  ])("powers, roots, subscripts: %s -> %s", (input, said) => {
    expect(spokenText(input)).toBe(said);
  });

  it.each([
    ["3 × 4 = 12", "3 times 4 equals 12"],
    ["3 \\times 4", "3 times 4"],
    ["2 \\cdot 5", "2 times 5"],
    ["12 ÷ 3", "12 divided by 3"],
    ["12 \\div 3", "12 divided by 3"],
    ["7 − 2", "7 minus 2"],
    ["x - 3 = 5", "x minus 3 equals 5"],
    ["x-3", "x minus 3"],
    ["2x-1", "2 x minus 1"],
    ["x = -3", "x equals negative 3"],
    ["-4 + 6", "negative 4 plus 6"],
    ["(−2) × 3", "negative 2 times 3"],
    ["x ≠ 2", "x does not equal 2"],
    ["x \\leq 4", "x is less than or equal to 4"],
    ["3 < 5", "3 is less than 5"],
    ["50%", "50 percent"],
    ["3(x + 2)", "3 times x plus 2"],
    ["\\pi r^2", "pi r squared"],
    ["f'(x)", "f prime x"],
  ])("operators and signs: %s -> %s", (input, said) => {
    expect(spokenText(input)).toBe(said);
  });

  it("keeps hyphenated words and turns a dash between words into a pause", () => {
    expect(spokenText("Look at the x-axis.")).toBe("Look at the x-axis.");
    expect(spokenText("This is a one-step problem.")).toBe("This is a one-step problem.");
    expect(spokenText("Good - now try the next one.")).toBe("Good, now try the next one.");
    expect(spokenText("Nice work — keep going!")).toBe("Nice work, keep going!");
  });

  it("reads a hint with maths in it the way a tutor would say it", () => {
    expect(spokenText("Try taking 3 from both sides. What is $2x + 3 - 3$?")).toBe("Try taking 3 from both sides. What is 2 x plus 3 minus 3?");
    expect(spokenText("What do you get when you work out \\(\\frac{1}{2} \\times 8\\)?")).toBe("What do you get when you work out one half times 8?");
    expect(spokenText("Check the sign of \\(-4\\) on the left.")).toBe("Check the sign of negative 4 on the left.");
  });

  it("drops markup: HTML, Markdown, LaTeX text commands, braces", () => {
    expect(spokenText("**Nice!** You found `x = 4`.")).toBe("Nice! You found x equals 4.");
    expect(spokenText("<b>Look</b> at *this* line")).toBe("Look at this line");
    expect(spokenText("\\text{Area} = 6\\,\\text{cm}^2")).toBe("Area equals 6 cm squared");
    expect(spokenText("See [the video](https://example.com/v) first")).toBe("See the video first");
    expect(spokenText("{x} + {y}")).toBe("x plus y");
  });

  it("leaves dates and plain words alone", () => {
    expect(spokenText("Due 10/08/2026")).toBe("Due 10/08/2026");
    expect(spokenText("Let's add the ones first, then the tens.")).toBe("Let's add the ones first, then the tens.");
    expect(spokenText("Use your 2nd step")).toBe("Use your 2nd step");
    expect(spokenText("and/or")).toBe("and or or");
  });

  it("says nothing for nothing", () => {
    expect(spokenText("")).toBe("");
    expect(spokenText("   ")).toBe("");
    expect(spokenText("$$")).toBe("");
    expect(spokenText(undefined as unknown as string)).toBe("");
  });

  it("is stable: its own output comes back unchanged", () => {
    for (const input of ["\\frac{3}{4} + x^2 = -1", "Look at the x-axis - then the y-axis.", "3(x + 2) ≤ 12", "Try 1 1/2 cups"]) {
      const once = spokenText(input);
      expect(spokenText(once)).toBe(once);
    }
  });

  it("caps the length on a sentence, else a word, boundary", () => {
    const long = Array.from({ length: 40 }, (_, i) => `Step ${i} is fine.`).join(" ");
    const said = spokenText(long);
    expect(said.length).toBeLessThanOrEqual(SPEAK_MAX_CHARS);
    expect(said.endsWith("is fine.")).toBe(true);
    expect(spokenText("x ".repeat(400)).length).toBeLessThanOrEqual(SPEAK_MAX_CHARS);
  });
});

describe("the pieces", () => {
  it("fractionWords: by name for small whole numbers, else over", () => {
    expect(fractionWords("1", "4")).toBe("one quarter");
    expect(fractionWords("7", "10")).toBe("seven tenths");
    expect(fractionWords("2", "13")).toBe("2 over 13");
    expect(fractionWords("0", "4")).toBe("0 over 4");
    expect(fractionWords("y", "x")).toBe("y over x");
  });

  it("powerWords: squared, cubed, degrees, the rest by number", () => {
    expect(powerWords("2", "2")).toBe("squared");
    expect(powerWords("3", "3")).toBe("cubed");
    expect(powerWords("\\circ", "degrees")).toBe("degrees");
    expect(powerWords("n", "n")).toBe("to the power of n");
  });

  it("capSpoken: short text is untouched; a cut ends with a full stop", () => {
    expect(capSpoken("Hello there.", 50)).toBe("Hello there.");
    expect(capSpoken("one two three four five six", 12)).toBe("one two.");
    expect(capSpoken("First sentence here. Second one is longer than the cap", 30)).toBe("First sentence here.");
  });
});
