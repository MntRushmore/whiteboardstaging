import { ATLAS, EM_HEIGHT, glyphKey, tokenizeHand, type Glyph } from "./atlas";
import { mulberry32, samplePath, withTremor, type Pt } from "./path";

export type InkSegment = {
  type: "free" | "straight";
  points: { x: number; y: number; z?: number }[];
};

export const HAND_SIZE = 14;
export const LINE_HEIGHT = 18;
/** Simon lock: 4px advance between glyphs. */
export const ADVANCE_PX = 4;
export const WORD_GAP_PX = ADVANCE_PX * 2;
/** Never sit on the ruled line. */
export const JITTER_MIN = 0.4;
export const JITTER_SPAN = 0.85;

export type ComposedInk = {
  segments: InkSegment[];
  width: number;
  height: number;
};

export function baselineJitter(rng: () => number): number {
  const sign = rng() < 0.5 ? -1 : 1;
  return sign * (JITTER_MIN + rng() * JITTER_SPAN);
}

function pickGlyph(ch: string, rng: () => number, prev: { key: string; alt: number }): Glyph | null {
  const key = glyphKey(ch);
  const alts = ATLAS[key];
  if (!alts?.length) return null;
  if (alts.length === 1) {
    prev.key = key;
    prev.alt = 0;
    return alts[0];
  }
  let i = Math.floor(rng() * alts.length);
  if (prev.key === key && i === prev.alt) i = (i + 1) % alts.length;
  prev.key = key;
  prev.alt = i;
  return alts[i];
}

function wordWidth(word: string, scale: number): number {
  let w = 0;
  for (const ch of tokenizeHand(word)) {
    if (ch === " ") continue;
    const g = ATLAS[glyphKey(ch)]?.[0];
    w += (g?.advance ?? 4) * scale + ADVANCE_PX;
  }
  return w;
}

function strokeToLocal(points: Pt[], ox: number, oy: number, scale: number, seed: number): InkSegment {
  const scaled = points.map((p) => ({ x: p.x * scale + ox, y: p.y * scale + oy }));
  return {
    type: "free",
    points: withTremor(scaled, seed),
  };
}

/** Compose a teacher-hand string as tldraw draw segments (local coords). */
export function composeHandwriting(
  text: string,
  opts: { maxWidth: number; seed?: number; size?: number },
): ComposedInk {
  const scale = (opts.size ?? HAND_SIZE) / EM_HEIGHT;
  const rng = mulberry32(opts.seed ?? 1);
  const prev = { key: "", alt: -1 };
  const segments: InkSegment[] = [];
  let x = 0;
  let y = 0;
  let maxX = 0;
  let seed = opts.seed ?? 1;

  const words = text.replace(/\s+/g, " ").trim().split(" ");
  for (let w = 0; w < words.length; w++) {
    const word = words[w];
    if (!word) continue;
    const ww = wordWidth(word, scale);
    if (x > 0 && x + ww > opts.maxWidth) {
      x = 0;
      y += LINE_HEIGHT;
    }

    for (const ch of tokenizeHand(word)) {
      const glyph = pickGlyph(ch, rng, prev);
      seed += 17;
      if (!glyph) continue;
      const jitter = baselineJitter(rng);
      for (const path of glyph.paths) {
        const pts = samplePath(path);
        if (pts.length < 2) continue;
        segments.push(strokeToLocal(pts, x, y + jitter, scale, seed));
        seed += 3;
      }
      x += glyph.advance * scale + ADVANCE_PX;
      if (x > maxX) maxX = x;
    }

    if (w < words.length - 1) {
      x += WORD_GAP_PX;
      if (x > maxX) maxX = x;
    }
  }

  return {
    segments,
    width: Math.max(8, maxX),
    height: y + LINE_HEIGHT,
  };
}

