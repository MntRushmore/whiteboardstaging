/**
 * The native brain's parity and benchmark inputs (docs/IPAD-NATIVE.md, "The brain"): real inputs
 * from the scoreboards, as the `AgathonBrain.call(method, args)` the iPad app makes.
 *
 *  - the maths: every line of the maths corpus (`corpus.ts`, the course files) and the young
 *    corpus, analysed with the column context the board gives it; Solve on every problem;
 *  - the ink: corpus lines written by the tutor's hand in the scoreboard's four student hands
 *    (`handwriting.ts`), drawings beside maths (`drawings.ts`), division bars, stacked sums, and a
 *    whole page of work (~200 strokes);
 *  - the hand, the marks, the policy, the learning generators and the Progress summary.
 *
 * `golden.test.ts` runs them through the TypeScript brain (`src/lib/brain`) in node and writes the
 * results next to the Swift package; its Swift tests run the same through `brain.js` in
 * JavaScriptCore and compare. Deterministic: same corpus, same cases.
 */
import type { InkStroke, Rect } from "@/lib/live/contracts";
import type { BrainStroke } from "@/lib/brain";
import { analyzeColumnOf } from "@/lib/brain";
import { SKILLS } from "@/lib/learning/contracts";
import { hasPractice, practiceProblems } from "@/lib/learning/practiceSet";
import { summarize, learnerHint } from "@/lib/learning/summary";
import { ATTEMPTS, NOW, TZ } from "@/lib/learning/__tests__/progressFixtures";
import { toInkStrokes, writeStack } from "@/lib/live/__fixtures__/strokes";
import { LINE_KINDS, HELP_MODES, ENGINE_VERDICTS } from "@/lib/live/contracts";
import { CORPUS } from "../corpus";
import { YOUNG_CORPUS } from "../young/corpus";
import { handInk, VARIANTS } from "../handwriting";
import { buildBarScenes, buildScenes } from "../drawings";

export interface BrainCase {
  /** stable name, for a failing test to point at */
  name: string;
  method: string;
  args: unknown;
}

const r2 = (v: number) => Math.round(v * 100) / 100;

/** The board's ink as the app sends it: one pen-down each, coordinates to 0.01 px. */
export function toBrainStrokes(ink: readonly InkStroke[]): BrainStroke[] {
  return ink.map((s) => {
    const pts = s.segments.flat();
    return { id: s.id as string, x: pts.map((p) => r2(p.x)), y: pts.map((p) => r2(p.y)) };
  });
}

/** Every `step`-th item, starting at the first (deterministic thinning of a big set). */
function every<T>(items: readonly T[], step: number): T[] {
  return items.filter((_, i) => i % step === 0);
}

/** `ink` moved so its box starts at (x, y), ids tagged so pages never share one. */
function moved(ink: readonly InkStroke[], x: number, y: number, tag: string): InkStroke[] {
  const x0 = Math.min(...ink.map((s) => s.bounds.x));
  const y0 = Math.min(...ink.map((s) => s.bounds.y));
  return ink.map((s) => ({
    id: `${s.id}_${tag}` as InkStroke["id"],
    bounds: { x: s.bounds.x - x0 + x, y: s.bounds.y - y0 + y, w: s.bounds.w, h: s.bounds.h },
    segments: s.segments.map((seg) => seg.map((p) => ({ x: p.x - x0 + x, y: p.y - y0 + y }))),
  }));
}

/**
 * A screen of work: corpus problems written one under the other in two columns, in the student
 * hands, until it holds at least `minStrokes` strokes — the benchmark's "clustering 200 strokes".
 */
export function pageOfWork(minStrokes = 200): BrainStroke[] {
  const ink: InkStroke[] = [];
  let column = 0;
  let y = 60;
  let n = 0;
  for (const p of CORPUS) {
    for (const line of p.lines) {
      const written = handInk(line, VARIANTS[n % VARIANTS.length]);
      n++;
      if (written.strokes.length === 0) continue;
      const placed = moved(written.strokes, 80 + column * 760, y, `pg${n}`);
      ink.push(...placed);
      y += Math.max(...placed.map((s) => s.bounds.y + s.bounds.h)) - y + 34;
    }
    y += 90;
    if (y > 820) {
      column += 1;
      y = 60;
    }
    if (ink.length >= minStrokes) break;
  }
  return toBrainStrokes(ink);
}

