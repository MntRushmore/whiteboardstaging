/**
 * K–8 PICTURE BENCH (v1.0 reliability, 2026-11-19): the boards a kid in grades K–8 actually brings to
 * the picture tutor — arrays, equal groups, base-ten blocks, area models, fraction bars, pizzas,
 * number lines, tape diagrams, balances, right triangles, rectangles — each in the mode a kid would
 * use: Solve via Draw now ("show me with …"), Suggest via Draw now, Feedback on a pen-lift with a
 * planted slip, and right work on a pen-lift in Suggest (the demo flow: accept the picture, write the
 * answer, wait for the checkmark). Synthetic only: the kid's writing is the hand engine's
 * (./board.ts handLine), never a real child's ink. The failures this is built around are the 11-13
 * demo recordings' (base-ten 47 + 38 with 2 rods for 38; fraction bars shaded wrong 4 of 4; a nudge
 * after right work; words only for "draw it as an array"; a faint pizza; a slip fixed below flagged).
 *
 * Each case says what a right result is (`expect`), in words the judge reads and in numbers the
 * scorer checks. Run by scripts/picture-k8-bench.mts.
 */
import sharp from "sharp";
import { mulberry32 } from "@/lib/hand";
import { handLine } from "./board";

export type K8Mode = "feedback" | "suggest" | "answer";
export type K8Source = "auto" | "voice";
/** What a right result is: a painted picture, a checkmark (none + correct), a feedback note, or nothing drawn */
export type K8Outcome = "picture" | "check" | "note" | "quiet";

/** Something already on the board: the kid's drawing (ink) or a picture the kid accepted earlier (tutor blue) */
export type Fig =
  | { kind: "baseTen"; x: number; y: number; tens: number; ones: number; blue?: boolean; label?: string }
  | { kind: "bars"; x: number; y: number; bars: Array<{ parts: number; shaded: number; label?: string }>; w?: number; blue?: boolean }
  | { kind: "pie"; x: number; y: number; r: number; parts: number; shaded: number; blue?: boolean }
  | { kind: "array"; x: number; y: number; rows: number; cols: number; blue?: boolean }
  | { kind: "numberLine"; x: number; y: number; from: number; to: number; jump?: [number, number]; blue?: boolean }
  | { kind: "area"; x: number; y: number; cols: number[]; row: number; products?: string[]; blue?: boolean }
  | { kind: "text"; x: number; y: number; latex: string; blue?: boolean; size?: number };

export type K8Case = {
  id: string;
  /** the picture kind (the report groups by it) */
  kind: string;
  mode: K8Mode;
  source: K8Source;
  /** the kid's lines, top left down (LaTeX for the hand engine; `words()` for plain words) */
  lines: string[];
  figs?: Fig[];
  frame?: "fourThree" | "portrait";
  expect: {
    outcome: K8Outcome;
    /** what a right result shows, said plainly for the judge (and for me) */
    spec: string;
    /** numbers that must be read in the tutor's additions (Solve's answer) */
    show?: string[];
    /** numbers that must NOT appear in the additions (Suggest and Feedback never give the answer away) */
    hide?: string[];
  };
};

/** Plain words for the hand engine: spaces kept, a hyphen not a minus. */
export const words = (t: string) => t.replace(/-/g, "\\text{-}").replace(/ /g, "\\ ");

const NOTE_SPEC = "a short note and an arrow pointing at the mistake; the corrected answer is NOT written";
const CHECK_SPEC = "the work is finished and right: nothing new is drawn and a checkmark is given";

