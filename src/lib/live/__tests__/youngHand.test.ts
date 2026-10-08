import { beforeAll, describe, expect, it } from "vitest";
import type { LiveEngine, Rect } from "../contracts";
import { cellOf, splitAcrossProblems, type ProblemCell } from "../chat/cells";
import { splitInk } from "../diagrams";
import { getEngine } from "../engine";
import { analyzeColumn } from "../localSolve";
import { isLoneRelation } from "../policy";
import { clusterLines, isEqualsPair, medianStrokeHeight, unionRects } from "../strokeClusters";
import { answerAfterRestatedEnd, isSignsOnly, isSpeckLine, isTickStroke, leadingSigns, ownTicks, readYoungHand } from "../youngHand";
import { negativeAnswers, PHOTO_HEADS, youngGlyphs, youngInk, youngLine, type Pt } from "../__fixtures__/youngInk";
import { CORPUS } from "@/__eval__/corpus";

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

  it("leaves every line of the eval corpus as it is (algebra, geometry, trigonometry, calculus, statistics …)", () => {
    const changed: string[] = [];
    for (const p of CORPUS) {
      const arithmetic = p.lines.every((l) => !/[a-zA-Z\\]/.test(l.replace(/\\(?:frac|dfrac|times|div|cdot|left|right)/g, "")) && /\d/.test(l));
      for (const l of p.lines) if (readYoungHand(l, { arithmetic }) !== l) changed.push(`${p.id}: ${l}`);
    }
    expect(changed).toEqual([]);
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

  it("a negative answer keeps its minus, and is judged right — or wrong — as written", () => {
    for (const [problem, read] of [
      ["-3 - 7", "=-10"],
      ["-3 - 7", "= - 10"],
      ["-3 - 7", "-3-7=-10"],
      ["-12 + 9", "=-3"],
      ["-12 + 9", "\\approx -3"],
      ["-12 + 9", "\\asymp -3"],
      ["(-4)(-3)", "=12"],
      ["(-6) \\times (-9)", "\\simeq 54"],
    ]) {
      // a minus read is a minus kept
      expect((readYoungHand(read, ARITHMETIC).match(/-/g) ?? []).length, read).toBe((read.match(/-/g) ?? []).length);
      expect(judged(problem, read), `${problem} | ${read}`).toMatchObject({ verdict: "ok" });
    }
    expect(readYoungHand("=-10", ARITHMETIC)).toBe("=-10");
    expect(readYoungHand("\\approx -3", ARITHMETIC)).toBe("= -3");
    // the minus is not rewritten away, nor added
    expect(judged("-3 - 7", "=10")).toMatchObject({ verdict: "mismatch" });
    expect(judged("-12 + 9", "=3")).toMatchObject({ verdict: "mismatch" });
    expect(judged("(-4)(-3)", "=-12")).toMatchObject({ verdict: "mismatch" });
  });
});