/** A worked answer three lines long, as Solve writes it (`localSolve` of `x^2 - 5x + 6 = 0`). */
export const THREE_LINE_ANSWER = ["x^{2} - 5x + 6 = 0", "(x - 2)(x - 3) = 0", "x = 2, \\ x = 3"];

// ---------------------------------------------------------------- the maths

function analyzeCases(): BrainCase[] {
  const out: BrainCase[] = [];
  const columns: Array<{ id: string; lines: string[] }> = [
    ...CORPUS.map((p) => ({ id: p.id, lines: p.lines })),
    ...YOUNG_CORPUS.map((c) => ({ id: `young/${c.id}`, lines: [...(c.problem ? [c.problem] : []), ...c.work.map(([l]) => l)] })),
  ];
  for (const col of columns) {
    // the context the board gives each line: the analyses above it, as `analyzeColumn` holds them
    const analyses = analyzeColumnOf({ lines: col.lines, mode: "feedback" });
    col.lines.forEach((latex, i) => {
      let previous;
      let original;
      for (let j = 0; j < i; j++) {
        const a = analyses[j];
        if (!a || ["label", "incomplete", "unknown", "operation"].includes(a.kind)) continue;
        previous = a;
        if (!original && (a.kind === "equation" || a.kind === "inequality")) original = a;
      }
      out.push({ name: `analyzeLine/${col.id}/${i}`, method: "analyzeLine", args: { latex, context: { mode: "feedback", ...(previous ? { previous } : {}), ...(original ? { original } : {}) } } });
    });
  }
  return out;
}

function solveCases(): BrainCase[] {
  return [
    ...CORPUS.map((p) => ({ name: `localSolve/${p.id}`, method: "localSolve", args: { lines: p.lines } })),
    ...every(CORPUS, 6).map((p) => ({ name: `analyzeColumn/${p.id}`, method: "analyzeColumn", args: { lines: p.lines, mode: "answer" } })),
  ];
}

const CALCULATOR = [
  "3.2*4.5",
  "5 km/h to m/s",
  "d/dx x^3",
  "balance Fe+O2->Fe2O3",
  "sqrt(2)^2",
  "2^10",
  "sin(30 deg)",
  "12 inch to cm",
  "1/3 + 1/6",
  "log(100, 10)",
  "integral(x^2, x, 0, 1)",
  "9.81 m/s^2 * 3 s",
];

const EXPECTED: Array<[string, string]> = [
  ["4", "x = 4"],
  ["x = 4", "x = 4"],
  ["2*x + 6", "2(x + 3)"],
  ["x^2 - 1", "(x - 1)(x + 1)"],
  ["5", "x = 6"],
  ["1/2", "0.5"],
  ["3*x", "x + x + x"],
  ["pi", "3.14159"],
];

function engineCases(): BrainCase[] {
  return [
    ...CALCULATOR.map((input, i) => ({ name: `calculate/${i}`, method: "calculate", args: { input } })),
    ...EXPECTED.map(([expected, latex], i) => ({ name: `verifyExpected/${i}`, method: "verifyExpected", args: { expected, latex } })),
    ...every(CORPUS, 4).map((p) => ({ name: `classify/${p.id}`, method: "classify", args: { lines: p.lines } })),
    ...every(
      CORPUS.filter((p) => ["linear", "linear-functions", "quadratic", "inequality", "system-2x2", "absolute", "exponential", "vertex-form", "standard-form", "rational"].includes(p.topic)),
      7,
    ).map((p, i) => ({ name: `sketchGraph/${p.id}`, method: "sketchGraph", args: { lines: p.lines, seed: 100 + i } })),
    { name: "sketchGraph/explicit-line", method: "sketchGraph", args: { lines: ["y = 2x + 1"], explicit: true, seed: 7 } },
    { name: "sketchGraph/explicit-two", method: "sketchGraph", args: { lines: ["y = x^{2}", "y = x + 2"], explicit: true, seed: 8, box: { w: 320, h: 260 } } },
    { name: "sketchGraph/explicit-c", method: "sketchGraph", args: { lines: ["y = 3"], explicit: true, seed: 9 } },
  ];
}

// ---------------------------------------------------------------- the ink