/** Alternate index per non-space character. Never repeats the same alt twice in a row. */
export function pickAlternates(text: string, seed = 1): number[] {
  const rng = mulberry32(seed);
  const prev = { key: "", alt: -1 };
  const out: number[] = [];
  for (const ch of tokenizeHand(text)) {
    if (ch === " ") continue;
    pickGlyph(ch, rng, prev);
    out.push(prev.alt);
  }
  return out;
}

export function composeCircle(w: number, h: number, seed: number): ComposedInk {
  const n = 48;
  const rx = Math.max(8, w / 2);
  const ry = Math.max(8, h / 2);
  const raw: Pt[] = [];
  for (let i = 0; i <= n; i++) {
    const a = (i / n) * Math.PI * 2;
    const wobble = 1 + Math.sin(a * 3 + seed * 0.01) * 0.028;
    raw.push({
      x: rx + Math.cos(a) * rx * wobble,
      y: ry + Math.sin(a) * ry * wobble,
    });
  }
  return {
    segments: [{ type: "free", points: withTremor(raw, seed, 0.55) }],
    width: rx * 2,
    height: ry * 2,
  };
}

export function composeCaret(seed: number): ComposedInk {
  const raw: Pt[] = [
    { x: 0, y: 11 },
    { x: 5.2, y: 1.2 },
    { x: 10.2, y: 11 },
  ];
  return {
    segments: [{ type: "free", points: withTremor(raw, seed, 0.4) }],
    width: 10,
    height: 12,
  };
}

export function composeUnderline(w: number, seed: number): ComposedInk {
  const raw: Pt[] = [
    { x: 0, y: 2 },
    { x: Math.max(16, w) * 0.35, y: 1.4 },
    { x: Math.max(16, w) * 0.7, y: 2.3 },
    { x: Math.max(16, w), y: 1.6 },
  ];
  return {
    segments: [{ type: "free", points: withTremor(raw, seed, 0.35) }],
    width: Math.max(16, w),
    height: 4,
  };
}

/** Geometry: angle arc in the same dry red nib — not letters. */
export function composeAngleArc(w: number, h: number, seed: number): ComposedInk {
  const r = Math.max(14, Math.min(w, h) * 0.32);
  const cx = 10;
  const cy = Math.max(r + 4, h - 8);
  const raw: Pt[] = [];
  const n = 18;
  for (let i = 0; i <= n; i++) {
    const a = -Math.PI / 2 + (i / n) * (Math.PI / 2);
    raw.push({ x: cx + Math.cos(a) * r, y: cy + Math.sin(a) * r });
  }
  return {
    segments: [{ type: "free", points: withTremor(raw, seed, 0.4) }],
    width: cx + r + 4,
    height: cy + 4,
  };
}

/** Geometry: tick marks on a side, same nib. */
export function composeTickMarks(w: number, seed: number): ComposedInk {
  const mid = Math.max(16, w) / 2;
  const segments = [-5, 0, 5].map((dx, i) => {
    const raw: Pt[] = [
      { x: mid + dx - 1.2, y: -3 },
      { x: mid + dx + 1.4, y: 5 },
    ];
    return { type: "free" as const, points: withTremor(raw, seed + i * 11, 0.3) };
  });
  return {
    segments,
    width: Math.max(16, w),
    height: 8,
  };
}

export function composeArrow(w: number, h: number, seed: number): ComposedInk {
  const len = Math.max(24, w);
  const mid = h / 2;
  const shaft: Pt[] = [
    { x: 0, y: mid },
    { x: len * 0.5, y: mid - 0.6 },
    { x: len, y: mid },
  ];
  const head: Pt[] = [
    { x: len - 8, y: mid - 5 },
    { x: len, y: mid },
    { x: len - 8, y: mid + 5 },
  ];
  return {
    segments: [
      { type: "free", points: withTremor(shaft, seed, 0.35) },
      { type: "free", points: withTremor(head, seed + 9, 0.35) },
    ],
    width: len,
    height: Math.max(14, h),
  };
}
