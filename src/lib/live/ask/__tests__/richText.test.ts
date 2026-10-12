import { describe, expect, it } from "vitest";
import { hasMath, parseInline, parseRichText, plainText, type RichBlock } from "../richText";

/** The tutor's reply, Markdown-lite: what the panel shows for each mark, and for half a stream. */

const t = (v: string) => ({ t: "text" as const, v });
const m = (v: string, display = false) => ({ t: "math" as const, v, display });
const p = (...c: RichBlock extends infer B ? (B extends { t: "p"; c: infer C } ? C : never) : never) => ({ t: "p" as const, c });

describe("parseRichText: blocks", () => {
  it("paragraphs split on blank lines; a single newline is a line break", () => {
    expect(parseRichText("Hi there!\n\nLet's look.\nLine two.")).toEqual([p(t("Hi there!")), p(t("Let's look."), { t: "br" }, t("Line two."))]);
  });

  it("bullets with - (and * or •), numbered lists keep their first number", () => {
    expect(parseRichText("- one\n- two\n* three")).toEqual([{ t: "ul", items: [[t("one")], [t("two")], [t("three")]] }]);
    expect(parseRichText("1. Add\n2. Then check")).toEqual([{ t: "ol", start: 1, items: [[t("Add")], [t("Then check")]] }]);
    expect(parseRichText("3) third\n4) fourth")).toEqual([{ t: "ol", start: 3, items: [[t("third")], [t("fourth")]] }]);
  });

  it("a list straight after a paragraph line (no blank line) is still a list, and text after it a paragraph", () => {
    expect(parseRichText("Here's how:\n1. Multiply\n2. Add\nDone!")).toEqual([
      p(t("Here's how:")),
      { t: "ol", start: 1, items: [[t("Multiply")], [t("Add")]] },
      p(t("Done!")),
    ]);
  });

  it("an indented line carries the item on", () => {
    expect(parseRichText("- first part\n  and more\n- second")).toEqual([{ t: "ul", items: [[t("first part and more")], [t("second")]] }]);
  });

  it("a paragraph that is one $$…$$ is a display formula, over several lines too", () => {
    expect(parseRichText("$$x^2 + 1$$")).toEqual([{ t: "math", v: "x^2 + 1" }]);
    expect(parseRichText("So:\n\n$$\n\\frac{1}{2} + \\frac{1}{4} = \\frac{3}{4}\n$$\n\nNice!")).toEqual([
      p(t("So:")),
      { t: "math", v: "\\frac{1}{2} + \\frac{1}{4} = \\frac{3}{4}" },
      p(t("Nice!")),
    ]);
    expect(parseRichText("\\[ a^2 + b^2 = c^2 \\]")).toEqual([{ t: "math", v: "a^2 + b^2 = c^2" }]);
  });

  it("a display formula inside a paragraph is one, with no stray line breaks around it", () => {
    expect(parseRichText("We get\n$$x = 4$$\nso x is 4.")).toEqual([p(t("We get"), m("x = 4", true), t("so x is 4."))]);
  });

  it("lines inside an open $$ are maths, never list items", () => {
    const blocks = parseRichText("$$\n- 3 + 5 = 2\n$$");
    expect(blocks).toEqual([{ t: "math", v: "- 3 + 5 = 2" }]);
  });

  it("headings show as a bold line; rules are dropped", () => {
    expect(parseRichText("### Step 1\nAdd them.\n\n---\n\nDone")).toEqual([p({ t: "bold", c: [t("Step 1")] }), p(t("Add them.")), p(t("Done"))]);
  });

  it("nothing at all, or only blank lines: no blocks", () => {
    expect(parseRichText("")).toEqual([]);
    expect(parseRichText("\n\n  \n")).toEqual([]);
  });
});