function inkCases(): BrainCase[] {
  const out: BrainCase[] = [];
  // one line of maths in each hand: what the recognizer is sent, and what the clusterer makes of it
  const lines = every(
    CORPUS.flatMap((p) => p.lines),
    5,
  );
  lines.forEach((latex, i) => {
    const variant = VARIANTS[i % VARIANTS.length];
    const ink = handInk(latex, variant);
    if (ink.strokes.length === 0) return;
    const strokes = toBrainStrokes(ink.strokes);
    out.push({ name: `recognizerPayload/${i}/${variant.name}`, method: "recognizerPayload", args: { strokes } });
    if (i % 3 === 0) out.push({ name: `clusterStrokes/line/${i}/${variant.name}`, method: "clusterStrokes", args: { strokes, idSeed: i } });
  });
  // drawings beside a line of maths: the split, then the lines
  every(buildScenes(), 48).forEach((scene, i) => {
    const ink = [...scene.math, ...scene.drawn.strokes, ...scene.drawn.labels.flat()];
    out.push({ name: `clusterStrokes/scene/${scene.id}`, method: "clusterStrokes", args: { strokes: toBrainStrokes(ink), idSeed: 1000 + i } });
  });
  // division bars and their look-alikes, with the tutor's problems on the screen
  every(buildBarScenes(), 10).forEach((scene, i) => {
    out.push({ name: `clusterStrokes/bar/${scene.id}`, method: "clusterStrokes", args: { strokes: toBrainStrokes(scene.ink), equations: scene.equations, idSeed: 2000 + i } });
  });
  // stacked sums, with carries and a borrow
  const stacks: Array<[string, () => InkStroke[]]> = [
    ["286+680", () => toInkStrokes(writeStack(["286", "+680"], "966").all)],
    ["carry", () => toInkStrokes(writeStack(["47", "+38"], "85", { carries: [{ place: 1, digit: "1" }] }).all)],
    ["borrow", () => toInkStrokes(writeStack(["52", "-17"], "35", { borrow: { place: 1, digit: "4" } }).all)],
    ["unanswered", () => toInkStrokes(writeStack(["123", "+456"], null).all)],
  ];
  stacks.forEach(([name, make], i) => out.push({ name: `clusterStrokes/stack/${name}`, method: "clusterStrokes", args: { strokes: toBrainStrokes(make()), idSeed: 3000 + i } }));
  // a whole screen of work, at a desktop and an iPad's zoom, and with the previous flush's lines
  const page = pageOfWork(200);
  out.push({ name: "clusterStrokes/page", method: "clusterStrokes", args: { strokes: page, idSeed: 4000 } });
  out.push({ name: "clusterStrokes/page/ipad", method: "clusterStrokes", args: { strokes: page, zoom: 0.52, idSeed: 4001 } });
  out.push({ name: "clusterStrokes/page/nosplit", method: "clusterStrokes", args: { strokes: page, split: false, idSeed: 4002 } });
  return out;
}

// ---------------------------------------------------------------- the hand and the marks

function handCases(): BrainCase[] {
  const out: BrainCase[] = [];
  const solved = CORPUS.map((p) => ({ p, lines: p.lines }));
  every(solved, 24).forEach(({ p, lines }, i) => {
    out.push({ name: `layoutHandwriting/${p.id}`, method: "layoutHandwriting", args: { steps: lines, lineHeight: 30 + (i % 5) * 10, zoom: i % 2 ? 0.52 : undefined, seedKey: `ln_${i}`, origin: { x: 100 + i, y: 200 } } });
  });
  out.push({ name: "layoutHandwriting/three-line", method: "layoutHandwriting", args: { steps: THREE_LINE_ANSWER, lineHeight: 44, seedKey: "ln_bench" } });
  out.push({ name: "layoutHandwriting/inline", method: "layoutHandwriting", args: { latex: "= 33", lineHeight: 52, inline: true, seed: 5, baseline: { x: 400, baselineY: 300 } } });
  out.push({ name: "layoutHandwriting/unsupported", method: "layoutHandwriting", args: { latex: "\\text{the area of the triangle is half the base times the height}", size: 24, seed: 3 } });
  every(
    CORPUS.flatMap((p) => p.lines),
    80,
  ).forEach((latex, i) => out.push({ name: `layoutMath/${i}`, method: "layoutMath", args: { latex, size: 28, seed: i } }));
  ["Nice work!", "Try the next one", "Look at the sign here", "What do you get when you add 3 to both sides?"].forEach((text, i) =>
    out.push({ name: `writeText/${i}`, method: "writeText", args: { text, maxWidth: 220, size: 20, seed: i + 1 } }),
  );
  const boxes: Rect[] = [
    { x: 100, y: 200, w: 180, h: 40 },
    { x: 400, y: 120, w: 60, h: 30 },
    { x: 50, y: 600, w: 520, h: 64 },
    { x: 900, y: 30, w: 12, h: 12 },
  ];
  for (const kind of ["check", "circle", "question"] as const) {
    boxes.forEach((bbox, i) => out.push({ name: `marks/${kind}/${i}`, method: "marks", args: { kind, bbox, seedKey: `ln_${i}:${kind}` } }));
  }
  return out;
}

