import { beforeAll, describe, expect, it } from "vitest";
import type { LiveEngine, Rect } from "../contracts";
import { cellOf, type ProblemCell } from "../chat/cells";
import { splitInk } from "../diagrams";
import { getEngine } from "../engine";
import { analyzeColumn } from "../localSolve";
import { isLoneRelation } from "../policy";
import { clusterLines, medianStrokeHeight, unionRects } from "../strokeClusters";
import { answerAfterRestatedEnd, isSpeckLine, isTickStroke, ownTicks, readYoungHand } from "../youngHand";
import { youngGlyphs, youngInk, youngLine } from "../__fixtures__/youngInk";

const ARITHMETIC = { arithmetic: true };
const ANYWHERE = { arithmetic: false };

describe("readYoungHand: a wobbly `=` as Mathpix reads it", () => {
  it("a curved bar (`\\smile`, `\\frown`) is never maths at school: always `=`", () => {
    for (const ctx of [ARITHMETIC, ANYWHERE]) {
      expect(readYoungHand("\\smile", ctx)).toBe("=");
      expect(readYoungHand("\\frown", ctx)).toBe("=");
      expect(readYoungHand("\\smile 7", ctx)).toBe("= 7");
      expect(readYoungHand("X \\smile 7", ctx)).toBe("X = 7");
      expect(readYoungHand("4+3 \\frown 7", ctx)).toBe("4+3 = 7");
      expect(readYoungHand("⌣ 9", ctx)).toBe("= 9");
      expect(readYoungHand("\\smallsmile11", ctx)).toBe("= 11");
    }
  });

  it("two bars read stacked are one `=`", () => {
    expect(readYoungHand("\\underset{\\smile}{\\frown}", ANYWHERE)).toBe("=");
    expect(readYoungHand("\\frac{-}{-}", ANYWHERE)).toBe("=");
    expect(readYoungHand("\\stackrel{\\frown}{\\smile} 9", ANYWHERE)).toBe("= 9");
    expect(readYoungHand("\\frac{\\sim}{-} 7", ARITHMETIC)).toBe("= 7");
    // a real fraction stays one
    expect(readYoungHand("\\frac{1}{2}", ARITHMETIC)).toBe("\\frac{1}{2}");
  });

  it("a relation look-alike alone on a line is an `=` waiting for its answer", () => {
    for (const read of ["\\asymp", "\\approx", "\\sim", "\\sim \\sim", "\\simeq", "\\cong", "\\equiv", "≈", "~", "= ="]) {
      expect(readYoungHand(read, ANYWHERE), read).toBe("=");
      expect(isLoneRelation(readYoungHand(read, ANYWHERE))).toBe(true);
    }
    // a lone curved bar read as a set sign, a wedge, a `v`, or a lone minus: in arithmetic only
    for (const read of ["\\cup", "\\cap", "\\wedge", "\\vee", "v", "-"]) {
      expect(readYoungHand(read, ARITHMETIC), read).toBe("=");
      expect(readYoungHand(read, ANYWHERE), read).toBe(read);
    }
  });

  it("in arithmetic, a look-alike starting the line is the `=` of her answer", () => {
    expect(readYoungHand("\\approx 7", ARITHMETIC)).toBe("= 7");
    expect(readYoungHand("\\asymp 11", ARITHMETIC)).toBe("= 11");
    expect(readYoungHand("\\sim9", ARITHMETIC)).toBe("= 9");
    expect(readYoungHand("\\cup 7", ARITHMETIC)).toBe("= 7");
    expect(readYoungHand("v 9", ARITHMETIC)).toBe("= 9");
    expect(readYoungHand("\\approx 3.75", ARITHMETIC)).toBe("= 3.75");
    expect(readYoungHand("\\sim \\sim 12", ARITHMETIC)).toBe("= 12");
    // a minus before a number is a negative number
    expect(readYoungHand("-7", ARITHMETIC)).toBe("-7");
    // ...and elsewhere `\approx 2.41` under `x = 1 + \sqrt{2}` is meant
    expect(readYoungHand("\\approx 2.41", ANYWHERE)).toBe("\\approx 2.41");
    expect(readYoungHand("\\sim 7", ANYWHERE)).toBe("\\sim 7");
  });

  it("between two sides: any look-alike in arithmetic, elsewhere only one the engine cannot read on a line of numbers", () => {
    expect(readYoungHand("4+3 \\approx 7", ARITHMETIC)).toBe("4+3 = 7");
    expect(readYoungHand("4+3\\asymp7", ARITHMETIC)).toBe("4+3 = 7");
    expect(readYoungHand("5+6 \\equiv 11", ARITHMETIC)).toBe("5+6 = 11");
    expect(readYoungHand("4+3 \\asymp 7", ANYWHERE)).toBe("4+3 = 7");
    expect(readYoungHand("(2+3) \\sim (1+4)", ANYWHERE)).toBe("(2+3) = (1+4)");
  });

  it("a genuine `\\approx`, `\\cong`, `\\sim` or `\\equiv` stays", () => {
    for (const read of [
      "48+31 \\approx 80",
      "x \\approx 2.41",
      "\\sqrt{2} \\approx 1.41",
      "\\pi \\approx 3.14",
      "\\triangle ABC \\cong \\triangle DEF",
      "\\overline{AB} \\cong \\overline{CD}",
      "X \\sim N(0, 1)",
      "17 \\equiv 2 \\pmod{5}",
      "a \\equiv b",
      "y \\approx 0.5 x",
    ]) {
      expect(readYoungHand(read, ANYWHERE), read).toBe(read);
    }
  });

  it("in arithmetic, the tick she drew after her answer is no part of it", () => {
    expect(readYoungHand("=7 \\checkmark", ARITHMETIC)).toBe("=7");
    expect(readYoungHand("=9 \\vee", ARITHMETIC)).toBe("=9");
    expect(readYoungHand("= 11 v", ARITHMETIC)).toBe("= 11");
    expect(readYoungHand("=9\\sqrt{}", ARITHMETIC)).toBe("=9");
    expect(readYoungHand("=7 \\text { ✓ }", ARITHMETIC)).toBe("=7");
    expect(readYoungHand("\\asymp 7 \\checkmark", ARITHMETIC)).toBe("= 7");
    // ...not in algebra, where `2v` is two v's
    expect(readYoungHand("x = 2v", ANYWHERE)).toBe("x = 2v");
    expect(readYoungHand("=9 \\vee", ANYWHERE)).toBe("=9 \\vee");
  });

  it("a read with nothing to change is returned as it came", () => {
    for (const read of ["=7", "7+2=9", "2x + 3 = 11", "\\frac{1}{2} + \\frac{1}{4} = \\frac{3}{4}", "14", "x^{2} - 4 = 0", "-3"]) {
      expect(readYoungHand(read, ARITHMETIC), read).toBe(read);
      expect(readYoungHand(read, ANYWHERE), read).toBe(read);
    }
  });
});

