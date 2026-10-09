import type { TLDrawShape, TLShapeId } from "tldraw";
import type { InkStroke } from "../contracts";
import { drawShapeFromPoints, nextShapeId } from "./strokes";

/**
 * A young student's handwriting on an iPad (the board fitted at ~0.5, so page px are twice screen
 * px): digits ~100 page px tall, an `=` of two wobbly bars ~40 px apart (the top one rising to the
 * right), a `9` as a loop and a long stem, an `11` as two slanting strokes, ticks of her own drawn
 * from the top of the long arm DOWN and then up the short one, and taps of the pen. Synthetic —
 * shaped after a real board (2026-10-06, "Addition practice", Brave on an iPad), never its strokes.
 */

export type Pt = { x: number; y: number };

function steps(a: Pt, b: Pt, n: number): Pt[] {
  return Array.from({ length: n + 1 }, (_, i) => ({ x: a.x + ((b.x - a.x) * i) / n, y: a.y + ((b.y - a.y) * i) / n }));
}

export const youngGlyphs = {
  /** a bar `w` long from (x, y): `bow` > 0 sags in the middle (a smile), < 0 bulges (a frown); `rise` lifts its right end */
  bar(x: number, y: number, w: number, bow = 0, rise = 0): Pt[] {
    return Array.from({ length: 12 }, (_, i) => {
      const t = i / 11;
      return { x: x + w * t, y: y - rise * t + bow * 4 * t * (1 - t) };
    });
  },
  /** an `=` as a young hand writes it: the top bar rising, the bottom one flatter and `gap` lower */
  equals(x: number, y: number, o: { w?: number; gap?: number; bowTop?: number; bowBottom?: number; rise?: number } = {}): Pt[][] {
    const w = o.w ?? 55;
    return [youngGlyphs.bar(x, y, w, o.bowTop ?? 4, o.rise ?? 12), youngGlyphs.bar(x + 8, y + (o.gap ?? 40), w - 5, o.bowBottom ?? -2)];
  },
  seven(x: number, y: number, h: number): Pt[][] {
    return [[...steps({ x, y: y + 4 }, { x: x + h * 0.55, y }, 6), ...steps({ x: x + h * 0.55, y }, { x: x + h * 0.2, y: y + h }, 10)]];
  },
  one(x: number, y: number, h: number): Pt[][] {
    return [steps({ x, y }, { x: x + h * 0.15, y: y + h }, 10)];
  },
  /** a loop, then a long stem down its right side */
  nine(x: number, y: number, h: number): Pt[][] {
    const r = h * 0.22;
    const cx = x + r;
    const cy = y + r;
    const loop = Array.from({ length: 20 }, (_, i) => {
      const a = -0.3 + (i / 19) * Math.PI * 2;
      return { x: cx + r * Math.cos(a), y: cy + r * Math.sin(a) };
    });
    return [loop, steps({ x: cx + r, y }, { x: cx + r + h * 0.1, y: y + h }, 10)];
  },
  /** her own tick, `s` across: from the top of the long right arm down to the corner, then up the short left one */
  tick(x: number, y: number, s: number): Pt[][] {
    return [[...steps({ x: x + s, y }, { x: x + s * 0.4, y: y + s * 0.8 }, 10), ...steps({ x: x + s * 0.4, y: y + s * 0.8 }, { x, y: y + s * 0.4 }, 6)]];
  },
  /** a tap of the pen: one point */
  dot(x: number, y: number): Pt[][] {
    return [[{ x, y }]];
  },
  /** a minus: one nearly flat bar `w` long, a little lower at its right end */
  minus(x: number, y: number, w: number): Pt[][] {
    return [youngGlyphs.bar(x, y, w, 1, -3)];
  },
  /** a wavy bar (one bar of a wobbly `=`) */
  wave(x: number, y: number, w: number, a = 5): Pt[][] {
    return [Array.from({ length: 16 }, (_, i) => ({ x: x + (w * i) / 15, y: y + a * Math.sin((i / 15) * Math.PI * 2) }))];
  },
  /** an oval, `h` tall, drawn round from the top */
  zero(x: number, y: number, h: number): Pt[][] {
    const rx = h * 0.42;
    const ry = h / 2;
    return [Array.from({ length: 24 }, (_, i) => ({ x: x + rx + rx * Math.sin((i / 23) * Math.PI * 2.05), y: y + ry - ry * Math.cos((i / 23) * Math.PI * 2.05) }))];
  },
  /** two bumps on the right, one under the other */
  three(x: number, y: number, h: number): Pt[][] {
    const r = h / 4;
    const w = h * 0.7;
    const bump = (cy: number, from: number, to: number) =>
      Array.from({ length: 10 }, (_, i) => {
        const a = from + ((to - from) * i) / 9;
        return { x: x + w / 2 + (w / 2) * Math.cos(a), y: cy + r * Math.sin(a) };
      });
    return [[...bump(y + r, -Math.PI * 0.9, Math.PI / 2), ...bump(y + 3 * r, -Math.PI / 2, Math.PI * 0.9)]];
  },
  /** a flag, a stem down, and a belly round to the left */
  five(x: number, y: number, h: number): Pt[][] {
    const w = h * 0.7;
    const belly = Array.from({ length: 12 }, (_, i) => {
      const a = -Math.PI * 0.6 + (Math.PI * 1.5 * i) / 11;
      return { x: x + w * 0.45 + w * 0.5 * Math.cos(a), y: y + h * 0.68 + h * 0.3 * Math.sin(a) };
    });
    return [[...steps({ x: x + w, y }, { x: x + w * 0.1, y }, 6), ...steps({ x: x + w * 0.1, y }, { x: x + w * 0.05, y: y + h * 0.42 }, 4), ...belly]];
  },
  /** a 4 in one stroke (down-left, across) and its long stem */
  four(x: number, y: number, h: number): Pt[][] {
    const w = h * 0.75;
    return [
      [...steps({ x: x + w * 0.45, y: y + h * 0.05 }, { x, y: y + h * 0.55 }, 8), ...steps({ x, y: y + h * 0.55 }, { x: x + w, y: y + h * 0.5 }, 8)],
      steps({ x: x + w * 0.62, y }, { x: x + w * 0.6, y: y + h * 1.1 }, 10),
    ];
  },
};

