import { describe, expect, it } from "vitest";
import {
  CARD_SIZE,
  cardName,
  cardSentence,
  displayLink,
  ellipsize,
  fitText,
  layoutShareCard,
  tickPoints,
  wrapText,
  type CardFont,
  type CardOp,
  type MeasureText,
  type ShareCardData,
} from "../card";

/** A stand-in for canvas measuring: every character 0.55 em wide (wide letters a little more), plus the tracking. */
const measure: MeasureText = (text, font) =>
  Array.from(text).reduce((w, ch) => w + font.size * ((/[MWmw@]/.test(ch) ? 0.85 : 0.55) + font.tracking), 0);

const font: CardFont = { face: "display", weight: 600, size: 40, tracking: 0 };

const DATA: ShareCardData = {
  name: "Maya Johnson",
  avatar: "🦊",
  gradeLabel: "3rd grade",
  problems: 42,
  independent: 28,
  streak: 5,
  mastered: ["Times tables", "Adding within 100", "Equivalent fractions"],
  link: null,
};

const texts = (ops: CardOp[]) => ops.filter((o): o is Extract<CardOp, { kind: "text" }> => o.kind === "text");
const ticks = (ops: CardOp[]) => ops.filter((o): o is Extract<CardOp, { kind: "tick" }> => o.kind === "tick");

/** Every op's box lies on the card; text lies inside the board or (the brand line) under it. */
function expectInside(ops: CardOp[]) {
  for (const op of ops) {
    if (op.kind === "text") {
      const x0 = op.align === "left" ? op.x : op.align === "right" ? op.x - op.width : op.x - op.width / 2;
      expect(x0, op.text).toBeGreaterThanOrEqual(48 + 80 - 0.5);
      expect(x0 + op.width, op.text).toBeLessThanOrEqual(CARD_SIZE.width - 48 - 80 + 0.5);
      expect(op.y - op.font.size * 0.75, op.text).toBeGreaterThanOrEqual(48);
      expect(op.y + op.font.size * 0.22, op.text).toBeLessThanOrEqual(CARD_SIZE.height);
    }
    if (op.kind === "tick") {
      expect(op.x + op.w).toBeLessThanOrEqual(CARD_SIZE.width - 48 - 80 + 0.5);
      for (const p of op.points) {
        expect(p.x).toBeGreaterThanOrEqual(op.x - 0.01);
        expect(p.y).toBeGreaterThanOrEqual(op.y - 0.01);
      }
    }
  }
}

/** Text ops inside the board never overlap each other vertically when they share a column. */
function boardTextBottom(ops: CardOp[]): number {
  return Math.max(...texts(ops).filter((t) => t.y < CARD_SIZE.height - 132).map((t) => t.y + t.font.size * 0.22));
}

describe("text fitting", () => {
  it("keeps the copy's own line breaks", () => {
    expect(wrapText("Ready for\na new week", 2000, font, measure).lines).toEqual(["Ready for", "a new week"]);
  });

  it("wraps at words, and breaks a word only when it is wider than the line", () => {
    expect(wrapText("one two three", 200, font, measure)).toEqual({ lines: ["one two", "three"], broken: false });
    const long = wrapText("Wolfeschlegelsteinhausen", 200, font, measure);
    expect(long.broken).toBe(true);
    expect(long.lines.length).toBeGreaterThan(1);
    for (const line of long.lines) expect(measure(line, font)).toBeLessThanOrEqual(200);
  });

  it("cuts with an ellipsis only when the text is too wide", () => {
    expect(ellipsize("Times tables", 1000, font, measure)).toBe("Times tables");
    const cut = ellipsize("Adding and subtracting within 1000", 300, font, measure);
    expect(cut.endsWith("…")).toBe(true);
    expect(measure(cut, font)).toBeLessThanOrEqual(300);
  });

  it("prefers one line at a smaller size to two at a bigger one, then the biggest size that fits", () => {
    const fitted = fitText("Maximiliana's week", { face: "display", weight: 600, tracking: 0 }, [64, 56, 48, 40], 520, 2, measure);
    expect(fitted.lines).toHaveLength(1);
    expect(fitted.font.size).toBe(48);
    expect(fitText("Mo's week", { face: "display", weight: 600, tracking: 0 }, [64, 56], 520, 2, measure).font.size).toBe(64);
  });

  it("never returns more lines than allowed", () => {
    const fitted = fitText("a ".repeat(80).trim(), { face: "body", weight: 500, tracking: 0 }, [30, 26], 200, 2, measure);
    expect(fitted.lines).toHaveLength(2);
    expect(fitted.lines[1].endsWith("…")).toBe(true);
  });
});

