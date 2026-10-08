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
};

/**
 * An answer as a young student writes it, left to right from (x, y): `=`, digits `1` `7` `9`, a space,
 * `✓` (her own tick) and `.` (a tap). Strokes, in the order she writes them.
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