describe("negative answers: the signs as the ink has them", () => {
  const board = negativeAnswers(PHOTO_HEADS);

  it("leadingSigns: `= -` for an `=` and a minus apart, `=` for a wave under a bar, `-` for a minus", () => {
    expect(leadingSigns(youngInk([...board.one.eq, ...board.one.minus, ...board.one.ten]))).toBe("=-");
    expect(leadingSigns(youngInk([...board.three.eq, ...board.three.minus, ...board.three.three]))).toBe("=-");
    expect(leadingSigns(youngInk([...board.four.eq, ...board.four.digits]))).toBe("=");
    expect(leadingSigns(youngInk([...board.three.minus, ...board.three.three]))).toBe("-");
    expect(leadingSigns(youngInk(youngLine("=7", 100, 100)))).toBe("=");
    // a bar traced twice is one minus
    expect(leadingSigns(youngInk([youngGlyphs.bar(100, 150, 60), youngGlyphs.bar(102, 152, 58), ...youngGlyphs.three(180, 100, 83)]))).toBe("-");
  });

  it("…and nothing for a line with no bar before its number, nothing but bars, or a 7 whose top bar is a stroke of its own", () => {
    expect(leadingSigns(youngInk(youngLine("11", 100, 100)))).toBeNull();
    expect(leadingSigns(youngInk([...board.one.eq, ...board.one.minus]))).toBeNull();
    const seven = [youngGlyphs.bar(200, 100, 55), [{ x: 255, y: 100 }, { x: 240, y: 150 }, { x: 225, y: 200 }]];
    expect(leadingSigns(youngInk([...youngGlyphs.equals(100, 130), ...seven]))).toBe("=");
    // three bars one over another: no telling
    expect(leadingSigns(youngInk([youngGlyphs.bar(100, 100, 50), youngGlyphs.bar(100, 120, 50), youngGlyphs.bar(100, 140, 50), ...youngGlyphs.one(180, 80, 100)]))).toBeNull();
  });

  it("in arithmetic, Mathpix's signs give way to the ink's when it read no more of them", () => {
    const signed = (read: string, signs: string) => readYoungHand(read, { arithmetic: true, signs });
    // a wobbly `=` read as a minus — a right 54 ringed
    expect(signed("-54", "=")).toBe("= 54");
    // a minus it dropped, or swapped round
    expect(signed("=3", "=-")).toBe("= -3");
    expect(signed("-3", "=-")).toBe("= -3");
    expect(signed("-=3", "=-")).toBe("= -3");
    expect(signed("10", "=-")).toBe("= -10");
    expect(signed("54", "=")).toBe("= 54");
    // what it read as the ink has it stands
    expect(signed("=-10", "=-")).toBe("=-10");
    expect(signed("=54", "=")).toBe("=54");
    // more signs read than the ink's bars say: the read stands (a minus is never taken away)
    expect(signed("=-3", "=")).toBe("=-3");
    // not an answer of signs and a number, or not arithmetic: untouched
    expect(signed("-3-7=-10", "-")).toBe("-3-7=-10");
    expect(readYoungHand("-54", { arithmetic: false, signs: "=" })).toBe("-54");
  });

  it("isSignsOnly: `-`, `=`, `= -` with no number yet", () => {
    expect(isSignsOnly(youngInk(board.two.minus))).toBe(true);
    expect(isSignsOnly(youngInk([...board.three.eq, ...board.three.minus]))).toBe(true);
    expect(isSignsOnly(youngInk([...board.one.eq, ...youngGlyphs.dot(150, 150)]))).toBe(true);
    expect(isSignsOnly(youngInk([...board.three.eq, ...board.three.minus, ...board.three.three]))).toBe(false);
    expect(isSignsOnly(youngInk(youngGlyphs.dot(150, 150)))).toBe(false);
  });

  it("the board: each answer one line, problem 1's not joined to the minus under problem 2, no `≡`", () => {
    const ink = (s: Pt[][]) => youngInk(s);
    const one = ink([...board.one.eq, ...board.one.minus, ...board.one.ten]);
    const two = ink(board.two.minus);
    const three = ink([...board.three.eq, ...board.three.minus, ...board.three.three]);
    const four = ink([...board.four.eq, ...board.four.digits]);
    const all = [...one, ...two, ...three, ...four];
    const cells: ProblemCell[] = PHOTO_HEADS.map((h, i) => ({
      key: `hb_${i + 1}`,
      n: i + 1,
      lines: [["-3 - 7", "(-4)(-3)", "-12 + 9", "(-6) \\times (-9)"][i]],
      head: { x: h.x, y: h.y, w: h.r - h.x, h: 30 },
      cell: { x: i % 2 ? 800 : 48, y: i < 2 ? 72 : 472, w: 752, h: 400 },
    }));
    const split = splitInk(all, [], { zoom: 0.49 });
    expect(split.writing).toHaveLength(all.length);
    const ids = (s: readonly { id: string }[]) => s.map((x) => x.id).sort();
    // the clusterer alone runs problem 1's 0 into problem 2's minus, a row apart only by the layout
    const joined = clusterLines(split.writing, [], [], { zoom: 0.49 });
    expect(joined.find((l) => l.strokeIds.includes(two[0].id))?.strokeIds).toHaveLength(6);
    const lines = clusterLines(split.writing, [], [], { zoom: 0.49, apart: (g) => splitAcrossProblems(g, cells) });
    const lineOf = (s: { id: string }) => [...(lines.find((l) => l.strokeIds.includes(s.id as never))?.strokeIds ?? [])].sort();
    expect(lineOf(one[0])).toEqual(ids(one));
    expect(lineOf(two[0])).toEqual(ids(two));
    expect(lineOf(three[0])).toEqual(ids(three));
    expect(lineOf(four[0])).toEqual(ids(four));
    // problem 3's `=` is two bars and its minus a third beside them, not one `≡`
    expect(isEqualsPair(three[0].bounds, three[1].bounds, three.map((s) => s.bounds))).toBe(true);
    expect(isEqualsPair(three[1].bounds, three[2].bounds, three.map((s) => s.bounds))).toBe(false);
    expect(isEqualsPair(three[0].bounds, three[2].bounds, three.map((s) => s.bounds))).toBe(false);
    // each in its problem's cell
    for (const [k, strokes] of [one, two, three, four].entries()) expect(cellOf(unionRects(strokes.map((s) => s.bounds)), cells)?.n).toBe(k + 1);
  });
});
