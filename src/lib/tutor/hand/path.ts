export type Pt = { x: number; y: number };

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

/** Sample a compact SVG path (M L C Q Z, absolute only) into a polyline. */
export function samplePath(d: string, steps = 7): Pt[] {
  const tokens = d.replace(/,/g, " ").trim().split(/\s+/);
  const pts: Pt[] = [];
  let i = 0;
  let cx = 0;
  let cy = 0;
  let sx = 0;
  let sy = 0;

  const num = () => {
    const v = Number(tokens[i++]);
    if (!Number.isFinite(v)) throw new Error(`Bad path number near "${tokens[i - 1]}"`);
    return v;
  };

  while (i < tokens.length) {
    const cmd = tokens[i++];
    if (cmd === "M") {
      cx = num();
      cy = num();
      sx = cx;
      sy = cy;
      pts.push({ x: cx, y: cy });
    } else if (cmd === "L") {
      cx = num();
      cy = num();
      pts.push({ x: cx, y: cy });
    } else if (cmd === "C") {
      const x1 = num();
      const y1 = num();
      const x2 = num();
      const y2 = num();
      const x = num();
      const y = num();
      for (let s = 1; s <= steps; s++) {
        pts.push(cubic(cx, cy, x1, y1, x2, y2, x, y, s / steps));
      }
      cx = x;
      cy = y;
    } else if (cmd === "Q") {
      const x1 = num();
      const y1 = num();
      const x = num();
      const y = num();
      for (let s = 1; s <= 6; s++) {
        pts.push(quad(cx, cy, x1, y1, x, y, s / 6));
      }
      cx = x;
      cy = y;
    } else if (cmd === "Z" || cmd === "z") {
      if (cx !== sx || cy !== sy) pts.push({ x: sx, y: sy });
      cx = sx;
      cy = sy;
    } else {
      throw new Error(`Unsupported path command "${cmd}"`);
    }
  }

  return pts;
}

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

/** Slight tremor + dry-nib pressure. First/last points stay almost pinned. */
export function withTremor(points: Pt[], seed: number, amount = 0.45): { x: number; y: number; z: number }[] {
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
