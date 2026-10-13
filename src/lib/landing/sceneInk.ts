/**
 * Real ink on the hero painting's blank tablet (v4). The painted screen is turned toward the boy and
 * leans back, so the board's writing is laid out on a flat screen (an iPad's, landscape, `SCREEN`)
 * and then taken onto the painted one by the projective transform (homography) that maps the flat
 * screen's corners to the painting's (heroScene.ts `board`).
 *
 * The ink itself is projected, point by point, here on the server: the hand engine's strokes and the
 * tutor's check are polylines, and a projective transform keeps straight lines straight, so the
 * projected polyline is exact. Each stroke's pen is scaled by how much the transform shrinks it where
 * it lies. The page gets one static SVG in the painting's own pixels, drawn over it: no CSS 3D, which
 * some renderers flatten (headless WebKit drops perspective entirely, measured 2026-10-13).
 *
 * The pen tip, measured in the painting, is taken back onto the flat screen with the inverse, so the
 * line can start just right of his stylus: his hand covers the screen's left edge between the pen
 * tip and the bottom-left corner.
 *
 * Pure: no React, no DOM.
 */
import { BOARD_LINES } from "./boardInk";
import { handInk } from "./handInk";
import type { SceneBoard, ScenePoint } from "./heroScene";
import { pathBounds } from "./replay";

/** The flat screen, in its own px: a landscape iPad's 4:3. */
export const SCREEN = { width: 1000, height: 750 } as const;

/** A 3 × 3 projective matrix, row by row, its last entry 1. */
export type Homography = readonly [number, number, number, number, number, number, number, number, number];

/** Where `h` takes a point. */
export function project(h: Homography, p: ScenePoint): ScenePoint {
  const w = h[6] * p.x + h[7] * p.y + h[8];
  return { x: (h[0] * p.x + h[1] * p.y + h[2]) / w, y: (h[3] * p.x + h[4] * p.y + h[5]) / w };
}

/** Solves a square linear system by Gaussian elimination with partial pivoting. */
function solve(a: number[][], b: number[]): number[] {
  const n = b.length;
  const m = a.map((row, i) => [...row, b[i]]);
  for (let col = 0; col < n; col++) {
    let pivot = col;
    for (let r = col + 1; r < n; r++) if (Math.abs(m[r][col]) > Math.abs(m[pivot][col])) pivot = r;
    if (Math.abs(m[pivot][col]) < 1e-12) throw new Error("sceneInk: the four corners do not make a quadrilateral");
    [m[col], m[pivot]] = [m[pivot], m[col]];
    for (let r = 0; r < n; r++) {
      if (r === col) continue;
      const f = m[r][col] / m[col][col];
      for (let c = col; c <= n; c++) m[r][c] -= f * m[col][c];
    }
  }
  return m.map((row, i) => row[n] / row[i]);
}

/** The homography taking `from[i]` to `to[i]`, for four points each (no three in a line). */
export function homography(from: readonly ScenePoint[], to: readonly ScenePoint[]): Homography {
  const a: number[][] = [];
  const b: number[] = [];
  for (let i = 0; i < 4; i++) {
    const { x, y } = from[i];
    const { x: u, y: v } = to[i];
    a.push([x, y, 1, 0, 0, 0, -x * u, -y * u]);
    b.push(u);
    a.push([0, 0, 0, x, y, 1, -x * v, -y * v]);
    b.push(v);
  }
  const [h0, h1, h2, h3, h4, h5, h6, h7] = solve(a, b);
  return [h0, h1, h2, h3, h4, h5, h6, h7, 1];
}

/** The inverse of a homography, scaled so its last entry is 1. */
export function invert(h: Homography): Homography {
  const [a, b, c, d, e, f, g, k, i] = h;
  const A = e * i - f * k;
  const B = -(d * i - f * g);
  const C = d * k - e * g;
  const det = a * A + b * B + c * C;
  const inv = [A, -(b * i - c * k), b * f - c * e, B, a * i - c * g, -(a * f - c * d), C, -(a * k - b * g), a * e - b * d].map((v) => v / det);
  return inv.map((v) => v / inv[8]) as unknown as Homography;
}

/** How much `h` scales lengths near `p` (the square root of its local area change). */
export function localScale(h: Homography, p: ScenePoint): number {
  const o = project(h, p);
  const dx = project(h, { x: p.x + 1, y: p.y });
  const dy = project(h, { x: p.x, y: p.y + 1 });
  return Math.sqrt(Math.abs((dx.x - o.x) * (dy.y - o.y) - (dx.y - o.y) * (dy.x - o.x)));
}

