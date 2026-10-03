import { describe, expect, it } from "vitest";
import {
  DEFAULT_BOARD_TITLE,
  MAX_AUTO_TITLE_LENGTH,
  boardTitleFromLatex,
  hasMathContent,
  isDefaultBoardTitle,
  latexToPlainText,
  pickTitleLine,
} from "../boardTitle";

describe("latexToPlainText", () => {
  // Every input below is a line Mathpix / Live actually produced on a local board.
  it.each([
    ["x^{2}-5 x+6=0", "x² − 5x + 6 = 0"],
    ["2 x+3=11", "2x + 3 = 11"],
    ["10 x+10=110", "10x + 10 = 110"],
    ["y=-x+4", "y = −x + 4"],
    ["y=-\\frac{2}{3} x+2", "y = −⅔x + 2"],
    ["3(x+2)=21", "3(x + 2) = 21"],
    ["a^{2}+b^{2}=c^{2}", "a² + b² = c²"],
    ["40-3=", "40 − 3 ="],
    ["x=?", "x = ?"],
    ["8,1,7,2,6,3,5,4", "8, 1, 7, 2, 6, 3, 5, 4"],
    ["x \\rightarrow 2", "x → 2"],
    ["A x+B y=C", "Ax + By = C"],
    ["I Q R=?", "IQR = ?"],
    ["\\sin 30^{\\circ}=\\frac{x}{10}", "sin 30° = x/10"],
    ["f(x)=\\frac{x^{2}-4}{x^{2}-x-2}", "f(x) = (x² − 4)/(x² − x − 2)"],
    ["\\frac{d}{d x}\\left(3 x^{2}+2 x\\right)", "d/dx(3x² + 2x)"],
    ["\\int_{0}^{2} 3 x^{2} d x", "∫₀² 3x²dx"],
    ["\\text { graph } y=3 x+2", "graph y = 3x + 2"],
    ["\\text { Statements }", "Statements"],
    ["\\text{VA} = ?", "VA = ?"],
    [
      "\\text { Given: } \\overline{A B} \\cong \\overline{C B}, \\overline{A D} \\cong \\overline{C D}",
      "Given: AB ≅ CB, AD ≅ CD",
    ],
    ["\\text { Prove: } \\triangle A B E \\cong \\triangle D C E", "Prove: △ABE ≅ △DCE"],
  ])("%s -> %s", (latex, text) => {
    expect(latexToPlainText(latex)).toBe(text);
  });

  it("writes roots, scripts and Greek", () => {
    expect(latexToPlainText("\\sqrt{x+1}=3")).toBe("√(x + 1) = 3");
    expect(latexToPlainText("\\sqrt{16}")).toBe("√16");
    expect(latexToPlainText("\\sqrt[3]{27}=3")).toBe("∛27 = 3");
    expect(latexToPlainText("x_{1}+x_{2}")).toBe("x₁ + x₂");
    expect(latexToPlainText("x^{-1}")).toBe("x⁻¹");
    expect(latexToPlainText("e^{2 x}")).toBe("e^(2x)");
    expect(latexToPlainText("2 \\pi r")).toBe("2πr");
    expect(latexToPlainText("\\log_{2} 8=3")).toBe("log₂ 8 = 3");
    expect(latexToPlainText("\\lim_{x \\to 2} f(x)")).toBe("lim x → 2 f(x)");
    expect(latexToPlainText("x \\leq 5")).toBe("x ≤ 5");
    expect(latexToPlainText("3 \\times 4 \\div 2")).toBe("3 × 4 ÷ 2");
    expect(latexToPlainText("f'(x)=2 x")).toBe("f′(x) = 2x");
  });

  it("reads Mathpix text mode, where words sit outside \\( … \\)", () => {
    expect(
      latexToPlainText("Given: \\( E \\) is the midpoint of \\( \\overline{A D} E \\) is midpoint of \\( \\overline{B C}"),
    ).toBe("Given: E is the midpoint of ADE is midpoint of BC");
    expect(latexToPlainText("Solve $2 x=8$ for x")).toBe("Solve 2x = 8 for x");
  });

  it("keeps an escaped dollar as maths, not a delimiter", () => {
    expect(latexToPlainText("\\$5+\\$3")).toBe("$5 + $3");
  });

  it("lays out systems row by row", () => {
    expect(latexToPlainText("\\begin{cases} x+y=6 \\\\ x-y=2 \\end{cases}")).toBe("x + y = 6; x − y = 2");
  });

  it("never throws on junk and returns '' for nothing", () => {
    expect(latexToPlainText("")).toBe("");
    expect(latexToPlainText("   ")).toBe("");
    expect(() => latexToPlainText("\\frac{")).not.toThrow();
    expect(() => latexToPlainText("}}}{{{^_")).not.toThrow();
    expect(latexToPlainText("\\unknowncmd x")).toBe("unknowncmdx");
  });
});

