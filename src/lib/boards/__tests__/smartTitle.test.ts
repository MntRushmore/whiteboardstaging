import { describe, expect, it } from "vitest";
import { DEFAULT_BOARD_TITLE } from "../boardTitle";
import {
  INITIAL_NAMER,
  MAX_SMART_ASKS,
  MAX_TITLE_LINES,
  afterNameWrite,
  askedSmart,
  cleanSmartTitle,
  planFirstLine,
  planSmart,
  replaceableTitles,
  shouldAskSmart,
  titleContent,
} from "../smartTitle";

const line = (id: string, latex: string, column = 0, row = 0) => ({ id, latex, column, row });

describe("titleContent", () => {
  it("the chat's problems first, then the student's lines in reading order, each once", () => {
    const lines = [line("b", "x = \\frac{\\pi}{6}", 0, 2), line("a", "\\sin x = \\frac{1}{2}", 0, 1), line("c", "y = 2", 1, 0), line("d", "  ")];
    expect(titleContent(lines, [["2 \\sin x = 1"], ["2 \\sin x = 1"]])).toEqual(["2 \\sin x = 1", "\\sin x = \\frac{1}{2}", "x = \\frac{\\pi}{6}", "y = 2"]);
  });

  it(`stops at ${MAX_TITLE_LINES} lines: what a board is about is in its first lines`, () => {
    const many = Array.from({ length: 20 }, (_, i) => line(`l${i}`, `x = ${i}`, 0, i));
    expect(titleContent(many)).toHaveLength(MAX_TITLE_LINES);
  });
});

describe("replaceableTitles", () => {
  it("the default, the session's own names, and every line's first-line name (the old namer's, the welcome's)", () => {
    const titles = replaceableTitles(["2 \\sin x = 1", "x^{2}-5 x+6=0"], ["Solving trig equations"]);
    expect(titles).toEqual(expect.arrayContaining([DEFAULT_BOARD_TITLE, "Solving trig equations", "2 sin x = 1", "x² − 5x + 6 = 0"]));
  });

  it("never a name in the student's own words", () => {
    expect(replaceableTitles(["2x = 8"])).not.toContain("My homework");
  });
});

describe("cleanSmartTitle", () => {
  it.each([
    ["Solving trig equations", "Solving trig equations"],
    ['"factoring quadratics."', "Factoring quadratics"],
    ["  Adding   fractions\n", "Adding fractions"],
    ["7 times table", "7 times table"],
    ["**Pythagorean theorem**", "Pythagorean theorem"],
  ])("%j -> %j", (raw, want) => {
    expect(cleanSmartTitle(raw)).toBe(want);
  });

  it.each([null, "", "x", "2 sin x = 1", "\\frac{1}{2}", "$x^2$", "12 + 7", "A very long name that goes on and on past forty characters"])("%j is no name", (raw) => {
    expect(cleanSmartTitle(raw)).toBeNull();
  });
});

describe("the namer, one board session", () => {
  it("writes the first-line name, then a smart name over it; the first-line name never comes back", () => {
    let s = INITIAL_NAMER;
    expect(planFirstLine(s, "2 sin x = 1")).toBe("2 sin x = 1");
    s = afterNameWrite(s, "2 sin x = 1", true, false);
    expect(planFirstLine(s, "2 sin x = 1")).toBeNull();
    expect(planSmart(s, "Solving trig equations")).toBe("Solving trig equations");
    s = afterNameWrite(s, "Solving trig equations", true, true);
    expect(planFirstLine(s, "sin x = 1/2")).toBeNull();
    expect(planSmart(s, "Solving trig equations")).toBeNull();
  });

  it("stops for good once the stored name was not ours to replace (the student named it)", () => {
    const s = afterNameWrite(INITIAL_NAMER, "2x = 8", false, false);
    expect(s.stopped).toBe(true);
    expect(planFirstLine(s, "2x = 8")).toBeNull();
    expect(planSmart(s, "Linear equations")).toBeNull();
    expect(shouldAskSmart(s, "2x = 8", "page:1")).toBe(false);
  });

  it(`asks again only when the maths changed, on the same screen, at most ${MAX_SMART_ASKS} times`, () => {
    let s = INITIAL_NAMER;
    expect(shouldAskSmart(s, "", "page:1")).toBe(false);
    expect(shouldAskSmart(s, "2x = 8", "page:1")).toBe(true);
    s = askedSmart(s, "2x = 8", "page:1");
    expect(shouldAskSmart(s, "2x = 8", "page:1")).toBe(false);
    expect(shouldAskSmart(s, "2x = 8\nx = 4", "page:2")).toBe(false);
    for (let i = 0; i < MAX_SMART_ASKS - 1; i++) {
      expect(shouldAskSmart(s, `2x = 8\nx = ${i}`, "page:1")).toBe(true);
      s = askedSmart(s, `2x = 8\nx = ${i}`, "page:1");
    }
    expect(shouldAskSmart(s, "something new", "page:1")).toBe(false);
  });
});
