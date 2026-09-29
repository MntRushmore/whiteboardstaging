import type { Rect } from "../contracts";
import { Pen } from "../graphing/pen";
import { planFromGroups } from "../graphing/plan";
import { HAND_WRITE, placeHandPlan, planHandwriting, type HandPlan } from "../handwriting";
import { handBox } from "../lecture/chart/sketch";
import { measureWords, wordsWeight, writeLayout } from "../lecture/words";
import { joinPlans } from "./layout";
import { continues, relationsIn } from "./teach";

/**
 * Where the board chat writes a worked solution (`teach`) on a 1600×900 screen, the way a teacher
 * lays one out on a whiteboard: the figure at the top right; the steps down the left, each one's
 * sentence in the tutor's hand (a little smaller than the maths) with its maths under it; the
 * answer last, boxed. A long solution carries on in a second column, under the figure, as a
 * teacher moves along the board — two columns when the room is wide enough (a whole screen), one
 * beside other work.
 *
 * A chain's lines line up on their `=`: the first line `OR = \sqrt{…}` is written where it falls,
 * and every `= …` under it starts where its `=` is, so the equals signs run down in a column; the
 * lines of an equation solved line by line (`2x + 3 = 11`, `2x = 8`, `x = 4`) line up the same way.
 * A chain that starts with an expression (`(2m + 1) + (2n + 1)`) has its `= …` lines indented under it.
 *
 * The hand is as large as fits (`TEACH_LAYOUT.sizes`, the words at `wordsShare` of it); when even
 * the smallest does not fit, the steps that do are laid out and `rest` says where the next screen
 * starts. Pure: plans in page px; the writer (`teachWrite.ts`) writes them.
 */

export const TEACH_LAYOUT = {
  /** screen margins (the board's bar floats over the top edge) */
  marginX: 56,
  marginTop: 84,
  marginBottom: 36,
  /** hand sizes of the maths tried, largest first */
  sizes: [40, 37, 34, 31, 28],
  /** how much smaller (px of hand) the maths may be written to keep the answer right under the last step */
  flowSizeCost: 6,
  /** a sentence is written this much smaller than the maths, never below `minWords` */
  wordsShare: 0.8,
  minWords: 22,
  /** the pen of the words: as fine as their size (`wordsWeight`), but not finer than this beside the maths */
  minWordsWeight: 0.7,
  /** most lines a sentence wraps to */
  sayLines: 3,
  /** two columns from this width of room; the gap between them */
  twoColumnsFrom: 1100,
  columnGap: 64,
  /** figure boxes tried, largest first, and the room kept round the figure */
  figureBoxes: [
    { w: 440, h: 340 },
    { w: 380, h: 300 },
    { w: 320, h: 250 },
  ],
  figureGap: 36,
  /** text beside the figure needs at least this much width, else it goes under it */
  besideMin: 360,
  /** gaps, as a share of the maths size: under a sentence, between maths lines, between steps, before the answer */
  sayGap: 0.32,
  lineGap: 0.3,
  /** and more above a line that starts a new chain in the same step */
  chainGap: 0.3,
  stepGap: 0.85,
  answerGap: 0.6,
  /** `= …` under an expression: indented this share of the size */
  indent: 0.9,
  /** the steps' `=` line up down the whole solution, unless a left side is wider than this share of a column */
  alignShare: 0.4,
  /** room between the answer and its box (share of the size), and the box's corner radius */
  boxPad: 0.34,
  boxRadius: 9,
  /** a step is written at a person's pace, sped up when it is long (like `paceFor`); the whole solution within `totalMaxWallMs` */
  pace: { naturalUpToMs: 3000, maxWallMs: 4500, maxPace: 5, totalMaxWallMs: 24_000 },
  /** the pause between two steps (the writer's) */
  stepPauseMs: 550,
  /** the least room beside other work worth teaching in (else a new screen), and the least hand there */
  minArea: { w: 560, h: 320 },
  besideMinSize: 34,
} as const;

export interface TeachLayoutStep {
  say: string;
  math: readonly string[];
}

export interface TeachLayoutInput {
  /** where it may be written (page px), margins already kept: `teachArea(screen)` or a part of it */
  area: Rect;
  steps: readonly TeachLayoutStep[];
  answer?: string;
  /** the figure drawn into a box (px from 0, 0); null when it cannot be; absent: no figure */
  figure?: ((box: { w: number; h: number }) => HandPlan | null) | null;
  seed: number;
}

