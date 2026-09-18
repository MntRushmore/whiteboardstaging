/**
 * SVG path sampling, seeded RNG and pen tremor for the teacher hand.
 *
 * Lifted from the owner's prototype on branch
 * `origin/cursor/realtime-math-tutor-engine-5707`, file `src/lib/tutor/hand/path.ts`.
 *
 * One behavioural fix while lifting: `samplePath` now returns **one polyline per
 * subpath** instead of concatenating every `M` into a single polyline. The prototype
 * drew a phantom connecting line through glyphs whose path string contains more than
 * one `M` (`=`, `+`, `x`, `→`, …). Everything else is unchanged.
 */

/** A bare 2-D point in em-box coordinates. */
export type Pt = { x: number; y: number };

/** A sampled point with a dry-nib pressure hint in `z` (0…1). */
export type InkPt = { x: number; y: number; z: number };

function cubic(
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  x3: number,
  y3: number,
  t: number,
): Pt {
  const u = 1 - t;
  const uu = u * u;
  const tt = t * t;
  return {
    x: uu * u * x0 + 3 * uu * t * x1 + 3 * u * tt * x2 + tt * t * x3,
    y: uu * u * y0 + 3 * uu * t * y1 + 3 * u * tt * y2 + tt * t * y3,
  };
}

function quad(x0: number, y0: number, x1: number, y1: number, x2: number, y2: number, t: number): Pt {
  const u = 1 - t;
  return {
    x: u * u * x0 + 2 * u * t * x1 + t * t * x2,
    y: u * u * y0 + 2 * u * t * y1 + t * t * y2,
  };
}

/**
 * Sample a compact SVG path (M L C Q Z, absolute only) into polylines.
 * Every `M` starts a new polyline, so one glyph path string can yield several strokes.
 * Throws on malformed input — atlas data is a build-time constant, not user input.
 */
export function samplePath(d: string, steps = 7): Pt[][] {
  const tokens = d.replace(/,/g, " ").trim().split(/\s+/).filter(Boolean);
  const out: Pt[][] = [];
  let cur: Pt[] = [];
  let i = 0;
  let cx = 0;
  let cy = 0;
  let sx = 0;
  let sy = 0;

  const num = (): number => {
    const raw = tokens[i];
    i += 1;
    const v = Number(raw);
    if (!Number.isFinite(v)) throw new Error(`Bad path number near "${String(raw)}"`);
    return v;
  };

  const flush = (): void => {
    if (cur.length > 0) out.push(cur);
    cur = [];
  };

  while (i < tokens.length) {
    const cmd = tokens[i];
    i += 1;
    if (cmd === "M") {
      flush();
      cx = num();
      cy = num();
      sx = cx;
      sy = cy;
      cur.push({ x: cx, y: cy });
    } else if (cmd === "L") {
      cx = num();
      cy = num();
      cur.push({ x: cx, y: cy });
    } else if (cmd === "C") {
      const x1 = num();
      const y1 = num();
      const x2 = num();
      const y2 = num();
      const x = num();
      const y = num();
      for (let s = 1; s <= steps; s++) {
        cur.push(cubic(cx, cy, x1, y1, x2, y2, x, y, s / steps));
      }
      cx = x;
      cy = y;
    } else if (cmd === "Q") {
      const x1 = num();
      const y1 = num();
      const x = num();
      const y = num();
      for (let s = 1; s <= 6; s++) {
        cur.push(quad(cx, cy, x1, y1, x, y, s / 6));
      }
      cx = x;
      cy = y;
    } else if (cmd === "Z" || cmd === "z") {
      if (cx !== sx || cy !== sy) cur.push({ x: sx, y: sy });
      cx = sx;
      cy = sy;
    } else {
      throw new Error(`Unsupported path command "${String(cmd)}"`);
    }
  }

  flush();
  return out;
}

/** Deterministic 32-bit PRNG. Same seed, same hand, forever. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a += 0x6d2b79f5;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** One SVG path per stroke. Never join separate strokes into one polyline. */
export function polylineToSvgD(points: readonly Pt[]): string {
  const first = points[0];
  if (!first) return "";
  let d = `M ${first.x} ${first.y}`;
  for (let i = 1; i < points.length; i++) {
    const p = points[i];
    d += ` L ${p.x} ${p.y}`;
  }
  return d;
}

/** Slight tremor + dry-nib pressure. First/last points stay almost pinned. */
export function withTremor(points: readonly Pt[], seed: number, amount = 0.45): InkPt[] {
  if (points.length === 0) return [];
  const rng = mulberry32(seed);
  return points.map((p, i) => {
    const t = i / Math.max(1, points.length - 1);
    const edge = Math.sin(t * Math.PI);
    const nx = (rng() - 0.5) * amount * edge;
    const ny = (rng() - 0.5) * amount * edge + Math.sin(t * 11 + seed) * 0.12 * edge;
    return {
      x: p.x + nx,
      y: p.y + ny,
      z: 0.32 + rng() * 0.22,
    };
  });
}
