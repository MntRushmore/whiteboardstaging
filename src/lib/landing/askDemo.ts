/**
 * The Ask demo on the landing page (v3, 2026-10-12), as data: the board it plays on, the fraction
 * bars the tutor draws there, the reply's words as they stream, and when each thing happens. The
 * section (`AskDemo.tsx`) renders it once on the server and CSS plays it.
 *
 * Nothing here is invented for the page:
 *  - the bars are the board's own `draw_model` planner (`sketchModel`, src/lib/live/chat/models),
 *    planned in one of the board's own boxes and inked as the board inks them (tldraw's blue lines,
 *    a pale flat tint inside a shaded part once its outline is whole, labels in the tutor's hand),
 *    at the board's pace (`plan.pace`);
 *  - the problems on the board are the board's comparison form (`\frac{3}{4} \bigcirc \frac{5}{8}`,
 *    src/lib/live/chat/problemForms.ts), written by the hand engine (`handInk`);
 *  - the reply is parsed by the panel's own `parseRichText`, so its maths is the panel's maths.
 *
 * Pure: no React, no DOM. Unit-tested in `__tests__/askDemo.test.ts`.
 */
import { mulberry32, polylineToSvgD, STROKE_GAP_MS, strokeDurationMs } from "@/lib/hand";
import { parseRichText, type RichInline } from "@/lib/live/ask/richText";
import type { VisualModel } from "@/lib/live/chat/contracts";
import { MODEL_BOXES, sketchModel } from "@/lib/live/chat/models";
import { handInk } from "./handInk";

// ------------------------------------------------------------------ the board's inks

/**
 * tldraw's light theme for the inks a model uses: the line and its "solid" fill, a pale tint of
 * it (the visual models' gallery, src/lib/live/chat/models/__tests__/gallery.ts). Never a gradient.
 */
export const BOARD_INKS: Readonly<Record<string, { ink: string; tint: string }>> = {
  blue: { ink: "#4465e9", tint: "#dce1f8" },
  orange: { ink: "#e16919", tint: "#f8e2d4" },
  green: { ink: "#099268", tint: "#d3e9e3" },
  violet: { ink: "#ae3ec9", tint: "#ecdcf2" },
  "light-blue": { ink: "#4ba1f1", tint: "#ddedfa" },
};

/**
 * The pen's width in board px for a stroke of `weight` (1 = the tutor's usual pen; a fill's fine
 * edge is 0.4). The gallery's `0.765 × (1 + 2.4w)` is a hairline under what tldraw's freehand
 * outline paints on a real board (docs/qa-screenshots/ask-v2-models/board-2-*.png: about 4.7 px for
 * a bar, 2.7 px for a fill's edge), so the page draws the board's weight, not the gallery's.
 */
export function boardPen(weight = 1): number {
  return round(1.4 * (1 + 2.4 * weight));
}

// ------------------------------------------------------------------ the drawing

/** What the tutor draws: a bar cut in 2 with 1 part shaded, under a bar cut in 3 with 1 part shaded. */
export const ASK_MODEL: Extract<VisualModel, { kind: "fraction_bars" }> = {
  kind: "fraction_bars",
  bars: [
    { parts: 2, shaded: 1 },
    { parts: 3, shaded: 1 },
  ],
};

/** One stroke of ink, in board px, and when it is drawn (ms from the drawing's start, wall clock). */
export interface AskPath {
  d: string;
  /** the line's colour */
  stroke: string;
  /** a closed shape's tint, filled once its outline is whole; null: a line */
  fill: string | null;
  width: number;
  atMs: number;
  forMs: number;
}

export interface AskDrawing {
  width: number;
  height: number;
  paths: AskPath[];
  /** the labels the tutor wrote, in order ("\frac{1}{2}", "\frac{1}{3}") */
  labels: string[];
  /** when the last stroke is done, wall clock */
  durationMs: number;
}

const round = (n: number) => Math.round(n * 10) / 10;

type P = { x: number; y: number };

/** Distance from p to the segment a–b. */
function offLine(p: P, a: P, b: P): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2));
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