export const K8_CASES: K8Case[] = [
  // ---------------------------------------------------------------- Solve (Draw now): the picture is the point
  { id: "solve-array", kind: "array", mode: "answer", source: "voice", lines: ["6 \\times 4 = ?", words("Draw it as an array")],
    expect: { outcome: "picture", spec: "an array of exactly 6 rows of 4 (or 4 rows of 6) equal dots or squares, and the answer 24", show: ["24"] } },
  { id: "solve-groups", kind: "equal groups", mode: "answer", source: "voice", lines: ["3 \\times 5 = ?", words("Show me equal groups")],
    expect: { outcome: "picture", spec: "exactly 3 circles (groups), each holding exactly 5 dots, and the answer 15", show: ["15"] } },
  { id: "solve-base10-add", kind: "base-ten add", mode: "answer", source: "voice", lines: ["47 + 38 = ?", words("Show me with base-ten blocks")],
    expect: { outcome: "picture", spec: "47 as exactly 4 tens rods and 7 unit cubes, 38 as exactly 3 tens rods and 8 unit cubes, (ten ones grouped into a new rod), and the answer 85 (8 tens and 5 ones)", show: ["85"] } },
  { id: "solve-base10-sub", kind: "base-ten subtract", mode: "answer", source: "voice", lines: ["52 - 17 = ?", words("Show me with base-ten blocks")],
    expect: { outcome: "picture", spec: "52 as exactly 5 tens rods and 2 unit cubes; one rod traded for 10 ones; 1 rod and 7 ones crossed out (taken away); the answer 35", show: ["35"] } },
  { id: "solve-area", kind: "area model", mode: "answer", source: "voice", lines: ["34 \\times 6 = ?", words("Use an area model")],
    expect: { outcome: "picture", spec: "a rectangle split into two parts labelled 30 and 4 along the top and 6 down the side, with 180 and 24 inside, and 180 + 24 = 204", show: ["204"] } },
  { id: "solve-bars-add", kind: "fraction bars add", mode: "answer", source: "voice", lines: ["\\frac{1}{2} + \\frac{1}{3} = ?", words("Show me with fraction bars")],
    expect: { outcome: "picture", spec: "equal-length bars in sixths: 1/2 = 3/6 with exactly 3 of 6 parts shaded, 1/3 = 2/6 with exactly 2 of 6 parts shaded, and the total 5/6 with exactly 5 of 6 parts shaded (shading clearly visible)", show: ["5", "6"] } },
  { id: "solve-bars-compare", kind: "fraction bars compare", mode: "answer", source: "voice", lines: [words("Which is bigger?") + "\\ \\frac{2}{3}\\ " + words("or") + "\\ \\frac{3}{5}", words("Show me with fraction bars")],
    expect: { outcome: "picture", spec: "two bars of the SAME length: one in 3 equal parts with exactly 2 shaded, one in 5 equal parts with exactly 3 shaded; says 2/3 is bigger", show: ["2", "3"] } },
  { id: "solve-pizza", kind: "pizza fraction", mode: "answer", source: "voice", lines: [words("Shade 3/8 of the pizza")],
    expect: { outcome: "picture", spec: "a circle cut into exactly 8 equal slices with exactly 3 slices clearly shaded (and 3/8 written)", show: ["3", "8"] } },
  { id: "solve-numberline-neg", kind: "number line (negatives)", mode: "answer", source: "voice", lines: ["-3 + 5 = ?", words("Use a number line")],
    expect: { outcome: "picture", spec: "a number line with ticks and labelled integers including -3 and 2 in the right order; start at -3, one jump (or 5 hops) of 5 to the RIGHT landing on 2; the answer 2", show: ["2"] } },
  { id: "solve-numberline-sub", kind: "number line (negatives)", mode: "answer", source: "voice", lines: ["-2 - 4 = ?", words("Use a number line")],
    expect: { outcome: "picture", spec: "a number line with labelled integers including -2 and -6 in the right order; start at -2, a jump (or 4 hops) of 4 to the LEFT landing on -6; the answer -6", show: ["6"] } },
  { id: "solve-tape", kind: "tape diagram ratio", mode: "answer", source: "voice", lines: [words("Red to blue is 2 : 3."), words("20 marbles in all. How many red?"), words("Draw a tape diagram")],
    expect: { outcome: "picture", spec: "a tape of exactly 5 equal boxes: 2 for red and 3 for blue, each box worth 4 (20 ÷ 5); red = 8 (and blue 12)", show: ["8"] } },
  { id: "solve-balance", kind: "balance equation", mode: "answer", source: "voice", lines: ["3x + 5 = 20", words("Show me with a balance")],
    expect: { outcome: "picture", spec: "a balance scale: left pan 3 x's and 5 ones, right pan 20; take 5 from both sides (3x = 15), split into 3 (x = 5)", show: ["5"] } },
  { id: "solve-pythag", kind: "right triangle", mode: "answer", source: "voice", lines: [words("A right triangle has legs 6 and 8."), words("How long is the longest side?")],
    expect: { outcome: "picture", spec: "a right triangle with a right-angle mark, legs labelled 6 and 8, and 6^2 + 8^2 = 36 + 64 = 100 so the hypotenuse is 10", show: ["10"] } },
  { id: "solve-rectangle", kind: "perimeter and area", mode: "answer", source: "voice", lines: [words("A rectangle is 7 cm by 4 cm."), words("Find its perimeter and area.")],
    expect: { outcome: "picture", spec: "a rectangle labelled 7 cm and 4 cm; perimeter 7 + 4 + 7 + 4 = 22 cm; area 7 × 4 = 28 square cm", show: ["22", "28"] } },

  // ---------------------------------------------------------------- Suggest (Draw now): a picture that starts it, never the answer
  { id: "suggest-array", kind: "array", mode: "suggest", source: "voice", lines: ["4 \\times 3 = ?", words("Draw it as an array")],
    expect: { outcome: "picture", spec: "a PICTURE (not words only): an array of exactly 4 rows of 3 dots (or 3 of 4), or its first rows with a hint to finish; the total 12 is NOT written", hide: ["12"] } },
  { id: "suggest-bars", kind: "fraction bars add", mode: "suggest", source: "voice", lines: ["\\frac{1}{4} + \\frac{1}{2} = ?", words("Show me with fraction bars")],
    expect: { outcome: "picture", spec: "a PICTURE: equal-length bars, one in 4 parts with exactly 1 shaded, one in 2 parts with exactly 1 shaded (or in 4 parts with 2 shaded) and a hint to combine them; 3/4 is NOT written", hide: ["3"] } },
  { id: "suggest-equation", kind: "two-step equation", mode: "suggest", source: "voice", lines: [words("Solve"), "3x + 5 = 20"],
    expect: { outcome: "picture", spec: "a hint for the next step only (take 5 from both sides / 3x = 15); x = 5 is NOT written", hide: ["5"] } },
  { id: "suggest-ladder", kind: "right triangle", mode: "suggest", source: "voice", lines: [words("A 10 ft ladder leans on a wall."), words("Its foot is 6 ft out."), words("How high does it reach?"), "a^{2} + b^{2} = c^{2}"],
    expect: { outcome: "picture", spec: "a hint only: the right triangle with the 10 (ladder, hypotenuse) and 6 (ground) placed right, and/or 6^2 + b^2 = 10^2; the height 8 is NOT written", hide: ["8"] } },

  // ---------------------------------------------------------------- Feedback (pen-lift): a planted slip
  { id: "feedback-base10", kind: "base-ten add", mode: "feedback", source: "auto", lines: ["47 + 38 = 75"],
    expect: { outcome: "note", spec: `${NOTE_SPEC}: the ones make 15, so a ten must be carried (75 should be 85)`, hide: ["85"] } },
  { id: "feedback-bars", kind: "fraction bars add", mode: "feedback", source: "auto", lines: ["\\frac{1}{2} + \\frac{1}{3} = \\frac{2}{5}"],
    expect: { outcome: "note", spec: `${NOTE_SPEC}: tops and bottoms were added; a common denominator is needed (5/6 is not written)`, hide: ["6"] } },
  { id: "feedback-area", kind: "area model", mode: "feedback", source: "auto", lines: ["34 \\times 6"],
    figs: [{ kind: "area", x: 90, y: 0, cols: [30, 4], row: 6, products: ["180", "24"] }, { kind: "text", x: 90, y: 300, latex: "180 + 24 = 194" }],
    expect: { outcome: "note", spec: `${NOTE_SPEC}: the area model is right but 180 + 24 was added wrong (194; it is 204)`, hide: ["204"] } },
  { id: "feedback-pizza", kind: "pizza fraction", mode: "feedback", source: "auto", lines: [words("Shade 3/8 of the pizza")],
    figs: [{ kind: "pie", x: 300, y: 200, r: 170, parts: 8, shaded: 4 }],
    expect: { outcome: "note", spec: `${NOTE_SPEC}: 4 slices are shaded, 3/8 needs 3` } },
  { id: "feedback-fixed-below", kind: "base-ten add", mode: "feedback", source: "auto", lines: ["47 + 38 = 75", "47 + 38 = 85"],
    expect: { outcome: "quiet", spec: "the kid fixed the slip on the line below (85 is right): nothing new is flagged; at most a checkmark — never a note on the right line" } },

  // ---------------------------------------------------------------- right work after an accepted picture (pen-lift, Suggest): a checkmark
  { id: "right-base10", kind: "base-ten add", mode: "suggest", source: "auto", lines: ["47 + 38 = ?", words("Show me with base-ten blocks")],
    figs: [{ kind: "baseTen", x: 90, y: 0, tens: 4, ones: 7, blue: true, label: "47" }, { kind: "baseTen", x: 520, y: 0, tens: 3, ones: 8, blue: true, label: "38" }, { kind: "text", x: 90, y: 390, latex: "47 + 38 = 85" }],
    expect: { outcome: "check", spec: CHECK_SPEC } },
  { id: "right-bars", kind: "fraction bars add", mode: "suggest", source: "auto", lines: ["\\frac{1}{2} + \\frac{1}{3} = ?", words("Show me with fraction bars")],
    figs: [{ kind: "bars", x: 90, y: 0, blue: true, bars: [{ parts: 6, shaded: 3, label: "\\frac{3}{6}" }, { parts: 6, shaded: 2, label: "\\frac{2}{6}" }, { parts: 6, shaded: 5, label: "\\frac{5}{6}" }] }, { kind: "text", x: 90, y: 500, latex: "\\frac{1}{2} + \\frac{1}{3} = \\frac{5}{6}" }],
    expect: { outcome: "check", spec: CHECK_SPEC } },
  { id: "right-area", kind: "area model", mode: "suggest", source: "auto", lines: ["34 \\times 6 = ?", words("Use an area model")],
    figs: [{ kind: "area", x: 90, y: 0, cols: [30, 4], row: 6, products: ["180", "24"], blue: true }, { kind: "text", x: 90, y: 300, latex: "180 + 24 = 204" }, { kind: "text", x: 90, y: 390, latex: "34 \\times 6 = 204" }],
    expect: { outcome: "check", spec: CHECK_SPEC } },
  { id: "right-equation", kind: "two-step equation", mode: "suggest", source: "auto", lines: [words("Solve"), "3x + 5 = 20"],
    figs: [{ kind: "text", x: 560, y: -95, latex: words("take 5 from both sides"), blue: true, size: 48 }, { kind: "text", x: 90, y: 0, latex: "3x = 15" }, { kind: "text", x: 90, y: 100, latex: "x = 5" }],
    expect: { outcome: "check", spec: CHECK_SPEC } },
  { id: "right-numberline", kind: "number line (negatives)", mode: "suggest", source: "auto", lines: ["-3 + 5 = ?", words("Use a number line")],
    figs: [{ kind: "numberLine", x: 90, y: 170, from: -5, to: 5, jump: [-3, 2] }, { kind: "text", x: 90, y: 300, latex: "-3 + 5 = 2" }],
    expect: { outcome: "check", spec: CHECK_SPEC } },
];