/**
 * An answer as a young student writes it, left to right from (x, y): `=`, `-`, digits `0` `1` `3` `4`
 * `5` `7` `9`, a space, `✓` (her own tick) and `.` (a tap). Strokes, in the order she writes them.
 */
export function youngLine(text: string, x: number, y: number, h = 100): Pt[][] {
  const out: Pt[][] = [];
  let cx = x;
  for (const ch of text) {
    switch (ch) {
      case "=":
        out.push(...youngGlyphs.equals(cx, y + h * 0.3));
        cx += 80;
        break;
      case "1":
        out.push(...youngGlyphs.one(cx, y, h * 1.1));
        cx += 40;
        break;
      case "7":
        out.push(...youngGlyphs.seven(cx, y, h));
        cx += h * 0.55 + 25;
        break;
      case "9":
        out.push(...youngGlyphs.nine(cx, y, h * 0.85));
        cx += h * 0.55 + 25;
        break;
      case "-":
        out.push(...youngGlyphs.minus(cx, y + h * 0.5, 60));
        cx += 85;
        break;
      case "0":
        out.push(...youngGlyphs.zero(cx, y + h * 0.3, h * 0.7));
        cx += h * 0.6 + 25;
        break;
      case "3":
        out.push(...youngGlyphs.three(cx, y, h * 0.85));
        cx += h * 0.6 + 25;
        break;
      case "5":
        out.push(...youngGlyphs.five(cx, y, h));
        cx += h * 0.7 + 25;
        break;
      case "4":
        out.push(...youngGlyphs.four(cx, y, h));
        cx += h * 0.75 + 25;
        break;
      case "✓":
        out.push(...youngGlyphs.tick(cx, y, h * 0.95));
        cx += h + 20;
        break;
      case ".":
        out.push(...youngGlyphs.dot(cx, y + h * 0.5));
        cx += 12;
        break;
      case " ":
        cx += 30;
        break;
      default:
        throw new Error(`no young glyph for '${ch}'`);
    }
  }
  return out;
}

/** Where the tutor's problem is: its ink's left, top and right edges. */
export interface HeadAt {
  x: number;
  y: number;
  r: number;
}