/**
 * The stroke thinned to the points that matter (Ramer–Douglas–Peucker, within `eps` board px, as
 * boardInk.ts thins the hero's strokes): the pen's bow and wobble stay, the page carries a fraction
 * of the points.
 */
export function thin(points: readonly P[], eps = 0.3): P[] {
  if (points.length < 3) return [...points];
  const keep = new Array<boolean>(points.length).fill(false);
  keep[0] = keep[points.length - 1] = true;
  const stack: Array<[number, number]> = [[0, points.length - 1]];
  while (stack.length) {
    const [i, j] = stack.pop()!;
    let far = -1;
    let best = eps;
    for (let k = i + 1; k < j; k++) {
      const d = offLine(points[k], points[i], points[j]);
      if (d > best) {
        best = d;
        far = k;
      }
    }
    if (far !== -1) {
      keep[far] = true;
      stack.push([i, far], [far, j]);
    }
  }
  return points.filter((_, k) => keep[k]);
}

/**
 * The model as the board draws it in `box` (one of `MODEL_BOXES.fraction_bars`): every stroke of
 * every part in the planner's order, each as long as the hand takes to draw it (`strokeDurationMs`,
 * the pen lifting `STROKE_GAP_MS` between strokes) and sped up by the plan's pace, as the board's
 * writer does. Throws when the planner draws nothing, so a bad box fails the build, never the page.
 */
export function drawModel(model: VisualModel, box: { w: number; h: number }, seed = 7): AskDrawing {
  const sketch = sketchModel(model, box, seed);
  if (!sketch) throw new Error(`askDemo: the board draws nothing for ${model.kind} in ${box.w}×${box.h}`);
  const { plan } = sketch;
  const pace = plan.pace ?? 1;
  const paths: AskPath[] = [];
  let end = 0;
  for (const line of plan.lines) {
    const ink = BOARD_INKS[line.style?.color ?? "blue"] ?? BOARD_INKS.blue;
    const filled = Boolean(line.style?.closed && line.style.fill && line.style.fill !== "none");
    let t = line.startMs;
    for (const stroke of line.strokes) {
      const ms = strokeDurationMs(stroke);
      const points = thin(stroke.points.map((p) => ({ x: p.x + line.x, y: p.y + line.y }))).map((p) => ({ x: round(p.x), y: round(p.y) }));
      const d = polylineToSvgD(points) + (line.style?.closed ? " Z" : "");
      const atMs = Math.round(t / pace);
      const forMs = Math.round(ms / pace);
      paths.push({
        d,
        stroke: ink.ink,
        fill: filled ? (line.style?.fill === "fill" ? ink.ink : ink.tint) : null,
        width: boardPen(stroke.weight ?? 1),
        atMs,
        forMs,
      });
      end = Math.max(end, atMs + forMs);
      t += ms + STROKE_GAP_MS;
    }
  }
  return {
    width: round(plan.bounds.w),
    height: round(plan.bounds.h),
    paths,
    labels: sketch.texts.map((x) => x.text),
    durationMs: end,
  };
}

// ------------------------------------------------------------------ the board

/** The worksheet the tutor wrote: comparisons to fill in with <, > or = (the board's own form). */
export const ASK_PROBLEMS = ["\\frac{1}{2}\\bigcirc\\frac{1}{3}", "\\frac{3}{4}\\bigcirc\\frac{5}{8}", "\\frac{2}{5}\\bigcirc\\frac{3}{5}"] as const;

/** A problem as the board numbers it ("1. ½ ○ ⅓"). */
export const numbered = (n: number, latex: string) => `${n}.\\;\\;${latex}`;

/** The hand's size for a problem on the board, in board px (the visual models' writing is 46). */
export const PROBLEM_SIZE = 48;

export interface SheetProblem {
  latex: string;
  /** the hand's seed (`HandMath`'s): the same strokes wherever it is laid out */
  seed: number;
  /** top-left of its ink box, board px */
  x: number;
  y: number;
  width: number;
  height: number;
}