describe("parseInline: marks", () => {
  it("**bold**, with maths inside it", () => {
    expect(parseInline("This is **very** big")).toEqual([t("This is "), { t: "bold", c: [t("very")] }, t(" big")]);
    expect(parseInline("**$x = 3$ works**")).toEqual([{ t: "bold", c: [m("x = 3"), t(" works")] }]);
  });

  it("$…$ inline maths, and \\( … \\)", () => {
    expect(parseInline("So $x + 2 = 5$, and $x = 3$.")).toEqual([t("So "), m("x + 2 = 5"), t(", and "), m("x = 3"), t(".")]);
    expect(parseInline("Try \\(3 \\times 4\\) now")).toEqual([t("Try "), m("3 \\times 4"), t(" now")]);
  });

  it("prices stay prices: a $ needs a formula right after it, and its partner no space before and no digit after", () => {
    expect(parseInline("I have $5 and $3 more.")).toEqual([t("I have $5 and $3 more.")]);
    expect(parseInline("It costs $5. Then $x$ is the change.")).toEqual([t("It costs $5. Then "), m("x"), t(" is the change.")]);
    expect(parseInline("Between $ 4 and $ 5")).toEqual([t("Between $ 4 and $ 5")]);
    expect(parseInline("\\$10 off")).toEqual([t("$10 off")]);
  });

  it("an escaped asterisk is an asterisk; a lone one (times) stays", () => {
    expect(parseInline("2 * 3 * 4 = 24")).toEqual([t("2 * 3 * 4 = 24")]);
    expect(parseInline("\\*\\*not bold\\*\\*")).toEqual([t("**not bold**")]);
  });

  it("no raw HTML, ever: tags are text", () => {
    const nodes = parseInline('<img src=x onerror="alert(1)"> <b>hi</b>');
    expect(nodes).toEqual([t('<img src=x onerror="alert(1)"> <b>hi</b>')]);
  });
});

describe("half a stream", () => {
  it("an unclosed $ stays text until it closes", () => {
    expect(parseInline("So $x + ")).toEqual([t("So $x + ")]);
    expect(parseInline("So $x + 1$")).toEqual([t("So "), m("x + 1")]);
  });

  it("an unclosed $$ shows its source until it closes, then is a formula", () => {
    expect(parseRichText("We get\n$$\\frac{3}{")).toEqual([p(t("We get"), { t: "br" }, t("$$\\frac{3}{"))]);
    expect(parseRichText("We get\n$$\\frac{3}{4}$$")).toEqual([p(t("We get"), m("\\frac{3}{4}", true))]);
  });

  it("an opened ** while streaming makes the rest bold (no asterisks flash); once final, an unpaired ** is text", () => {
    expect(parseInline("This is **ver", { streaming: true })).toEqual([t("This is "), { t: "bold", c: [t("ver")] }]);
    expect(parseInline("This is **", { streaming: true })).toEqual([t("This is ")]);
    expect(parseInline("This is **ver")).toEqual([t("This is **ver")]);
  });

  it("every prefix of a real reply parses without throwing, and never loses words", () => {
    const reply =
      "Great question! **Fractions** are parts of a whole.\n\n1. Find a common denominator: $\\frac{1}{2} = \\frac{2}{4}$\n2. Add the tops:\n\n$$\\frac{2}{4} + \\frac{1}{4} = \\frac{3}{4}$$\n\n- It costs $5\n- Try **one** more!";
    for (let i = 0; i <= reply.length; i++) {
      const prefix = reply.slice(0, i);
      const blocks = parseRichText(prefix, { streaming: true });
      const words = prefix.replace(/[$*\\\n#\-\d.:{}^+=]/g, " ").split(/\s+/).filter((w) => /^[A-Za-z']{4,}$/.test(w));
      const shown = plainText(blocks);
      for (const w of words.slice(0, -1)) expect(shown).toContain(w);
    }
  });
});

describe("plainText and hasMath", () => {
  it("the words without marks, lists numbered, maths as its source", () => {
    const blocks = parseRichText("**Hi!** Look:\n\n1. $x = 2$\n2. done\n\n$$y$$");
    expect(plainText(blocks)).toBe("Hi! Look:\n\n1. x = 2\n2. done\n\ny");
  });

  it("knows when there is maths to render", () => {
    expect(hasMath(parseRichText("no maths here, $5 only"))).toBe(false);
    expect(hasMath(parseRichText("- **a $x$ b**"))).toBe(true);
    expect(hasMath(parseRichText("$$y$$"))).toBe(true);
  });
});