describe("privacy", () => {
  it("shows the first name only, and none when hidden", () => {
    expect(cardName({ name: "Maya Johnson" })).toBe("Maya");
    expect(cardName({ name: "Maya Johnson" }, { hideName: true })).toBeNull();
    const layout = layoutShareCard(DATA, measure);
    const all = texts(layout.ops).map((t) => t.text).join(" ");
    expect(all).toContain("Maya");
    expect(all).not.toContain("Johnson");
  });

  it("never draws an email address as a name", () => {
    const layout = layoutShareCard({ ...DATA, name: "maya.j@school.org" }, measure);
    expect(layout.name).toBeNull();
    expect(texts(layout.ops).map((t) => t.text).join(" ")).not.toContain("@");
  });

  it("hides the name everywhere: the card, the initial and the sentence", () => {
    const layout = layoutShareCard({ ...DATA, avatar: null }, measure, { hideName: true });
    const all = texts(layout.ops).map((t) => t.text).join(" ");
    expect(all).not.toContain("Maya");
    expect(all).toContain("This week");
    expect(layout.sentence).not.toContain("Maya");
    // no initial in the disc: a tick instead
    expect(texts(layout.ops).some((t) => t.text === "M")).toBe(false);
  });
});

describe("the layout", () => {
  it("is portrait 1080 x 1350 with everything inside", () => {
    const layout = layoutShareCard(DATA, measure);
    expect([layout.width, layout.height]).toEqual([1080, 1350]);
    expectInside(layout.ops);
    expect(boardTextBottom(layout.ops)).toBeLessThanOrEqual(CARD_SIZE.height - 132 - 80 + 1);
  });

  it("draws the week's numbers, a tick after the big number and after each skill", () => {
    const layout = layoutShareCard(DATA, measure);
    const all = texts(layout.ops).map((t) => t.text);
    expect(all).toEqual(expect.arrayContaining(["Maya’s week", "3rd grade", "42", "problems this week", "28", "solved without help", "5", "days in a row", "SKILLS MASTERED", "Times tables", "agathon.app"]));
    // the hero's tick, one per skill, and the brand's
    expect(ticks(layout.ops)).toHaveLength(1 + 3 + 1);
    const hero = texts(layout.ops).find((t) => t.text === "42")!;
    expect(hero.font.size).toBeGreaterThanOrEqual(200);
    expect(layout.sentence).toBe("Maya’s week: 42 problems this week, 28 solved without help, 5 days in a row. Skills mastered: Times tables, Adding within 100 and Equivalent fractions.");
  });

  it("keeps the sections in order, top to bottom, without overlap", () => {
    const layout = layoutShareCard(DATA, measure);
    const y = (text: string) => texts(layout.ops).find((t) => t.text === text)!.y;
    expect(y("Maya’s week")).toBeLessThan(y("42"));
    expect(y("42")).toBeLessThan(y("problems this week"));
    expect(y("problems this week")).toBeLessThan(y("28") - 80);
    expect(y("solved without help")).toBeLessThan(y("SKILLS MASTERED") - 40);
    expect(y("Times tables")).toBeLessThan(y("Adding within 100"));
  });

  it("handles zeros: no stats, no skills, a fresh week instead of a 0", () => {
    const layout = layoutShareCard({ ...DATA, problems: 0, independent: 0, streak: 0, mastered: [] }, measure);
    const all = texts(layout.ops).map((t) => t.text);
    expect(all).not.toContain("0");
    expect(all).toEqual(expect.arrayContaining(["Ready for", "a new week"]));
    expect(all).not.toContain("SKILLS MASTERED");
    expectInside(layout.ops);
  });

  it("leaves out a one-day streak and keeps the independent count within the problems", () => {
    const layout = layoutShareCard({ ...DATA, problems: 3, independent: 9, streak: 1 }, measure);
    const all = texts(layout.ops).map((t) => t.text);
    expect(all).not.toContain("days in a row");
    expect(all).not.toContain("9");
    expect(all).toContain("problems this week");
    expect(layout.sentence).toContain("3 solved without help");
  });

  it("says 'problem' for one", () => {
    const layout = layoutShareCard({ ...DATA, problems: 1, independent: 1 }, measure);
    expect(texts(layout.ops).map((t) => t.text)).toContain("problem this week");
  });

  it("fits a long name, long skills, a big number and a long link", () => {
    const layout = layoutShareCard(
      {
        ...DATA,
        name: "Wolfeschlegelsteinhausenbergerdorff",
        problems: 4321,
        independent: 3999,
        streak: 120,
        mastered: ["Adding and subtracting within 1000 with regrouping and more", "Multiplying multi-digit numbers", "Dividing fractions"],
        link: "https://agathon.app/?ref=K7M2QXAB&utm_source=share&utm_medium=card",
      },
      measure,
    );
    expectInside(layout.ops);
    const all = texts(layout.ops).map((t) => t.text);
    expect(all).toContain("4,321");
    expect(all.some((t) => t.endsWith("…"))).toBe(true);
    expect(boardTextBottom(layout.ops)).toBeLessThanOrEqual(CARD_SIZE.height - 132 - 80 + 1);
  });

  it("fits a short name and nothing else", () => {
    const layout = layoutShareCard({ name: "Al", avatar: null, gradeLabel: null, problems: 2, independent: 0, streak: 0, mastered: [], link: null }, measure);
    expectInside(layout.ops);
    // the initial in the disc
    expect(texts(layout.ops).some((t) => t.text === "A" && t.align === "center")).toBe(true);
  });

  it("shows the link without its scheme in place of the site", () => {
    const layout = layoutShareCard({ ...DATA, link: "https://agathon.app/?ref=K7M2QX" }, measure);
    const all = texts(layout.ops).map((t) => t.text);
    expect(all).toContain("agathon.app/?ref=K7M2QX");
    expect(all).not.toContain("agathon.app");
  });
});

describe("helpers", () => {
  it("fits the tutor's tick into its box", () => {
    const pts = tickPoints(100, 200, 90, 100, 3);
    expect(pts.length).toBeGreaterThan(3);
    expect(Math.min(...pts.map((p) => p.x))).toBeCloseTo(100);
    expect(Math.max(...pts.map((p) => p.x))).toBeCloseTo(190);
    expect(Math.min(...pts.map((p) => p.y))).toBeCloseTo(200);
    expect(Math.max(...pts.map((p) => p.y))).toBeCloseTo(300);
    // a tick: it dips, then rises to its top right
    expect(pts[pts.length - 1].y).toBeLessThan(pts[0].y);
  });

  it("reads a link as a person would", () => {
    expect(displayLink("https://agathon.app/")).toBe("agathon.app");
    expect(displayLink("http://localhost:3000/?ref=ABCDEF")).toBe("localhost:3000/?ref=ABCDEF");
  });

  it("writes a sentence for a hidden name and a quiet week", () => {
    expect(cardSentence({ ...DATA, problems: 0, independent: 0, streak: 0, mastered: [] }, { hideName: true })).toBe("This week: ready for a new week.");
  });
});