// ------------------------------------------------------------------------------------------ the board

const W = 1440;
const H = 1080;
const LH = 64;
const INK = "#1d1d1f";
const BLUE = "#2D5BFF";

type Pt = { x: number; y: number };

/** A hand-drawn line: a few wobbly points between a and b. */
function wobbly(a: Pt, b: Pt, rand: () => number, amp = 1.6): string {
  const n = Math.max(2, Math.round(Math.hypot(b.x - a.x, b.y - a.y) / 40));
  const pts: string[] = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const j = i === 0 || i === n ? 0.5 : 1;
    pts.push(`${(a.x + (b.x - a.x) * t + (rand() - 0.5) * amp * 2 * j).toFixed(1)} ${(a.y + (b.y - a.y) * t + (rand() - 0.5) * amp * 2 * j).toFixed(1)}`);
  }
  return `M${pts.join(" L")}`;
}

function rect(x: number, y: number, w: number, h: number, rand: () => number): string {
  return [wobbly({ x, y }, { x: x + w, y }, rand), wobbly({ x: x + w, y }, { x: x + w, y: y + h }, rand), wobbly({ x: x + w, y: y + h }, { x, y: y + h }, rand), wobbly({ x, y: y + h }, { x, y }, rand)].join(" ");
}

/** Diagonal hatching inside a box (how a kid shades). */
function hatch(x: number, y: number, w: number, h: number, rand: () => number, step = 9): string {
  const out: string[] = [];
  for (let k = step / 2; k < w + h; k += step) {
    const a = { x: x + Math.max(0, k - h), y: y + Math.min(h, k) };
    const b = { x: x + Math.min(w, k), y: y + Math.max(0, k - w) };
    out.push(wobbly(a, b, rand, 0.8));
  }
  return out.join(" ");
}