/**
 * Negative answers on an iPad, as in two photos of a real board (2026-10-08): the tutor's
 * `1. -3 - 7`, `2. (-4)(-3)`, `3. -12 + 9`, `4. (-6) × (-9)` in a 2 × 2 grid (`heads`, by problem), and
 * the child's answers measured off the photos in page px (the board fitted at ~0.5):
 *
 *  - `one`: `= - 10` beside problem 1, an `=` of a 91 px bar over a 59 px one, 126 px to a minus, 80 px
 *    to a 115 px `1`, then a `0` ending 29 px before problem 2's number;
 *  - `two`: a lone minus under problem 2, an answer just started;
 *  - `three`: `= -3` beside problem 3, a short bar over a longer one, a minus level with the lower bar
 *    67 px further on, a `3` against the minus;
 *  - `four`: a wobbly `= 54` under problem 4, a wave with a bar half over it, a `5` and a long-stemmed `4`.
 */
export function negativeAnswers(heads: readonly HeadAt[]) {
  const [p1, p2, p3, p4] = heads;
  const g = youngGlyphs;
  const zeroX = p2.x - 29 - 63;
  const oneX = zeroX - 64;
  const minusX = oneX - 146;
  const eqX = minusX - 217;
  const x3 = p3.r + 24;
  return {
    one: {
      eq: [g.bar(eqX, p1.y, 91, 0, 4), g.bar(eqX, p1.y + 29, 59, 4)],
      minus: g.minus(minusX, p1.y + 38, 66),
      ten: [...g.one(oneX, p1.y - 14, 115), ...g.zero(zeroX, p1.y + 18, 71)],
      /** a point on its `=` */
      at: { x: eqX + 20, y: p1.y + 30 },
    },
    two: { minus: g.minus(p2.x + 52, p2.y + 66, 48), at: { x: p2.x + 70, y: p2.y + 66 } },
    three: {
      eq: [g.bar(x3 + 19, p3.y - 1, 40, 2, 4), g.bar(x3, p3.y + 22, 55, -2)],
      minus: g.minus(x3 + 126, p3.y + 18, 59),
      three: g.three(x3 + 185, p3.y - 29, 83),
      at: { x: x3 + 20, y: p3.y + 22 },
    },
    four: {
      eq: [...g.wave(p4.x + 57, p4.y + 101, 61, 8), g.bar(p4.x + 92, p4.y + 83, 65, 1, 4)],
      digits: [...g.five(p4.x + 187, p4.y + 53, 118), ...g.four(p4.x + 322, p4.y + 84, 138)],
      at: { x: p4.x + 100, y: p4.y + 90 },
    },
  };
}

/** The heads of the photographed board, in page px (problem 1, 2, 3, 4). */
export const PHOTO_HEADS: readonly HeadAt[] = [
  { x: 62, y: 86, r: 204 },
  { x: 814, y: 86, r: 1000 },
  { x: 62, y: 486, r: 236 },
  { x: 814, y: 486, r: 1040 },
];

let n = 0;

/**
 * Strokes as tldraw sees them (`getShapePageBounds`): a stroke whose points all fit inside the pen's
 * width is drawn as a dot, a circle of the pen's width — 9 page px for the board's pen (size `m`).
 */
export function youngInk(strokes: readonly Pt[][], ids?: readonly TLShapeId[]): InkStroke[] {
  return strokes.map((pts, i) => {
    const xs = pts.map((p) => p.x);
    const ys = pts.map((p) => p.y);
    let bounds = { x: Math.min(...xs), y: Math.min(...ys), w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys) };
    if (bounds.w < 9 && bounds.h < 9) bounds = { x: pts[0].x - 4.5, y: pts[0].y - 4.5, w: 9, h: 9 };
    return { id: ids?.[i] ?? (`shape:young_${++n}` as TLShapeId), bounds, segments: [pts.map((p) => ({ ...p }))] };
  });
}

/** The same strokes as the student's draw shapes (for a loop on the fake editor). */
export function youngShapes(strokes: readonly Pt[][]): TLDrawShape[] {
  return strokes.map((pts) => drawShapeFromPoints(pts.length === 1 ? [pts[0], { x: pts[0].x + 0.5, y: pts[0].y }] : pts, nextShapeId("young")));
}
