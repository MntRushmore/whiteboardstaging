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
    ["3(x + 2)", "3 times open bracket x plus 2 close bracket"],
    ["\\pi r^2", "pi r squared"],
    ["f'(x)", "f prime x"],
  ])("operators and signs: %s -> %s", (input, said) => {
    expect(spokenText(input)).toBe(said);
  });

  it.each([
    // order of operations: the bracket is the whole question
    ["Is (3 + 4) \\times 2 the same as 3 + 4 \\times 2?", "Is open bracket 3 plus 4 close bracket times 2 the same as 3 plus 4 times 2?"],
    ["10 - (3 + 2)", "10 minus open bracket 3 plus 2 close bracket"],
    ["8 - (5 - 2)", "8 minus open bracket 5 minus 2 close bracket"],
    ["(2 + 3)^2", "open bracket 2 plus 3 close bracket squared"],
    ["\\left(3 + 4\\right) \\times 2", "open bracket 3 plus 4 close bracket times 2"],
    ["3\\left(x + 2\\right)", "3 times open bracket x plus 2 close bracket"],
    ["(x + 1)(x - 1)", "open bracket x plus 1 close bracket times open bracket x minus 1 close bracket"],
    ["x(x-2)", "x open bracket x minus 2 close bracket"],
    // a power on a bracket: (-3)^2 is 9, -3^2 is -9
    ["(-3)^2", "open bracket negative 3 close bracket squared"],
    ["-3^2", "negative 3 squared"],
    ["(2x)^2", "open bracket 2 x close bracket squared"],
    // around one thing, or prose, a bracket stays silent
    ["(x)^2", "x squared"],
    ["2(-3)", "2 times negative 3"],
    ["Look at line 2 (the one with the 3).", "Look at line 2 the one with the 3."],
    ["This is (a one-step problem).", "This is a one-step problem."],
  ])("brackets that group are said: %s -> %s", (input, said) => {
    expect(spokenText(input)).toBe(said);
  });

  it.each([
    ["\\frac{12}{4+2}", "the fraction with 12 on top and 4 plus 2 on the bottom"],
    ["\\frac{1}{x+1}", "the fraction with 1 on top and x plus 1 on the bottom"],
    ["\\frac{x+1}{x-1}", "the fraction with x plus 1 on top and x minus 1 on the bottom"],
    ["\\frac{x}{x+1} = 2", "the fraction with x on top and x plus 1 on the bottom equals 2"],
    ["2^{x+1}", "2 to the x plus 1 power"],
    ["2^{x} + 1", "2 to the power of x plus 1"],
    ["e^{-1}", "e to the power of negative 1"],
  ])("a compound bottom or exponent is grouped: %s -> %s", (input, said) => {
    expect(spokenText(input)).toBe(said);
  });

  it.each([
    ["Find 1/2 + 1/4.", "Find one half plus one quarter."],
    ["Your answer is 3/4.", "Your answer is three quarters."],
    ["Simplify 6/8.", "Simplify six eighths."],
    ["Add 1 1/2.", "Add 1 and one half."],
    ["Try 1/2. Then 3/4!", "Try one half. Then three quarters!"],
    // a decimal and a date stay as written
    ["Use 1/2.5", "Use 1/2.5"],
    ["Due 10/08/2026.", "Due 10/08/2026."],
  ])("a fraction ending a sentence is a fraction: %s -> %s", (input, said) => {
    expect(spokenText(input)).toBe(said);
  });

  it.each([
    ["What's -3 + 5?", "What's negative 3 plus 5?"],
    ["Good. -2 is right.", "Good. negative 2 is right."],
    ["Is it 3? -3 is wrong.", "Is it 3? negative 3 is wrong."],
    ["Look at line 2's -5.", "Look at line 2's negative 5."],
    // hintSpeech joins a hint and its question with a space: a question may start with a negative
    ["Look at the sign. $-3$ or $3$?", "Look at the sign. negative 3 or 3?"],
    ["It says “-3”.", "It says “ negative 3”."],
    // a prime and a closing quote still take something away
    ["y' - 3", "y prime minus 3"],
    ['"x" - 3', '"x" minus 3'],
  ])("a negative after a sentence, an apostrophe or a quote: %s -> %s", (input, said) => {
    expect(spokenText(input)).toBe(said);
  });

  it.each([
    ["What is |-3|?", "What is the absolute value of negative 3?"],
    ["\\left|-3\\right|", "the absolute value of negative 3"],
    ["\\lvert -3 \\rvert", "the absolute value of negative 3"],
    ["|x| = 4", "the absolute value of x equals 4"],
    // the skill's own example (src/lib/learning/topics.ts): a pause ends the group
    ["Distance from zero, like |x − 3| = 5", "Distance from zero, like the absolute value of x minus 3, equals 5"],
  ])("absolute value: %s -> %s", (input, said) => {
    expect(spokenText(input)).toBe(said);
  });

  it.each([
    ["Count by 2s: 2, 4, 6.", "Count by 2s: 2, 4, 6."],
    ["Add the 1s, then the 10s.", "Add the 1s, then the 10s."],
    ["How many 100s?", "How many 100s?"],
    // in maths an s after a number is still a variable
    ["4s = 20", "4 s equals 20"],
    ["P = 4s", "P equals 4 s"],
    ["2x + 3 = 7", "2 x plus 3 equals 7"],
  ])("plural numbers stay whole: %s -> %s", (input, said) => {
    expect(spokenText(input)).toBe(said);
  });

  it.each([
    ["3 + __ = 5", "3 plus blank equals 5"],
    ["3 + ___ = 5", "3 plus blank equals 5"],
    ["4 + _ = 9", "4 plus blank equals 9"],
    ["Fill in: 7 - ___ = 2", "Fill in: 7 minus blank equals 2"],
    ["3 + ? = 5", "3 plus blank equals 5"],
    ["3 + \\square = 5", "3 plus blank equals 5"],
    // the guided tour's coach mark (src/lib/onboarding/tourCopy.ts, writeCopy)
    ["That ? means your tutor can't check that yet. Write the whole answer.", "That question mark means your tutor can't check that yet. Write the whole answer."],
    // a question's own mark, and subscripts and bold, are untouched
    ["What is 2x?", "What is 2 x?"],
    ["a_1 + a_2", "a 1 plus a 2"],
    ["**Nice!**", "Nice!"],
  ])("blanks to fill in are 'blank': %s -> %s", (input, said) => {
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
    for (const input of [
      "\\frac{3}{4} + x^2 = -1",
      "Look at the x-axis - then the y-axis.",
      "3(x + 2) ≤ 12",
      "Try 1 1/2 cups",
      "(-3)^2 + |x - 3|",
      "\\frac{1}{x+1} + 2^{x+1}",
      "Count by 2s. What's -3 + __?",
      "That ? means your tutor can't check that yet.",
    ]) {
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
    expect(fractionWords("1", "x plus 1")).toBe("the fraction with 1 on top and x plus 1 on the bottom");
    expect(fractionWords("1", "negative 2")).toBe("1 over negative 2");
  });

  it("powerWords: squared, cubed, degrees, the rest by number; a compound exponent is grouped", () => {
    expect(powerWords("2", "2")).toBe("squared");
    expect(powerWords("3", "3")).toBe("cubed");
    expect(powerWords("\\circ", "degrees")).toBe("degrees");
    expect(powerWords("n", "n")).toBe("to the power of n");
    expect(powerWords("n-1", "n minus 1")).toBe("to the n minus 1 power");
  });

  it("capSpoken: short text is untouched; a cut ends with a full stop", () => {
    expect(capSpoken("Hello there.", 50)).toBe("Hello there.");
    expect(capSpoken("one two three four five six", 12)).toBe("one two.");
    expect(capSpoken("First sentence here. Second one is longer than the cap", 30)).toBe("First sentence here.");
  });
});