describe("answerAfterRestatedEnd: the end of the problem written again beside it, then the answer", () => {
  it("is the answer to the problem", () => {
    expect(answerAfterRestatedEnd("3=7", "4+3")).toBe("= 7");
    expect(answerAfterRestatedEnd("3 = 7", "4 + 3")).toBe("= 7");
    expect(answerAfterRestatedEnd("+3=7", "4+3")).toBe("= 7");
    expect(answerAfterRestatedEnd("3 = 17", "14 + 3")).toBe("= 17");
    expect(answerAfterRestatedEnd("\\frac{1}{4} = \\frac{3}{4}", "\\frac{1}{2} + \\frac{1}{4}")).toBe("= \\frac{3}{4}");
    expect(answerAfterRestatedEnd("4 = 2", "8 \\div 4")).toBe("= 2");
  });

  it("but not the whole problem again, another number, or no answer", () => {
    expect(answerAfterRestatedEnd("4+3=7", "4+3")).toBeNull();
    expect(answerAfterRestatedEnd("13=17", "4+3")).toBeNull();
    expect(answerAfterRestatedEnd("3=17", "4+13")).toBeNull();
    expect(answerAfterRestatedEnd("3=", "4+3")).toBeNull();
    expect(answerAfterRestatedEnd("=7", "4+3")).toBeNull();
    expect(answerAfterRestatedEnd("3=x", "4+3")).toBeNull();
    expect(answerAfterRestatedEnd("7", "4+3")).toBeNull();
  });
});