function policyCases(): BrainCase[] {
  const out: BrainCase[] = [];
  let i = 0;
  for (const mode of HELP_MODES) {
    for (const kind of ["equation", "expression", "label", "text", "unknown"] as const) {
      for (const verdict of ENGINE_VERDICTS) {
        i++;
        const analysis = kind === "unknown" && verdict !== "unknown" ? null : { kind, math: "", resultLatex: kind === "expression" ? "7" : "", verdict, note: "", solved: i % 7 === 0 };
        out.push({
          name: `policy/${mode}/${kind}/${verdict}`,
          method: "policy",
          args: { mode, analysis, confidence: i % 5 === 0 ? 0.4 : 0.9, settled: i % 2 === 0, auto: i % 3 !== 0, userAsked: i % 4 === 0, hintsShownForLine: i % 3, openHintCount: i % 2, rewritesWithWarn: i % 4, liveShapeCount: i % 11 === 0 ? 70 : 5, latex: i % 9 === 0 ? "x" : "2x + 3 = 7" },
        });
      }
    }
  }
  void LINE_KINDS;
  return out;
}

// ---------------------------------------------------------------- learning

function learningCases(): BrainCase[] {
  const out: BrainCase[] = [];
  const practicable = SKILLS.map((s) => s.id).filter((id) => hasPractice(id));
  practicable.forEach((skill, i) => out.push({ name: `practice/${skill}`, method: "practice", args: { skill, count: 4, seed: 17 + i } }));
  // "Now you try": a problem like each skill's first practice problem
  every(practicable, 2).forEach((skill, i) => {
    const [problem] = practiceProblems(skill, 1, 900 + i);
    if (problem) out.push({ name: `variantOf/${skill}`, method: "variantOf", args: { problem, seed: 31 + i, stillClock: true } });
  });
  every(CORPUS, 25).forEach((p, i) => out.push({ name: `variantOf/corpus/${p.id}`, method: "variantOf", args: { problem: p.lines, seed: 5 + i, stillClock: true } }));
  ATTEMPTS.slice(0, 8).forEach((a) => out.push({ name: `nowYouTry/${a.id}`, method: "nowYouTry", args: { problemLatex: a.problemLatex, attemptId: a.id, stillClock: true } }));
  // the Progress page, for the fixture student, in other time zones, courses and grades
  const progress: Array<[string, Record<string, unknown>]> = [
    ["chicago", { tzOffsetMinutes: TZ }],
    ["utc-algebra1", { tzOffsetMinutes: 0, course: "algebra1" }],
    ["tokyo-grade6", { tzOffsetMinutes: -540, grade: 6 }],
    ["grade3", { tzOffsetMinutes: TZ, grade: 3, course: null }],
  ];
  for (const [name, opts] of progress) out.push({ name: `progressSummary/${name}`, method: "progressSummary", args: { attempts: ATTEMPTS, now: NOW, ...opts } });
  out.push({ name: "progressSummary/empty", method: "progressSummary", args: { attempts: [], now: NOW } });
  out.push({ name: "progressSummary/later", method: "progressSummary", args: { attempts: ATTEMPTS.slice(4), now: NOW + 9 * 86_400_000, tzOffsetMinutes: TZ } });
  // "Practice my weak spots", from the fixture student's own hint
  const hint = learnerHint(summarize(ATTEMPTS, NOW, { tzOffsetMinutes: TZ }));
  out.push({ name: "weakSpotPractice/fixture", method: "weakSpotPractice", args: { hint, seed: 77 } });
  out.push({ name: "weakSpotPractice/none", method: "weakSpotPractice", args: { hint: { weakSkills: [], strongSkills: [], recurringMistakes: [] }, seed: 1 } });
  out.push({
    name: "weakSpotPractice/skip-unpracticable",
    method: "weakSpotPractice",
    args: { hint: { weakSkills: [{ id: "word_problems", name: "Word problems" }, { id: "fractions", name: "Fractions" }], strongSkills: [], recurringMistakes: [] }, seed: 3, count: 2 },
  });
  return out;
}