describe("boardTitleFromLatex", () => {
  it("returns the plain text of a short line", () => {
    expect(boardTitleFromLatex("x^{2}-5 x+6=0")).toBe("x² − 5x + 6 = 0");
  });

  it("returns null when nothing readable is left", () => {
    expect(boardTitleFromLatex("")).toBeNull();
    expect(boardTitleFromLatex("=")).toBeNull();
    expect(boardTitleFromLatex("\\left( \\right)")).toBeNull();
  });

  it("cuts a long line at a word boundary with an ellipsis", () => {
    const long = "\\text { Given: } " + Array.from({ length: 12 }, (_, i) => `\\overline{A${i}} \\cong \\overline{B${i}}`).join(", ");
    const title = boardTitleFromLatex(long)!;
    expect(title.length).toBeLessThanOrEqual(MAX_AUTO_TITLE_LENGTH);
    expect(title.endsWith("…")).toBe(true);
    expect(title.startsWith("Given: A0 ≅ B0")).toBe(true);
    expect(title).not.toMatch(/[,\s]…$/);
  });
});

describe("hasMathContent", () => {
  it("tells a words-only header from a line with maths", () => {
    expect(hasMathContent("\\text { Statements }")).toBe(false);
    expect(hasMathContent("\\text { Given }")).toBe(false);
    expect(hasMathContent("\\text { graph } y=x")).toBe(true);
    expect(hasMathContent("x=4")).toBe(true);
  });
});

describe("pickTitleLine", () => {
  const line = (id: string, latex: string, column = 0, row = 0) => ({ id, latex, column, row });

  it("takes the first line in reading order (column, then row)", () => {
    const picked = pickTitleLine([line("b", "x=4", 0, 1), line("c", "y=2", 1, 0), line("a", "2 x=8", 0, 0)]);
    expect(picked).toEqual({ lineId: "a", title: "2x = 8" });
  });

  it("skips a words-only header in favour of the first line with maths", () => {
    const picked = pickTitleLine([line("h", "\\text { Statements }", 0, 0), line("m", "\\overline{A B} \\cong \\overline{C B}", 0, 1)]);
    expect(picked).toEqual({ lineId: "m", title: "AB ≅ CB" });
  });

  it("falls back to a words-only line when that is all there is", () => {
    expect(pickTitleLine([line("h", "\\text { Given }")])).toEqual({ lineId: "h", title: "Given" });
  });

  it("ignores unread and unreadable lines", () => {
    expect(pickTitleLine([])).toBeNull();
    expect(pickTitleLine([line("a", ""), line("b", "  "), line("c", "=")])).toBeNull();
  });
});

describe("isDefaultBoardTitle", () => {
  it("is true only for the column default (and blanks)", () => {
    expect(isDefaultBoardTitle(DEFAULT_BOARD_TITLE)).toBe(true);
    expect(isDefaultBoardTitle(` ${DEFAULT_BOARD_TITLE} `)).toBe(true);
    expect(isDefaultBoardTitle("")).toBe(true);
    expect(isDefaultBoardTitle(null)).toBe(true);
    expect(isDefaultBoardTitle("Untitled")).toBe(false);
    expect(isDefaultBoardTitle("Homework 3")).toBe(false);
  });
});