/** The white screen of the board, in board px: the problems, and the drawing beside problem 1. */
export interface AskSheet {
  width: number;
  height: number;
  problems: SheetProblem[];
  drawing: AskDrawing;
  /** the drawing's top-left */
  at: { x: number; y: number };
  /** where the drawing ends, down the screen (a phone's board shows the screen to just past it) */
  drawingBottom: number;
}

function problem(n: number, x: number, y: number): SheetProblem {
  const latex = numbered(n, ASK_PROBLEMS[n - 1]);
  const ink = handInk(latex, { size: PROBLEM_SIZE, seed: n + 1 });
  return { latex, seed: n + 1, x, y, width: round(ink.width), height: round(ink.height) };
}

/** px of board kept round the writing, as the board keeps from a screen's edges */
const MARGIN = 56;
/** after a problem, before a drawing beside it: room for its answer (the desk's `place.ts` keeps 96) */
const ANSWER_ROOM = 96;

/**
 * The board, two ways. `wide` (the panel docked beside a wide board): problem 1 with the drawing
 * beside it on its row, where the desk puts a drawing that goes with a problem (`near`: right of
 * the problem, level with it, room kept for its answer), and problems 2 and 3 on the next row.
 * `narrow` (a narrow board, or a phone's board above the panel's sheet): the drawing under
 * problem 1, and problem 2 below it.
 */
export function askSheets(): { wide: AskSheet; narrow: AskSheet } {
  const [, second, third] = MODEL_BOXES.fraction_bars;
  const one = problem(1, MARGIN, MARGIN + 24);
  const middle = one.y + one.height / 2;

  const wideDrawing = drawModel(ASK_MODEL, second);
  const wideAt = { x: round(one.x + one.width + ANSWER_ROOM), y: round(Math.max(MARGIN - 16, middle - wideDrawing.height / 2)) };
  const row2 = round(Math.max(wideAt.y + wideDrawing.height, one.y + one.height) + 104);
  const wide: AskSheet = {
    width: round(wideAt.x + wideDrawing.width + MARGIN),
    height: round(row2 + one.height + MARGIN * 1.5),
    problems: [one, problem(2, one.x, row2), problem(3, round(one.x + 400), row2)],
    drawing: wideDrawing,
    at: wideAt,
    drawingBottom: round(wideAt.y + wideDrawing.height),
  };

  const narrowDrawing = drawModel(ASK_MODEL, third);
  const narrowAt = { x: MARGIN - 20, y: round(one.y + one.height + 48) };
  const narrowRow2 = round(narrowAt.y + narrowDrawing.height + 88);
  const narrow: AskSheet = {
    width: round(narrowAt.x + narrowDrawing.width + MARGIN - 20),
    height: round(narrowRow2 + one.height + MARGIN),
    problems: [one, problem(2, one.x, narrowRow2)],
    drawing: narrowDrawing,
    at: narrowAt,
    drawingBottom: round(narrowAt.y + narrowDrawing.height),
  };
  return { wide, narrow };
}

// ------------------------------------------------------------------ the reply, streaming

/** A piece of the reply: a word with the space after it, or a formula. */
type Piece =
  | { kind: "text"; text: string; bold: boolean }
  /** `tail`: punctuation written right after the formula ("."), kept on its line */
  | { kind: "math"; src: string; tail: string };

/** A piece of the reply, and when it arrives. */
export type AskToken = Piece & { atMs: number };

/** The reply, paragraph by paragraph. */
export interface AskStream {
  paragraphs: AskToken[][];
  /** when the last word lands */
  endMs: number;
  /** when the first sentence is whole (read aloud from then: the voice reads sentence by sentence) */
  firstSentenceMs: number;
}

/** How the reply streams: about a word every 75 ms, a beat at the end of a sentence. */
export const STREAM_TIMING = { wordMs: 74, jitterMs: 34, sentenceMs: 230, commaMs: 80, mathMs: 60 } as const;