export interface TeachPiece {
  kind: "figure" | "say" | "math" | "answer" | "box";
  step: number;
  rect: Rect;
  /** a maths line's relation sign (its `=`), page x, when it has one */
  relX?: number;
  latex?: string;
}

export interface TeachLayout {
  size: number;
  wordsSize: number;
  figure: HandPlan | null;
  /** one placed block per step laid out: its sentence, then its maths */
  steps: HandPlan[];
  /** the answer and its box, when laid out */
  answer: HandPlan | null;
  /** the first step NOT laid out (steps.length: all of them) */
  rest: number;
  pieces: TeachPiece[];
  bounds: Rect;
}

/** The part of a screen a worked solution may use: inside the margins, under the board's bar. */
export function teachArea(screen: Rect): Rect {
  const L = TEACH_LAYOUT;
  return { x: screen.x + L.marginX, y: screen.y + L.marginTop, w: screen.w - 2 * L.marginX, h: screen.h - L.marginTop - L.marginBottom };
}

/**
 * Clear room on a screen that has something on it, beside what is there: right of all of it, under
 * it, left of it — each kept `gap` clear — when it is large enough to teach in. Largest first.
 */
export function freeAreas(area: Rect, taken: readonly Rect[], gap = 48): Rect[] {
  if (taken.length === 0) return [area];
  const u = union(taken);
  const out: Rect[] = [
    { x: right(u) + gap, y: area.y, w: right(area) - right(u) - gap, h: area.h },
    { x: area.x, y: bottom(u) + gap, w: area.w, h: bottom(area) - bottom(u) - gap },
    { x: area.x, y: area.y, w: u.x - gap - area.x, h: area.h },
  ];
  return out.filter((r) => r.w >= TEACH_LAYOUT.minArea.w && r.h >= TEACH_LAYOUT.minArea.h).sort((a, b) => b.w * b.h - a.w * a.h);
}

/** Nothing of the layout touches what is on the screen (kept `pad` clear). */
export function layoutClearOf(layout: TeachLayout, taken: readonly Rect[], pad = 12): boolean {
  return !layout.pieces.some((p) => taken.some((t) => p.rect.x - pad < right(t) && right(p.rect) + pad > t.x && p.rect.y - pad < bottom(t) && bottom(p.rect) + pad > t.y));
}

const right = (r: Rect) => r.x + r.w;
const bottom = (r: Rect) => r.y + r.h;