function boundaryCases(): BrainCase[] {
  return [
    { name: "version", method: "version", args: {} },
    { name: "error/unknown-method", method: "noSuchMethod", args: {} },
    { name: "error/bad-args", method: "analyzeLine", args: { latex: 42 } },
    { name: "error/bad-stroke", method: "clusterStrokes", args: { strokes: [{ id: "a", x: [1, 2], y: [1] }] } },
    { name: "nonfinite/domain", method: "analyzeLine", args: { latex: "x = 4", context: { mode: "feedback", previous: { kind: "equation", math: "x^2 == 16", resultLatex: "", verdict: "none", note: "", variable: "x", domain: { variable: "x", lo: 0, hi: Infinity, loIn: false, hiIn: false, unit: "plain", latex: "x > 0" } } } } },
  ];
}

/**
 * Ask (Phase 3): the read-aloud chunking of replies as they stream (sentences, their words with the
 * maths said, phrases, the reply's cap) and the screen's picture for a request. A plan of board
 * actions (`chatPlan`) settles between two calls, so it is checked in the Swift tests instead.
 */
function askCases(): BrainCase[] {
  const out: BrainCase[] = [];
  const replies = [
    "Great question! A half is $\\frac{1}{2}$ of a pizza. Then we add 3.5 more",
    "**Step 1.** Take 3 from both sides: $2x + 3 - 3 = 11 - 3$.\n\n- So $2x = 8$.\n- Then $x = 4$!",
    "It costs $5. Then $x^2 = 9$, so $x = \\pm 3$. e.g. try 2.",
    "$$\\frac{3}{4} + \\frac{1}{8} = \\frac{7}{8}$$\nThat's it. <board>{\"actions\":[]}</board>",
  ];
  replies.forEach((text, i) => {
    out.push({ name: `speechTake/${i}/streaming`, method: "speechTake", args: { text, from: 0, final: false } });
    out.push({ name: `speechTake/${i}/final`, method: "speechTake", args: { text, from: 0, final: true } });
  });
  out.push({ name: "speechSplit/long", method: "speechSplit", args: { words: "one, two, three, four, five, six, seven, eight, nine, ten, eleven, twelve ".repeat(6), max: 120 } });
  out.push({ name: "speechFit/cut", method: "speechFit", args: { words: "This is a sentence. And this is a second one that goes on a while longer.", left: 45 } });
  out.push({ name: "speechFit/none", method: "speechFit", args: { words: "Too long to fit in so little.", left: 10 } });
  out.push({ name: "spoken/hint", method: "spoken", args: { text: "What is $\\frac{3}{4} + \\frac{1}{8}$? Try $x^{2} = 9$." } });
  const cell = { x: 0, y: 0, w: 800, h: 450 };
  out.push({
    name: "chatPicture/problems-and-lines",
    method: "chatPicture",
    args: {
      pageId: "screen:a",
      studentLines: ["2x + 3 = 11", "2x = 8"],
      shapes: [
        { id: "p1", type: "draw", meta: { live: true, source: "ai", chatProblem: { n: 1, lines: ["2x + 3 = 11"], cell } }, bounds: { x: 30, y: 30, w: 100, h: 40 } },
        { id: "g", type: "draw", meta: { live: true, source: "ai", chatBlock: "graph", handLine: "y = x" }, bounds: { x: 900, y: 30, w: 100, h: 40 } },
        { id: "l", type: "draw", meta: { live: true, source: "ai", chatBlock: "lines", handLine: "a^{2} + b^{2} = c^{2}" }, bounds: { x: 900, y: 500, w: 100, h: 40 } },
        { id: "k", type: "draw", meta: {}, bounds: { x: 60, y: 120, w: 80, h: 40 } },
      ],
    },
  });
  out.push({ name: "chatPicture/carried", method: "chatPicture", args: { pageId: "screen:b", shapes: [], carried: { "screen:b": { screen: 1, problems: ["2x = 8"], numbers: [3] } } } });
  return out;
}

/** Every parity case, in a fixed order. */
export function parityCases(): BrainCase[] {
  return [...boundaryCases(), ...analyzeCases(), ...solveCases(), ...engineCases(), ...inkCases(), ...handCases(), ...policyCases(), ...learningCases(), ...askCases()];
}