describe("isTickStroke / ownTicks: her own tick after her answer", () => {
  const one = (pts: Array<[number, number]>) => youngInk([pts.map(([x, y]) => ({ x, y }))])[0];

  it("a ✓ in one stroke, drawn either way, is a tick", () => {
    const [down] = youngInk(youngGlyphs.tick(300, 100, 95));
    expect(isTickStroke(down)).toBe(true);
    // the way an adult draws it: short arm first, then up the long one
    expect(isTickStroke(one([[300, 140], [310, 150], [330, 175], [350, 150], [380, 120], [400, 100]]))).toBe(true);
  });

  it("a 7, a 2, an L, a v, a U, a 1 are not", () => {
    const [seven] = youngInk(youngGlyphs.seven(100, 100, 100));
    expect(isTickStroke(seven)).toBe(false);
    expect(isTickStroke(youngInk(youngGlyphs.one(100, 100, 100))[0])).toBe(false);
    expect(isTickStroke(one([[100, 110], [130, 100], [150, 120], [100, 180], [160, 180]]))).toBe(false);
    expect(isTickStroke(one([[100, 100], [100, 150], [100, 180], [140, 180]]))).toBe(false);
    expect(isTickStroke(one([[100, 100], [115, 140], [130, 180], [145, 140], [160, 100]]))).toBe(false);
    expect(isTickStroke(one([[100, 100], [102, 160], [130, 180], [158, 160], [160, 95]]))).toBe(false);
    // a tick in two strokes is no one stroke's shape
    expect(isTickStroke({ ...youngInk(youngGlyphs.tick(300, 100, 95))[0], segments: [[{ x: 300, y: 140 }, { x: 330, y: 175 }], [{ x: 330, y: 175 }, { x: 400, y: 100 }]] })).toBe(false);
  });

  it("a tick at the end of `= 11` is hers; one with ink further right, or a digit at the end, is not", () => {
    const ink = youngInk(youngLine("=11✓", 200, 100));
    expect(ownTicks(ink)).toEqual([ink[4]]);
    expect(ownTicks(ink.slice(0, 4))).toEqual([]);
    expect(ownTicks([ink[4]])).toEqual([ink[4]]);
    const [after] = youngInk(youngGlyphs.seven(ink[4].bounds.x + ink[4].bounds.w + 20, 100, 100));
    expect(ownTicks([...ink, after])).toEqual([]);
  });
});

describe("isSpeckLine: taps of the pen", () => {
  it("a line of dots, or of marks a quarter of a glyph, is no line; with a glyph in it, it is", () => {
    const dots = youngInk([...youngGlyphs.dot(100, 100), ...youngGlyphs.dot(108, 102), ...youngGlyphs.dot(126, 100)]);
    expect(isSpeckLine(dots, 8)).toBe(true);
    expect(isSpeckLine(dots.slice(0, 1), 80)).toBe(true);
    const flick = youngInk([[{ x: 100, y: 100 }, { x: 108, y: 104 }, { x: 114, y: 106 }]]);
    expect(isSpeckLine(flick, 80)).toBe(true);
    expect(isSpeckLine(flick, 20)).toBe(false);
    const seven = youngInk(youngGlyphs.seven(130, 60, 100));
    expect(isSpeckLine([...dots, ...seven], 80)).toBe(false);
    expect(isSpeckLine([], 80)).toBe(false);
  });
});

