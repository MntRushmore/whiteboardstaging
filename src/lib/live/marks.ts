import type { Rect } from "./contracts";
import type { Stroke } from "@/lib/hand";

/**
 * The tutor's marks: a tick after a right line, a ring around a wrong one, a question mark
 * beside ink it could not read. Drawn in the same hand and the same blue as the tutor's
 * writing — never a card, never a sentence.
 *
 * Pure geometry: strokes in page coordinates with a little seeded wobble, so two ticks never
 * look stamped. `markStrokes` output goes through `planFromStrokes` (handwriting.ts) to be
 * revealed by the HandWriter like any other line the tutor writes.
 */

export type MarkKind = "check" | "circle" | "question";

export const MARKS = {
  /** gap between the student's ink and a tick / question mark */
  gap: 18,
  /** tick height as a fraction of the line's ink height, clamped */
  checkFactor: 0.8,
  checkMin: 18,
  checkMax: 44,
  /** ring padding around the wrong line */
  ringPadX: 14,
  ringPadY: 10,
} as const;

/** Small deterministic PRNG (mulberry32) so a re-render draws the same mark. */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

type Pt = { x: number; y: number; z: number };

function polyline(points: Array<[number, number]>, jitter: () => number, amount: number): Pt[] {
  return points.map(([x, y], i) => ({
    x: x + (jitter() - 0.5) * amount,
    y: y + (jitter() - 0.5) * amount,
    z: 0.5 + 0.1 * Math.sin(i / 3),
  }));
}

function stroke(points: Pt[], order: number): Stroke {
  return { points, order, kind: "glyph" };
}

/**
 * The ring's radii. An ellipse through the corners of the ink box has radii √2 × the
 * half-sizes: anything smaller cuts through the first and last glyph (the `1` of `x = 1`).
 */
export function ringRadii(line: Rect): { rx: number; ry: number } {
  return { rx: (line.w / 2) * Math.SQRT2 + MARKS.ringPadX / 2, ry: (line.h / 2) * Math.SQRT2 + MARKS.ringPadY / 2 };
}

/** The box the ring round `line` takes up (for placing anything beside it). */
export function ringRect(line: Rect): Rect {
  const { rx, ry } = ringRadii(line);
  const cx = line.x + line.w / 2;
  const cy = line.y + line.h / 2;
  return { x: cx - rx, y: cy - ry, w: rx * 2, h: ry * 2 };
}

/** Where a tick / question mark sits: after the ink, centred on it. */
export function markAnchor(line: Rect): { x: number; y: number; h: number } {
  const h = Math.min(MARKS.checkMax, Math.max(MARKS.checkMin, line.h * MARKS.checkFactor));
  return { x: line.x + line.w + MARKS.gap, y: line.y + line.h / 2 - h / 2, h };
}

/** The mark's strokes for a line with these page bounds. */
export function markStrokes(kind: MarkKind, line: Rect, seed: number): Stroke[] {
  const j = rng(seed);
  if (kind === "circle") {
    // An open-ended ring, drawn the way a teacher does: starting top-left, a little past
    // where it started, slightly tilted.
    const cx = line.x + line.w / 2;
    const cy = line.y + line.h / 2;
    const { rx, ry } = ringRadii(line);
    const tilt = (j() - 0.5) * 0.06;
    const start = Math.PI * 1.08;
    const sweep = Math.PI * 2.12;
    const n = 48;
    const pts: Array<[number, number]> = [];
    for (let i = 0; i <= n; i++) {
      const t = start + (sweep * i) / n;
      const wob = 1 + (j() - 0.5) * 0.03;
      const x = rx * wob * Math.cos(t);
      const y = ry * wob * Math.sin(t);
      pts.push([cx + x * Math.cos(tilt) - y * Math.sin(tilt), cy + x * Math.sin(tilt) + y * Math.cos(tilt)]);
    }
    return [stroke(polyline(pts, j, 1.2), 0)];
  }

  const a = markAnchor(line);
  const w = a.h * (kind === "check" ? 0.9 : 0.55);
  if (kind === "check") {
    const pts: Array<[number, number]> = [
      [a.x, a.y + a.h * 0.55],
      [a.x + w * 0.18, a.y + a.h * 0.72],
      [a.x + w * 0.36, a.y + a.h * 0.95],
      [a.x + w * 0.6, a.y + a.h * 0.55],
      [a.x + w * 0.82, a.y + a.h * 0.22],
      [a.x + w, a.y],
    ];
    return [stroke(polyline(pts, j, 1), 0)];
  }

  // question mark: a hook, then a dot
  const hook: Array<[number, number]> = [];
  const r = w / 2;
  const cx = a.x + r;
  const cy = a.y + r;
  for (let i = 0; i <= 14; i++) {
    const t = Math.PI * (1.1 - (i / 14) * 1.55);
    hook.push([cx + r * Math.cos(t), cy - r * Math.sin(t)]);
  }
  hook.push([cx, a.y + a.h * 0.7]);
  const dotY = a.y + a.h * 0.95;
  return [
    stroke(polyline(hook, j, 0.8), 0),
    stroke(polyline([[cx, dotY], [cx + 0.5, dotY + 1]], j, 0.2), 1),
  ];
}

/** Stable key: a mark is redrawn only when its kind or its line's place changes. */
export function markKey(kind: MarkKind, line: Rect): string {
  const r = (n: number) => Math.round(n / 4);
  return `${kind}:${r(line.x)},${r(line.y)},${r(line.w)},${r(line.h)}`;
}