/** The flat screen's homography onto a painted `board` (corners clockwise from top-left). */
export function screenHomography(board: SceneBoard): Homography {
  const { width: w, height: h } = SCREEN;
  return homography(
    [
      { x: 0, y: 0 },
      { x: w, y: 0 },
      { x: w, y: h },
      { x: 0, y: h },
    ],
    [board.tl, board.tr, board.br, board.bl],
  );
}

/** The points of an absolute "M x y L x y …" polyline path (the hand engine's, the board's ticks). */
export function polylinePoints(d: string): ScenePoint[] {
  const points: ScenePoint[] = [];
  const re = /([A-Za-z])\s*(-?[\d.]+)[\s,]+(-?[\d.]+)/g;
  for (let m = re.exec(d); m; m = re.exec(d)) {
    if (m[1] !== "M" && m[1] !== "L") throw new Error(`sceneInk: only M and L can be projected, not ${m[1]}`);
    points.push({ x: Number(m[2]), y: Number(m[3]) });
  }
  return points;
}

/** One stroke of ink on the painting, in its px: the path, its pen, whose pen, and when it draws. */
export interface PaintedStroke {
  d: string;
  /** pen width in the painting's px */
  width: number;
  ink: "kid" | "tutor";
  atMs: number;
  forMs: number;
}

export interface PaintedLine {
  /** LaTeX, written in the board's hand in the kid's pen */
  latex: string;
  /** the hand's cap height on the flat screen, in its px */
  size: number;
  seed: number;
  /** ms from the line's start in view to its first stroke */
  startMs: number;
}

/** The tutor's tick, as the board's live tutor drew it (InkMark's InkCheck). */
const TICK = BOARD_LINES.find((l) => l.mark.kind === "tick")!.mark.stroke.d;

const round1 = (n: number) => Math.round(n * 10) / 10;
const toD = (points: readonly ScenePoint[]) => points.map((p, i) => `${i === 0 ? "M" : "L"}${round1(p.x)} ${round1(p.y)}`).join("");

/**
 * The line the boy has written on the painted tablet, and the tutor's check after it, projected onto
 * the painting (its px): the line starts just right of the pen tip, its baseline a little above it.
 */
export function paintedInk(board: SceneBoard, penTip: ScenePoint, line: PaintedLine): { strokes: PaintedStroke[]; tip: ScenePoint } {
  const h = screenHomography(board);
  const tip = project(invert(h), penTip);
  const hand = handInk(line.latex, { size: line.size, seed: line.seed });
  const pen = line.size / 9;
  const left = tip.x + 34;
  const top = tip.y - line.size * 1.4;
  const strokes: PaintedStroke[] = [];
  const place = (points: readonly ScenePoint[], flatPen: number, ink: PaintedStroke["ink"], atMs: number, forMs: number) => {
    const mid = points[Math.floor(points.length / 2)];
    strokes.push({ d: toD(points.map((p) => project(h, p))), width: Math.round(flatPen * localScale(h, mid) * 100) / 100, ink, atMs, forMs });
  };
  for (const s of hand.strokes) {
    place(
      polylinePoints(s.d).map((p) => ({ x: left + p.x, y: top + p.y })),
      pen * s.weight,
      "kid",
      line.startMs + s.atMs,
      s.forMs,
    );
  }
  // the check, a little smaller than the line's digits are tall, after it and down to its baseline
  const b = pathBounds(TICK);
  const box = line.size * 1.05;
  const k = box / Math.max(b.maxX - b.minX, b.maxY - b.minY);
  const x0 = left + hand.width + line.size * 0.22;
  const y1 = top + hand.baseline + line.size * 0.02;
  place(
    polylinePoints(TICK).map((p) => ({ x: x0 + (p.x - b.minX) * k, y: y1 - (b.maxY - p.y) * k })),
    box / 9,
    "tutor",
    line.startMs + hand.durationMs + 260,
    300,
  );
  return { strokes, tip };
}

/** The box all the strokes lie in, pens included, in the painting's px (whole pixels, outward). */
export function inkBounds(strokes: readonly PaintedStroke[]): { x: number; y: number; width: number; height: number } {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const s of strokes) {
    for (const p of polylinePoints(s.d)) {
      minX = Math.min(minX, p.x - s.width);
      minY = Math.min(minY, p.y - s.width);
      maxX = Math.max(maxX, p.x + s.width);
      maxY = Math.max(maxY, p.y + s.width);
    }
  }
  const x = Math.floor(minX);
  const y = Math.floor(minY);
  return { x, y, width: Math.ceil(maxX) - x, height: Math.ceil(maxY) - y };
}