describe("the reported board, synthetic: `= 7 ✓`, `= 9`, `= 11 ✓`, `= 9 ✓` beside four sums, taps of the pen", () => {
  let engine: LiveEngine;
  beforeAll(async () => {
    engine = await getEngine();
  }, 60_000);

  // the tutor's problems where the chat puts four (cells 752 x 400), its ink ~30 px tall
  const problems: Array<{ n: number; latex: string; head: Rect; answer: string; read: string }> = [
    { n: 1, latex: "4+3", head: { x: 62, y: 86, w: 120, h: 30 }, answer: "=7✓", read: "\\approx 7" },
    { n: 2, latex: "7+2", head: { x: 814, y: 86, w: 130, h: 30 }, answer: "=9", read: "=9" },
    { n: 3, latex: "5+6", head: { x: 62, y: 486, w: 130, h: 30 }, answer: "=11✓", read: "\\asymp 11" },
    { n: 4, latex: "8+1", head: { x: 814, y: 486, w: 122, h: 30 }, answer: "=9✓", read: "\\smile 9" },
  ];
  const cells: ProblemCell[] = problems.map((p) => ({ key: `hb_${p.n}`, n: p.n, lines: [p.latex], head: p.head, cell: { x: p.n % 2 ? 48 : 800, y: p.n <= 2 ? 72 : 472, w: 752, h: 400 } }));

  it("each answer is one line, her tick and the taps in none; read as she wrote them, all four are right", () => {
    const answers = problems.map((p) => youngInk(youngLine(p.answer, p.head.x + p.head.w + 30, p.head.y - 20)));
    const taps = youngInk([...youngGlyphs.dot(1460, 748), ...[0, 8, 24, 33, 45].flatMap((dx) => youngGlyphs.dot(1472 + dx, 405))]);
    const ink = [...answers.flat(), ...taps];
    const split = splitInk(ink, [], { zoom: 0.49 });
    expect(split.writing).toHaveLength(ink.length);
    const glyph = medianStrokeHeight(split.writing);
    const byId = new Map(ink.map((s) => [s.id as string, s]));
    const lines = clusterLines(split.writing, [], [], { zoom: 0.49 })
      .map((l) => l.strokeIds.map((id) => byId.get(id)!))
      .filter((strokes) => !isSpeckLine(strokes, glyph));
    expect(lines).toHaveLength(4);
    for (const [k, p] of problems.entries()) {
      const strokes = lines.find((l) => l.includes(answers[k][0]))!;
      const cell = cellOf(unionRects(strokes.map((s) => s.bounds)), cells);
      expect(cell?.n).toBe(p.n);
      const ticks = ownTicks(strokes);
      expect(ticks.length, p.answer).toBe(p.answer.endsWith("✓") ? 1 : 0);
      // what is read is her `=` and her number, every stroke of them
      expect(strokes.filter((s) => !ticks.includes(s))).toEqual(answers[k].filter((s) => !ticks.includes(s)));
      const latex = readYoungHand(p.read, { arithmetic: true });
      expect(isLoneRelation(latex)).toBe(false);
      expect(analyzeColumn(engine, [p.latex, latex], "feedback")[1]).toMatchObject({ verdict: "ok" });
    }
  });
});

describe("readYoungHand: what the engine makes of her answers once they read as she wrote them", () => {
  let engine: LiveEngine;
  // the engine's modules load on first use: slow on a busy machine
  beforeAll(async () => {
    engine = await getEngine();
  }, 60_000);

  const judged = (problem: string, read: string) => analyzeColumn(engine, [problem, readYoungHand(read, ARITHMETIC)], "feedback")[1];

  it("right answers are right", () => {
    expect(judged("4+3", "\\approx 7")).toMatchObject({ verdict: "ok" });
    expect(judged("5+6", "\\asymp 11")).toMatchObject({ verdict: "ok" });
    expect(judged("7+2", "=9 \\vee")).toMatchObject({ verdict: "ok" });
    expect(judged("8+1", "\\smile 9")).toMatchObject({ verdict: "ok" });
    expect(judged("4+3", "4+3 \\asymp 7")).toMatchObject({ verdict: "ok" });
  });

  it("and a wrong one is still wrong", () => {
    expect(judged("4+3", "\\approx 8")).toMatchObject({ verdict: "mismatch" });
    expect(judged("5+6", "\\smile 12")).toMatchObject({ verdict: "mismatch" });
  });
});