function handAt(latex: string, x: number, y: number, size: number, seed: number, colour: string, pen: number): string {
  if (!latex) return "";
  const ink = handLine(latex, "messy", size, seed);
  return ink.paths
    .map((p) => `<path d="${p.length === 1 ? `M${(p[0].x + x).toFixed(1)} ${(p[0].y + y).toFixed(1)} l0.1 0` : "M" + p.map((q) => `${(q.x + x).toFixed(1)} ${(q.y + y).toFixed(1)}`).join(" L")}" stroke="${colour}" stroke-width="${pen}" fill="none" stroke-linecap="round" stroke-linejoin="round"/>`)
    .join("");
}

function figSvg(f: Fig, seed: number): string {
  const rand = mulberry32(seed);
  const colour = "blue" in f && f.blue ? BLUE : INK;
  const pen = 4;
  const path = (d: string, w = pen, fill = "none") => `<path d="${d}" stroke="${colour}" stroke-width="${w}" fill="${fill}" stroke-linecap="round" stroke-linejoin="round"/>`;
  switch (f.kind) {
    case "text":
      return handAt(f.latex, f.x, f.y, f.size ?? LH, seed, colour, pen);
    case "baseTen": {
      const u = 22;
      let d = "";
      for (let i = 0; i < f.tens; i++) d += rect(f.x + i * (u + 12), f.y, u, u * 10, rand) + " ";
      const ox = f.x + f.tens * (u + 12) + 16;
      for (let i = 0; i < f.ones; i++) d += rect(ox + (i % 2) * (u + 8), f.y + Math.floor(i / 2) * (u + 8), u, u, rand) + " ";
      return path(d) + (f.label ? handAt(f.label, f.x, f.y + u * 10 + 24, LH, seed + 1, colour, pen) : "");
    }
    case "bars": {
      const w = f.w ?? 600;
      const h = 70;
      let out = "";
      f.bars.forEach((b, k) => {
        const y = f.y + k * (h + 90);
        const cw = w / b.parts;
        let d = rect(f.x, y, w, h, rand) + " ";
        for (let i = 1; i < b.parts; i++) d += wobbly({ x: f.x + i * cw, y }, { x: f.x + i * cw, y: y + h }, rand) + " ";
        for (let i = 0; i < b.shaded; i++) d += hatch(f.x + i * cw + 3, y + 3, cw - 6, h - 6, rand) + " ";
        out += path(d, 3.5);
        if (b.label) out += handAt(b.label, f.x + w + 30, y - 4, LH * 0.9, seed + 7 + k, colour, pen);
      });
      return out;
    }
    case "pie": {
      let d = "";
      const n = 48;
      const circ: Pt[] = [];
      for (let i = 0; i <= n; i++) circ.push({ x: f.x + Math.cos((i / n) * 2 * Math.PI) * f.r + (rand() - 0.5) * 3, y: f.y + Math.sin((i / n) * 2 * Math.PI) * f.r + (rand() - 0.5) * 3 });
      d += "M" + circ.map((p) => `${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(" L") + " ";
      for (let i = 0; i < f.parts; i++) {
        const a = -Math.PI / 2 + (i / f.parts) * 2 * Math.PI;
        d += wobbly({ x: f.x, y: f.y }, { x: f.x + Math.cos(a) * f.r, y: f.y + Math.sin(a) * f.r }, rand) + " ";
      }
      // shading: close strokes across each shaded slice (arcs, the way a kid colours a wedge in)
      for (let i = 0; i < f.shaded; i++) {
        const a0 = -Math.PI / 2 + (i / f.parts) * 2 * Math.PI + 0.04;
        const a1 = a0 + (2 * Math.PI) / f.parts - 0.08;
        for (let rr = f.r * 0.12; rr < f.r * 0.95; rr += 9) {
          const p0 = { x: f.x + Math.cos(a0) * rr, y: f.y + Math.sin(a0) * rr };
          const p1 = { x: f.x + Math.cos(a1) * rr, y: f.y + Math.sin(a1) * rr };
          d += `M${p0.x.toFixed(1)} ${p0.y.toFixed(1)} A${rr.toFixed(1)} ${rr.toFixed(1)} 0 0 1 ${p1.x.toFixed(1)} ${p1.y.toFixed(1)} `;
        }
      }
      return path(d, 3.5);
    }
    case "array": {
      let out = "";
      for (let r = 0; r < f.rows; r++) for (let c = 0; c < f.cols; c++) out += `<circle cx="${f.x + c * 46 + (rand() - 0.5) * 4}" cy="${f.y + r * 46 + (rand() - 0.5) * 4}" r="11" fill="${colour}"/>`;
      return out;
    }
    case "numberLine": {
      const len = 900;
      const step = len / (f.to - f.from);
      let d = wobbly({ x: f.x, y: f.y }, { x: f.x + len, y: f.y }, rand, 1.2) + " ";
      let labels = "";
      for (let v = f.from; v <= f.to; v++) {
        const x = f.x + (v - f.from) * step;
        d += wobbly({ x, y: f.y - 12 }, { x, y: f.y + 12 }, rand, 0.6) + " ";
        labels += handAt(String(v), x - (v < 0 ? 22 : 10), f.y + 24, LH * 0.7, seed + 30 + v, colour, 3.2);
      }
      if (f.jump) {
        const xa = f.x + (f.jump[0] - f.from) * step;
        const xb = f.x + (f.jump[1] - f.from) * step;
        const mid = (xa + xb) / 2;
        d += `M${xa} ${f.y - 16} Q${mid} ${f.y - 150} ${xb} ${f.y - 16} `;
        const dir = xb > xa ? -1 : 1;
        d += `M${xb} ${f.y - 16} L${xb + dir * 16} ${f.y - 32} M${xb} ${f.y - 16} L${xb + dir * 20} ${f.y - 10}`;
      }
      return path(d) + labels;
    }
    case "area": {
      const h = 180;
      const total = f.cols.reduce((a, b) => a + b, 0);
      const widths = f.cols.map((c) => Math.max(110, (c / total) * 520));
      const w = widths.reduce((a, b) => a + b, 0);
      let d = rect(f.x + 50, f.y + 60, w, h, rand) + " ";
      let x = f.x + 50;
      let labels = "";
      f.cols.forEach((c, i) => {
        labels += handAt(String(c), x + widths[i] / 2 - 20, f.y, LH * 0.85, seed + 40 + i, colour, pen);
        if (f.products?.[i]) labels += handAt(f.products[i], x + widths[i] / 2 - 34, f.y + 60 + h / 2 - 22, LH * 0.85, seed + 50 + i, colour, pen);
        x += widths[i];
        if (i < f.cols.length - 1) d += wobbly({ x, y: f.y + 60 }, { x, y: f.y + 60 + h }, rand) + " ";
      });
      labels += handAt(String(f.row), f.x, f.y + 60 + h / 2 - 22, LH * 0.85, seed + 60, colour, pen);
      return path(d) + labels;
    }
  }
}

export type K8Board = { png: Buffer; width: number; height: number };

/** The case's board as the PNG the iPad sends: the kid's lines top left, then what is already drawn. */
export async function renderK8Board(c: K8Case): Promise<K8Board> {
  const seed = [...c.id].reduce((n, ch) => (n * 31 + ch.charCodeAt(0)) >>> 0, 11);
  const w = c.frame === "portrait" ? 1080 : W;
  const h = c.frame === "portrait" ? 1440 : H;
  let body = "";
  let y = 60;
  c.lines.forEach((l, i) => {
    body += handAt(l, 90, y, LH, seed + i * 13, INK, 4);
    y += LH * (/\\frac/.test(l) ? 2.2 : 1.6);
  });
  // what is already drawn sits below the kid's lines: a figure's y is measured from there
  const below = y + 20;
  for (const [i, f] of (c.figs ?? []).entries()) body += figSvg({ ...f, y: f.y + below }, seed + 100 + i * 17);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}"><rect width="100%" height="100%" fill="#ffffff"/>${body}</svg>`;
  return { png: await sharp(Buffer.from(svg)).png().toBuffer(), width: w, height: h };
}