function union(rects: readonly Rect[]): Rect {
  const x0 = Math.min(...rects.map((r) => r.x));
  const y0 = Math.min(...rects.map((r) => r.y));
  const x1 = Math.max(...rects.map(right));
  const y1 = Math.max(...rects.map(bottom));
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

/** The pen's speed-up for a step block (`paceFor`'s rule, on the teaching budget). */
export function teachPaceFor(naturalMs: number): number {
  const { naturalUpToMs, maxWallMs, maxPace } = TEACH_LAYOUT.pace;
  if (!(naturalMs > naturalUpToMs)) return 1;
  const wall = Math.min(maxWallMs, naturalUpToMs + (naturalMs - naturalUpToMs) / 3);
  return Math.min(maxPace, naturalMs / wall);
}

/** One line of maths in the hand, from (0, 0); null when the hand cannot write it. */
function mathPlan(latex: string, size: number, seed: number): HandPlan | null {
  const r = planHandwriting([latex], { size, seed });
  return r.plan && r.unsupported.length === 0 ? r.plan : null;
}

/** A maths line's plan and where its relation sign is (px from its ink's left), null when it has none. */
interface MathLine {
  latex: string;
  plan: HandPlan;
  /** px from the line's left to its relation sign; 0 for a line that starts with one */
  rel: number | null;
  /** it continues the line above (`= …`) */
  cont: boolean;
}

function measureMath(latex: string, size: number, seed: number): MathLine | null {
  const plan = mathPlan(latex, size, seed);
  if (!plan) return null;
  const cont = continues(latex);
  if (cont) return { latex, plan, rel: 0, cont };
  const first = relationsIn(latex)[0];
  if (!first || first.at === 0) return { latex, plan, rel: null, cont };
  // where the `=` is: the whole line's width less the width of `= …` written on its own
  const tail = mathPlan(latex.slice(first.at), size, seed);
  const rel = tail ? Math.max(0, plan.bounds.w - tail.bounds.w) : null;
  return { latex, plan, rel, cont };
}

/**
 * A step's maths lined up: every line with a relation has it at the same x (`relX`, px from the
 * block's left), `= …` lines under an expression indented. The lines' x offsets and the width.
 */
export function alignMath(lines: readonly Pick<MathLine, "plan" | "rel" | "cont">[], size: number, atLeast = 0): { xs: number[]; width: number } {
  // the head line of each line's chain (a line that does not continue another is its own head)
  const heads: number[] = [];
  lines.forEach((l, i) => heads.push(l.cont && i > 0 ? heads[i - 1] : i));
  // the relation signs of every chain that has one line up on the rightmost of them (and of the
  // other steps', `atLeast`: one column of `=` down the whole solution)
  const relX = Math.max(atLeast, ...lines.filter((l, i) => heads[i] === i && l.rel !== null).map((l) => l.rel as number));
  const xs = lines.map((l, i) => {
    const head = lines[heads[i]];
    if (head.rel === null) return i === heads[i] ? 0 : TEACH_LAYOUT.indent * size;
    return i === heads[i] ? relX - head.rel : relX;
  });
  const width = Math.max(0, ...lines.map((l, i) => xs[i] + l.plan.bounds.w));
  return { xs, width };
}

/** A sentence laid out and written at `at` (top-left), as a one-line plan per sentence; null when it does not fit. */
function sayPlan(text: string, size: number, maxWidth: number, at: { x: number; y: number }, seed: number, step: number): HandPlan | null {
  // the fewest lines that fit, as even as they go: no word left alone on the last line
  const layout = measureWords(text, size, { maxWidth, maxLines: TEACH_LAYOUT.sayLines, balance: true });
  if (!layout) return null;
  const words = writeLayout(layout, at, "left", "top", seed);
  if (words.strokes.length === 0) return null;
  const weight = Math.max(TEACH_LAYOUT.minWordsWeight, wordsWeight(size));
  for (const s of words.strokes) s.weight = weight;
  // an empty `latex`: the board's picture of the screen lists the tutor's maths, not its sentences
  const plan = planFromGroups([{ label: "", strokes: words.strokes }], size);
  if (!plan) return null;
  return { ...plan, lines: plan.lines.map((l) => ({ ...l, part: `say:${step}` })) };
}

interface Column {
  x: number;
  w: number;
  top: number;
}

/** The whole layout at one hand size and figure box; null when a line is too wide for any column. */
function layoutAt(input: TeachLayoutInput, size: number, box: { w: number; h: number } | null): TeachLayout | null {
  const L = TEACH_LAYOUT;
  const area = input.area;
  const seed = input.seed;
  const wordsSize = Math.max(L.minWords, Math.round(size * L.wordsShare));
  const n = area.w >= L.twoColumnsFrom ? 2 : 1;
  const colW = (area.w - (n - 1) * L.columnGap) / n;
  const columns: Column[] = Array.from({ length: n }, (_, k) => ({ x: area.x + k * (colW + L.columnGap), w: colW, top: area.y }));
  const pieces: TeachPiece[] = [];

  // the figure, top right
  let figure: HandPlan | null = null;
  let fig: Rect | null = null;
  if (input.figure && box) {
    const plan = input.figure(box);
    if (!plan) return null;
    figure = placeHandPlan(plan, { x: right(area) - plan.bounds.w, y: area.y });
    fig = figure.bounds;
    pieces.push({ kind: "figure", step: 0, rect: fig });
    // the second column is read after the first: it starts under the figure, never beside it
    if (n > 1) columns[n - 1].top = bottom(fig) + L.figureGap;
  }

  /** the room in column `c` for a block from y to y + h: its left and width (the figure kept clear) */
  const room = (c: Column, y: number, h: number): { x: number; w: number } => {
    if (!fig) return { x: c.x, w: c.w };
    const g = L.figureGap;
    const overlapsY = y < bottom(fig) + g && y + h > fig.y - g;
    const overlapsX = c.x < right(fig) + g && c.x + c.w > fig.x - g;
    if (!overlapsY || !overlapsX) return { x: c.x, w: c.w };
    return { x: c.x, w: Math.max(0, fig.x - g - c.x) };
  };
  const belowFigure = () => (fig ? bottom(fig) + L.figureGap : area.y);

  // each step measured once (its maths does not depend on where it goes)
  const measured = input.steps.map((s, i) => {
    const lines = s.math.map((m, k) => measureMath(m, size, seed + 101 * (i + 1) + k));
    return lines.some((l) => !l) ? null : (lines as MathLine[]);
  });
  if (measured.some((m) => !m)) return null;
  // one column of `=` down the whole solution, unless a line's left side is too long for it
  const heads = measured.flatMap((lines) => lines!.filter((l) => !l.cont && l.rel !== null).map((l) => l.rel as number));
  const relAll = Math.max(0, ...heads.filter((r) => r <= L.alignShare * colW));

  let col = 0;
  let y = columns[0].top;
  let first = true;
  const steps: HandPlan[] = [];
  let rest = input.steps.length;

  /** lays step i out at (column, y) if it fits there: its plan and its height */
  const tryStep = (i: number, c: Column, top: number): { plan: HandPlan; h: number; pieces: TeachPiece[] } | null => {
    const lines = measured[i]!;
    const own = lines.some((l) => !l.cont && l.rel !== null && l.rel > relAll);
    const { xs, width } = alignMath(lines, size, own ? 0 : relAll);
    /** the room above maths line k: a new chain starts a little further down than a line that continues one */
    const gapAbove = (k: number) => (k === 0 ? 0 : (L.lineGap + (lines[k].cont ? 0 : L.chainGap)) * size);
    const mathH = lines.reduce((h, l, k) => h + l.plan.bounds.h + gapAbove(k), 0);
    // the sentence wraps to the room at the top; the maths needs its whole width where it goes
    let r = room(c, top, wordsSize * 2);
    if (r.w < L.besideMin && r.w < c.w) return null;
    const text = input.steps[i].say.trim();
    const say = text ? sayPlan(text, wordsSize, r.w, { x: r.x, y: top }, seed + 7 * (i + 1), i + 1) : null;
    if (text && !say) return null;
    if (!say && lines.length === 0) return null;
    let y0 = say ? bottom(say.bounds) + (lines.length ? L.sayGap * size : 0) : top;
    r = room(c, y0, mathH);
    if (width > r.w) return null;
    const parts: HandPlan[] = say ? [say] : [];
    const ps: TeachPiece[] = say ? [{ kind: "say", step: i + 1, rect: say.bounds }] : [];
    lines.forEach((l, k) => {
      y0 += gapAbove(k);
      const placed = placeHandPlan(l.plan, { x: r.x + xs[k], y: y0 });
      parts.push(placed);
      ps.push({ kind: "math", step: i + 1, rect: placed.bounds, latex: l.latex, ...(l.rel !== null ? { relX: r.x + xs[k] + l.rel } : {}) });
      y0 = bottom(placed.bounds);
    });
    const plan = joinPlans(parts, 280, teachPaceFor);
    if (!plan) return null;
    const h = bottom(plan.bounds) - top;
    return { plan, h, pieces: ps };
  };

  for (let i = 0; i < input.steps.length; i++) {
    let placed: ReturnType<typeof tryStep> = null;
    while (col < columns.length) {
      const c = columns[col];
      const top = first ? y : y + L.stepGap * size;
      placed = tryStep(i, c, top);
      // beside the figure there was no room: under it, in the same column
      if (!placed && fig && room(c, top, size).w < c.w && top < belowFigure()) placed = tryStep(i, c, belowFigure());
      if (placed && bottom(placed.plan.bounds) <= bottom(area) + 0.5) break;
      placed = null;
      col++;
      if (col < columns.length) {
        y = columns[col].top;
        first = true;
      }
    }
    if (!placed) {
      if (i === 0) return null;
      rest = i;
      break;
    }
    steps.push(placed.plan);
    pieces.push(...placed.pieces);
    y = bottom(placed.plan.bounds);
    first = false;
  }

  // the answer, boxed, after the last step
  let answer: HandPlan | null = null;
  if (input.answer && rest === input.steps.length) {
    const plan = mathPlan(input.answer, size, seed + 997);
    if (!plan) return null;
    const pad = L.boxPad * size;
    const need = { w: plan.bounds.w + 2 * pad, h: plan.bounds.h + 2 * pad };
    while (col < columns.length && !answer) {
      const c = columns[col];
      let top = first ? y : y + L.answerGap * size;
      let r = room(c, top, need.h);
      if (need.w > r.w && fig && top < belowFigure()) {
        top = Math.max(top, belowFigure());
        r = room(c, top, need.h);
      }
      if (need.w <= r.w && top + need.h <= bottom(area) + 0.5) {
        const placed = placeHandPlan(plan, { x: r.x + pad, y: top + pad });
        const boxRect = { x: r.x, y: top, w: need.w, h: need.h };
        const strokes = handBox(new Pen(seed + 991), boxRect, L.boxRadius);
        const boxPlan = planFromGroups([{ label: "", strokes }], size);
        const joined = boxPlan ? joinPlans([placed, { ...boxPlan, lines: boxPlan.lines.map((l) => ({ ...l, part: "box" })) }], 200, teachPaceFor) : placed;
        answer = joined;
        pieces.push({ kind: "answer", step: input.steps.length + 1, rect: placed.bounds, latex: input.answer });
        if (boxPlan) pieces.push({ kind: "box", step: input.steps.length + 1, rect: boxPlan.bounds });
        break;
      }
      col++;
      if (col < columns.length) {
        y = columns[col].top;
        first = true;
      }
    }
    if (!answer) rest = Math.max(0, input.steps.length - 1);
  }
  if (rest < input.steps.length) {
    // the answer goes with the last step, on the next screen
    steps.length = Math.min(steps.length, rest);
    const keep = new Set(Array.from({ length: rest }, (_, k) => k + 1));
    for (let k = pieces.length - 1; k >= 0; k--) if (pieces[k].kind !== "figure" && !keep.has(pieces[k].step)) pieces.splice(k, 1);
    answer = null;
    if (rest === 0) return null;
  }

  const all = [...(figure ? [figure.bounds] : []), ...steps.map((s) => s.bounds), ...(answer ? [answer.bounds] : [])];
  if (all.length === 0) return null;
  const bounds = union(all);
  // the pen's tremor takes ink a px or two past where it was laid out
  const tol = 4;
  if (bounds.x < area.x - tol || right(bounds) > right(area) + tol || bounds.y < area.y - tol || bottom(bounds) > bottom(area) + tol) return null;
  return { size, wordsSize, figure, steps, answer, rest, pieces, bounds };
}

/**
 * The worked solution laid out in `area`: the largest hand and figure that fit all of it, else (at
 * the smallest hand) as many steps as fit, `rest` saying where the next screen starts. Null when not
 * even the first step fits.
 */
export function layoutTeach(input: TeachLayoutInput): TeachLayout | null {
  // the figure is planned once per box (its labels' layout is the slow part)
  const figures = new Map<string, HandPlan | null>();
  const figureFn = input.figure
    ? (box: { w: number; h: number }) => {
        const k = `${box.w}x${box.h}`;
        if (!figures.has(k)) figures.set(k, input.figure!(box));
        return figures.get(k) ?? null;
      }
    : null;
  const boxes: Array<{ w: number; h: number } | null> = figureFn ? [...TEACH_LAYOUT.figureBoxes] : [null];
  let partial: TeachLayout | null = null;
  let whole: TeachLayout | null = null;
  for (const size of TEACH_LAYOUT.sizes) {
    // a hand a little smaller is worth it for the answer boxed right under the last step
    if (whole && size < whole.size - TEACH_LAYOUT.flowSizeCost) break;
    for (const box of boxes) {
      const out = layoutAt({ ...input, figure: figureFn }, size, box);
      if (!out) continue;
      if (out.rest === input.steps.length) {
        if (answerFlows(out)) return settlePace(out);
        whole ??= out;
        break;
      }
      if (!partial || out.rest > partial.rest) partial = out;
    }
  }
  if (whole) return settlePace(whole);
  // no figure that draws: the solution without it
  if (!partial && figureFn) return layoutTeach({ ...input, figure: undefined });
  return partial ? settlePace(partial) : null;
}

/** The answer is under the last step, in its column (or there is no answer). */
function answerFlows(layout: TeachLayout): boolean {
  const answer = layout.pieces.find((p) => p.kind === "answer");
  const lastStep = [...layout.pieces].reverse().find((p) => p.kind === "math" || p.kind === "say");
  if (!answer || !lastStep) return true;
  return answer.rect.y > lastStep.rect.y && answer.rect.x < lastStep.rect.x + lastStep.rect.w && answer.rect.x + answer.rect.w > lastStep.rect.x - TEACH_LAYOUT.columnGap;
}

/** A long solution is written faster, so all of it is on the board within `totalMaxWallMs`. */
function settlePace(layout: TeachLayout): TeachLayout {
  const { totalMaxWallMs, maxPace } = TEACH_LAYOUT.pace;
  const blocks = [...layout.steps, ...(layout.answer ? [layout.answer] : [])];
  const wall = blocks.reduce((s, b) => s + b.totalMs / (b.pace ?? 1), 0);
  if (wall <= totalMaxWallMs) return layout;
  const k = wall / totalMaxWallMs;
  const speed = (p: HandPlan): HandPlan => ({ ...p, pace: Math.min(Math.max(maxPace, HAND_WRITE.pacing.maxPace), (p.pace ?? 1) * k) });
  return { ...layout, steps: layout.steps.map(speed), answer: layout.answer ? speed(layout.answer) : null };
}
