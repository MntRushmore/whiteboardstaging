import { LIVE_LIMITS, type InkLine, type InkStroke, type StrokePayload } from "./contracts";

/**
 * Payload building (spec §6.3). Pure: no editor, no DOM.
 *
 * Points are moved to the line's origin, scaled so the line is ~180 px tall
 * (sx clamped to [0.5, 8]), rounded to integers, simplified with RDP (eps 0.75 in
 * normalized units) and de-duplicated. The sha-1 of the (x, y) arrays is the
 * recognition cache key, so a translated line hashes identically.
 */

export interface Pt {
  x: number;
  y: number;
}

export function clamp(n: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, n));
}

function perpendicularDistance(p: Pt, a: Pt, b: Pt): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  if (len2 === 0) return Math.hypot(p.x - a.x, p.y - a.y);
  const t = clamp(((p.x - a.x) * dx + (p.y - a.y) * dy) / len2, 0, 1);
  const px = a.x + t * dx;
  const py = a.y + t * dy;
  return Math.hypot(p.x - px, p.y - py);
}

/** Ramer-Douglas-Peucker, iterative (no recursion depth issues on long strokes). */
export function rdp(points: Pt[], epsilon: number): Pt[] {
  if (points.length <= 2) return points.slice();
  const keep = new Array<boolean>(points.length).fill(false);
  keep[0] = true;
  keep[points.length - 1] = true;
  const stack: Array<[number, number]> = [[0, points.length - 1]];
  while (stack.length > 0) {
    const [start, end] = stack.pop() as [number, number];
    let maxDist = 0;
    let index = -1;
    for (let i = start + 1; i < end; i++) {
      const d = perpendicularDistance(points[i], points[start], points[end]);
      if (d > maxDist) {
        maxDist = d;
        index = i;
      }
    }
    if (index !== -1 && maxDist > epsilon) {
      keep[index] = true;
      stack.push([start, index], [index, end]);
    }
  }
  const out: Pt[] = [];
  for (let i = 0; i < points.length; i++) if (keep[i]) out.push(points[i]);
  return out;
}

export function dedupeConsecutive(points: Pt[]): Pt[] {
  const out: Pt[] = [];
  for (const p of points) {
    const last = out[out.length - 1];
    if (!last || last.x !== p.x || last.y !== p.y) out.push(p);
  }
  return out;
}

/** Scale factor that brings the line to ~180 px tall. */
export function normalizationScale(lineHeight: number): number {
  const h = Math.max(1, lineHeight);
  return clamp(LIVE_LIMITS.normalizedLineHeight / h, 0.5, 8);
}

/**
 * Builds the recognizer payload for one line. Returns null when the line exceeds
 * the stroke/point caps (the caller marks the line `unknown` and skips recognition).
 */
export function buildPayload(line: InkLine, strokes: InkStroke[]): StrokePayload | null {
  const byId = new Map(strokes.map((s) => [s.id as string, s]));
  const members = line.strokeIds.map((id) => byId.get(id)).filter((s): s is InkStroke => Boolean(s));
  if (members.length === 0) return null;
  const sx = normalizationScale(line.bounds.h);
  const xs: number[][] = [];
  const ys: number[][] = [];
  let maxX = 0;
  let maxY = 0;
  for (const stroke of members) {
    for (const segment of stroke.segments) {
      if (segment.length === 0) continue;
      let pts: Pt[] = segment.map((p) => ({
        x: Math.round((p.x - line.bounds.x) * sx),
        y: Math.round((p.y - line.bounds.y) * sx),
      }));
      pts = dedupeConsecutive(rdp(pts, LIVE_LIMITS.rdpEpsilon));
      if (pts.length === 1) {
        // A tap / dot / equals tick is still a stroke; give the recognizer two points.
        pts.push({ x: pts[0].x + 1, y: pts[0].y });
      }
      if (pts.length > LIVE_LIMITS.maxPointsPerStroke) return null;
      xs.push(pts.map((p) => p.x));
      ys.push(pts.map((p) => p.y));
      for (const p of pts) {
        if (p.x > maxX) maxX = p.x;
        if (p.y > maxY) maxY = p.y;
      }
      if (xs.length > LIVE_LIMITS.maxStrokesPerLine) return null;
    }
  }
  if (xs.length === 0) return null;
  return { x: xs, y: ys, w: Math.max(1, maxX), h: Math.max(1, maxY) };
}

export function payloadPointCount(payload: StrokePayload): number {
  return payload.x.reduce((n, s) => n + s.length, 0);
}

function fnv1a(str: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, "0");
}

/** sha-1 hex of JSON([x, y]) via WebCrypto; falls back to FNV-1a when subtle is unavailable. */
export async function hashPayload(payload: StrokePayload): Promise<string> {
  const json = JSON.stringify([payload.x, payload.y]);
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) return `fnv_${fnv1a(json)}`;
  try {
    const bytes = new TextEncoder().encode(json);
    const digest = await subtle.digest("SHA-1", bytes);
    return Array.from(new Uint8Array(digest))
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");
  } catch {
    return `fnv_${fnv1a(json)}`;
  }
}