/** Words and formulas, in order, for one paragraph's inline nodes. */
function tokens(nodes: readonly RichInline[], bold = false): Piece[] {
  const out: Piece[] = [];
  for (const n of nodes) {
    if (n.t === "bold") {
      out.push(...tokens(n.c, true));
    } else if (n.t === "br") {
      out.push({ kind: "text", text: "\n", bold });
    } else if (n.t === "math") {
      out.push({ kind: "math", src: n.v, tail: "" });
    } else {
      let text = n.v;
      const last = out.at(-1);
      // punctuation straight after a formula goes with it, so a line never starts with "."
      const lead = /^[^\s]+/.exec(text);
      if (last?.kind === "math" && lead) {
        last.tail = lead[0];
        text = text.slice(lead[0].length);
      }
      for (const word of text.match(/\s*\S+\s*|\s+/g) ?? []) out.push({ kind: "text", text: word, bold });
    }
  }
  return out;
}

/**
 * The reply's words and when each arrives, from `startMs`: the panel's own parse of it
 * (`parseRichText`), cut into words; a deterministic little unevenness so it reads as a stream, not
 * a metronome.
 */
export function streamReply(answer: string, startMs: number, seed = 5): AskStream {
  const rng = mulberry32(seed);
  const T = STREAM_TIMING;
  let t = startMs;
  let firstSentenceMs: number | null = null;
  const paragraphs: AskToken[][] = [];
  for (const block of parseRichText(answer)) {
    if (block.t !== "p") throw new Error("askDemo: the demo's reply is paragraphs only");
    const row: AskToken[] = [];
    for (const token of tokens(block.c)) {
      row.push({ ...token, atMs: Math.round(t) });
      const text = token.kind === "text" ? token.text.trim() : token.tail;
      const sentence = /[.!?]$/.test(text);
      if (sentence && firstSentenceMs === null) firstSentenceMs = Math.round(t);
      t += T.wordMs + (rng() - 0.5) * 2 * T.jitterMs + (sentence ? T.sentenceMs : /[,;:]$/.test(text) ? T.commaMs : 0) + (token.kind === "math" ? T.mathMs : 0);
    }
    paragraphs.push(row);
  }
  const last = paragraphs.flat().at(-1);
  const endMs = last ? last.atMs : startMs;
  return { paragraphs, endMs, firstSentenceMs: firstSentenceMs ?? endMs };
}

// ------------------------------------------------------------------ the timeline

/**
 * The exchange, in ms from the moment the demo is in view, as the panel lives it
 * (src/components/chat): the kid holds the mic ("Listening… Let go when you're done."), lets go
 * ("Getting your words…"), their words are sent; the tutor thinks, streams its reply (read out loud,
 * the send button a Stop meanwhile), then writes on the board ("Writing on your board…") and is done
 * (its Read it again button).
 */
export interface AskTimeline {
  micDownMs: number;
  micUpMs: number;
  sentMs: number;
  thinkingMs: number;
  streamMs: number;
  streamEndMs: number;
  drawMs: number;
  drawEndMs: number;
  doneMs: number;
  /** the voice reading the reply (the speaker's waves move) */
  speakFromMs: number;
  speakToMs: number;
  stream: AskStream;
}

export function askTimeline(answer: string, drawingMs: number): AskTimeline {
  // a beat on the hello first: the demo starts with its top in view, and the mic is at its foot
  const micDownMs = 1400;
  const micUpMs = micDownMs + 2400;
  const sentMs = micUpMs + 700;
  const thinkingMs = sentMs + 280;
  const streamMs = thinkingMs + 1000;
  const stream = streamReply(answer, streamMs);
  const streamEndMs = stream.endMs + 160;
  const drawMs = streamEndMs + 520;
  const drawEndMs = drawMs + drawingMs;
  const doneMs = drawEndMs + 300;
  return {
    micDownMs,
    micUpMs,
    sentMs,
    thinkingMs,
    streamMs,
    streamEndMs,
    drawMs,
    drawEndMs,
    doneMs,
    speakFromMs: stream.firstSentenceMs + 260,
    speakToMs: doneMs,
    stream,
  };
}
