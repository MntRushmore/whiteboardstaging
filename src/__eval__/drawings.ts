/**
 * DRAWINGS scoreboard: what a geometry lesson puts on the board, next to a line of maths.
 *
 * Generated drawings (a triangle with its vertices and sides labelled, a right triangle with a
 * square corner mark, a circle with a radius, a number line with ticks and an open circle, axes
 * with a line on them, an arrow, a rectangle) are drawn by a pen that wobbles, and placed beside,
 * below or far from a line of maths the tutor's hand writes as a student would (`handInk`). Then
 * the board's grouping is run two ways:
 *
 *  - before: `clusterLines` over all the ink, as the board did until drawings were told apart;
 *  - after:  `splitInk` first, `clusterLines` over the writing only (what `LiveLoop.flush` does).
 *
 * and scored: is the maths line one line, exactly its own strokes (what Mathpix would get)? Is
 * the drawing kept out of every line? How many lines hold no maths at all (each one a wasted
 * recognizer call, and a "?" waiting to happen)? Are the labels attached to their drawing?
 *
 * Pure and offline: no Mathpix, no model. `drawings.test.ts` runs it in every `vitest run`;
 * `npm run eval:drawings` also writes docs/eval/drawings.{md,json}.
 */
import type { TLShapeId } from "tldraw";
import { mulberry32 } from "@/lib/hand";
import type { InkLine, InkStroke, Rect } from "@/lib/live/contracts";
import { barGroups, splitInk, type DiagramKind } from "@/lib/live/diagrams";
import { clusterLines, unionRects } from "@/lib/live/strokeClusters";
import { handInk, VARIANTS, type Variant } from "./handwriting";

type Pt = { x: number; y: number };

// ---------------------------------------------------------------- the pen

/**
 * A pen that draws the way a hand does: points every ~2 px, a slow sideways wobble and a little
 * jitter, corners slightly rounded, lines that stop a little short of or run a little past where
 * they meet.
 */
export class Pen {
  private readonly rand: () => number;
  private n = 0;
  constructor(
    private readonly prefix: string,
    seed = 1,
    private readonly wobble = 1.2,
  ) {
    this.rand = mulberry32(seed);
  }

  private id(): TLShapeId {
    this.n += 1;
    return `shape:${this.prefix}_${this.n}` as TLShapeId;
  }

  private jitter(): number {
    return (this.rand() - 0.5) * 0.8;
  }

  /** One stroke through `corners`, in order. */
  stroke(...corners: Pt[]): InkStroke {
    const pts: Pt[] = [];
    const phase = this.rand() * Math.PI * 2;
    let travelled = 0;
    for (let k = 1; k < corners.length; k++) {
      const a = corners[k - 1];
      const b = corners[k];
      const len = Math.hypot(b.x - a.x, b.y - a.y);
      const steps = Math.max(2, Math.ceil(len / 2));
      const nx = len > 0 ? -(b.y - a.y) / len : 0;
      const ny = len > 0 ? (b.x - a.x) / len : 0;
      for (let s = k === 1 ? 0 : 1; s <= steps; s++) {
        const t = s / steps;
        const w = this.wobble * Math.sin(phase + (travelled + t * len) / 40);
        pts.push({ x: a.x + (b.x - a.x) * t + nx * w + this.jitter(), y: a.y + (b.y - a.y) * t + ny * w + this.jitter() });
      }
      travelled += len;
    }
    return this.make([pts]);
  }

  /** An arc of an ellipse (a whole circle by default), in one stroke. */
  arc(cx: number, cy: number, rx: number, ry: number, from = 0, to = Math.PI * 2): InkStroke {
    const pts: Pt[] = [];
    const len = Math.abs(to - from) * Math.max(rx, ry);
    const steps = Math.max(8, Math.ceil(len / 2));
    const phase = this.rand() * Math.PI * 2;
    for (let s = 0; s <= steps; s++) {
      const a = from + ((to - from) * s) / steps;
      const w = this.wobble * Math.sin(phase + (s * len) / steps / 40);
      pts.push({ x: cx + (rx + w) * Math.cos(a) + this.jitter(), y: cy + (ry + w) * Math.sin(a) + this.jitter() });
    }
    return this.make([pts]);
  }

  /** A dot: a tiny scribble. */
  dot(x: number, y: number, r = 2.5): InkStroke {
    return this.arc(x, y, r, r);
  }

  private make(segments: Pt[][]): InkStroke {
    const all = segments.flat();
    const xs = all.map((p) => p.x);
    const ys = all.map((p) => p.y);
    const x = Math.min(...xs);
    const y = Math.min(...ys);
    return { id: this.id(), bounds: { x, y, w: Math.max(...xs) - x, h: Math.max(...ys) - y }, segments };
  }
}

// ---------------------------------------------------------------- writing placed on the board

let inkSerial = 0;

/** `latex` in the tutor's hand (as the student), its box's top-left at (x, y), `size` tall-ish. */
export function writeAt(latex: string, x: number, y: number, variant: Variant = VARIANTS[0], scale = 1): InkStroke[] {
  const ink = handInk(latex, variant);
  if (ink.unsupported.length > 0) throw new Error(`the hand cannot write ${latex}: ${ink.unsupported.join(", ")}`);
  const r = unionRects(ink.strokes.map((s) => s.bounds));
  const tag = `w${++inkSerial}`;
  const move = (p: Pt) => ({ x: x + (p.x - r.x) * scale, y: y + (p.y - r.y) * scale });
  return ink.strokes.map((s) => {
    const segments = s.segments.map((seg) => seg.map(move));
    const tl = move({ x: s.bounds.x, y: s.bounds.y });
    return { id: `${s.id}_${tag}` as TLShapeId, bounds: { x: tl.x, y: tl.y, w: s.bounds.w * scale, h: s.bounds.h * scale }, segments };
  });
}

/** A label written with its centre at (cx, cy): smaller than a line of work, as labels are. */
export function labelAt(latex: string, cx: number, cy: number, variant: Variant = VARIANTS[0]): InkStroke[] {
  const probe = writeAt(latex, 0, 0, variant, 0.8);
  const r = unionRects(probe.map((s) => s.bounds));
  return writeAt(latex, cx - r.w / 2, cy - r.h / 2, variant, 0.8);
}

// ---------------------------------------------------------------- geometry marks (the figure corpus)

/*
 * The marks a geometry figure carries, drawn by the same pen: an arc in an angle, a right-angle box,
 * tick marks on equal sides, arrow marks on parallel lines, and a label placed inside an angle. Used
 * by the figure corpus (src/__eval__/figures/corpus.ts); `DRAWINGS` below does not use them, so the
 * drawings scoreboard is unchanged.
 */

const unit = (a: Pt, b: Pt): Pt => {
  const d = Math.hypot(b.x - a.x, b.y - a.y) || 1;
  return { x: (b.x - a.x) / d, y: (b.y - a.y) / d };
};

/** The angle at `v` between the rays v→p and v→q, in radians (0..π). */
export function angleAt(v: Pt, p: Pt, q: Pt): number {
  const u1 = unit(v, p);
  const u2 = unit(v, q);
  return Math.acos(Math.max(-1, Math.min(1, u1.x * u2.x + u1.y * u2.y)));
}

/** A point `d` from `v` along the bisector of the angle between the rays v→p and v→q (inside it). */
export function inAngle(v: Pt, p: Pt, q: Pt, d: number): Pt {
  const u1 = unit(v, p);
  const u2 = unit(v, q);
  let bx = u1.x + u2.x;
  let by = u1.y + u2.y;
  const n = Math.hypot(bx, by);
  // a straight angle: the bisector is square to the line (on p's left, turning towards q)
  if (n < 1e-6) {
    bx = -u1.y;
    by = u1.x;
  } else {
    bx /= n;
    by /= n;
  }
  return { x: v.x + bx * d, y: v.y + by * d };
}

/** An arc marking the angle at `v` between the rays v→p and v→q (the smaller way round), radius `r`. */
export function angleArc(pen: Pen, v: Pt, p: Pt, q: Pt, r = 20): InkStroke {
  const a1 = Math.atan2(p.y - v.y, p.x - v.x);
  let diff = Math.atan2(q.y - v.y, q.x - v.x) - a1;
  while (diff > Math.PI) diff -= 2 * Math.PI;
  while (diff <= -Math.PI) diff += 2 * Math.PI;
  return pen.arc(v.x, v.y, r, r, a1, a1 + diff);
}

/** A right-angle box in the corner at `v` between the rays v→p and v→q, `s` px a side. */
export function rightAngleBox(pen: Pen, v: Pt, p: Pt, q: Pt, s = 16): InkStroke {
  const u1 = unit(v, p);
  const u2 = unit(v, q);
  const a = { x: v.x + u1.x * s, y: v.y + u1.y * s };
  const c = { x: v.x + u2.x * s, y: v.y + u2.y * s };
  const b = { x: a.x + u2.x * s, y: a.y + u2.y * s };
  return pen.stroke(a, b, c);
}

/** `k` short tick marks across the segment a–b at its middle (equal sides). */
export function tickMarks(pen: Pen, a: Pt, b: Pt, k = 1, len = 16): InkStroke[] {
  const u = unit(a, b);
  const n = { x: -u.y, y: u.x };
  const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
  const out: InkStroke[] = [];
  for (let i = 0; i < k; i++) {
    const off = (i - (k - 1) / 2) * 7;
    const c = { x: mid.x + u.x * off, y: mid.y + u.y * off };
    out.push(pen.stroke({ x: c.x - (n.x * len) / 2, y: c.y - (n.y * len) / 2 }, { x: c.x + (n.x * len) / 2, y: c.y + (n.y * len) / 2 }));
  }
  return out;
}

/** An arrow mark (a small `>` pointing a→b) on the segment a–b, `t` of the way along: parallel lines. */
export function arrowMark(pen: Pen, a: Pt, b: Pt, t = 0.5, size = 11): InkStroke {
  const u = unit(a, b);
  const n = { x: -u.y, y: u.x };
  const tip = { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
  const back = { x: tip.x - u.x * size, y: tip.y - u.y * size };
  return pen.stroke({ x: back.x + n.x * size * 0.7, y: back.y + n.y * size * 0.7 }, tip, { x: back.x - n.x * size * 0.7, y: back.y - n.y * size * 0.7 });
}

/** A label for the angle at `v` between v→p and v→q: centred inside it, further out for a narrow angle. */
export function angleLabel(latex: string, v: Pt, p: Pt, q: Pt, d?: number, variant: Variant = VARIANTS[0]): InkStroke[] {
  const half = angleAt(v, p, q) / 2;
  // a wide label (`2x + 10`) sits further out, where the angle has room for it
  const wide = latex.replace(/\^\{\\circ\}/g, "").replace(/\s/g, "").length > 3 ? 24 : 0;
  const dist = d ?? Math.min(96, Math.max(40, 26 / Math.max(0.2, Math.sin(half))) + wide);
  const at = inAngle(v, p, q, dist);
  return labelAt(latex, at.x, at.y, variant);
}

// ---------------------------------------------------------------- drawings

export interface Drawing {
  name: string;
  /** what `splitInk` should call it (one of these) */
  kinds: DiagramKind[];
  /** the drawing's own strokes and the marks on it */
  strokes: InkStroke[];
  /** each label's strokes */
  labels: InkStroke[][];
}

export function boundsOf(strokes: readonly InkStroke[]): Rect {
  return unionRects(strokes.map((s) => s.bounds));
}

/** Every drawing, its top-left at (x, y), about `scale` x 200 px across. */
export type DrawingMaker = (x: number, y: number, seed: number) => Drawing;

export const DRAWINGS: Record<string, DrawingMaker> = {
  triangle: (x, y, seed) => {
    const pen = new Pen(`tri${seed}`, seed);
    const A = { x: x + 100, y }, B = { x, y: y + 170 }, C = { x: x + 220, y: y + 170 };
    return {
      name: "triangle, three strokes, vertices and sides labelled",
      kinds: ["triangle"],
      strokes: [pen.stroke(A, B), pen.stroke(B, C), pen.stroke(C, { x: A.x + 2, y: A.y - 2 })],
      labels: [labelAt("A", A.x, A.y - 22), labelAt("B", B.x - 22, B.y + 8), labelAt("C", C.x + 22, C.y + 8), labelAt("7", x + 110, y + 196), labelAt("5", x + 30, y + 80)],
    };
  },
  triangleOneStroke: (x, y, seed) => {
    const pen = new Pen(`tri1_${seed}`, seed);
    const A = { x: x + 110, y }, B = { x, y: y + 160 }, C = { x: x + 210, y: y + 160 };
    return {
      name: "triangle in one stroke, angles labelled",
      kinds: ["triangle"],
      strokes: [pen.stroke(A, B, C, { x: A.x - 1, y: A.y + 2 })],
      labels: [labelAt("40^{\\circ}", x + 110, y + 50), labelAt("x", x + 36, y + 142), labelAt("65^{\\circ}", x + 176, y + 142)],
    };
  },
  rightTriangle: (x, y, seed) => {
    const pen = new Pen(`rt${seed}`, seed);
    const top = { x, y }, corner = { x, y: y + 150 }, right = { x: x + 200, y: y + 150 };
    return {
      name: "right triangle, square corner mark, sides 3, 4, x",
      kinds: ["triangle"],
      strokes: [pen.stroke(top, corner), pen.stroke(corner, right), pen.stroke(right, top), pen.stroke({ x, y: y + 130 }, { x: x + 20, y: y + 130 }, { x: x + 20, y: y + 150 })],
      labels: [labelAt("3", x - 22, y + 75), labelAt("4", x + 100, y + 174), labelAt("x", x + 118, y + 60)],
    };
  },
  circle: (x, y, seed) => {
    const pen = new Pen(`ci${seed}`, seed);
    const c = { x: x + 100, y: y + 100 };
    return {
      name: "circle with a radius, centre and radius labelled",
      kinds: ["circle"],
      strokes: [pen.arc(c.x, c.y, 100, 98), pen.stroke(c, { x: c.x + 99, y: c.y + 4 }), pen.dot(c.x, c.y)],
      labels: [labelAt("O", c.x - 4, c.y + 22), labelAt("5", c.x + 50, c.y - 18)],
    };
  },
  numberLine: (x, y, seed) => {
    const pen = new Pen(`nl${seed}`, seed);
    const len = 360;
    const strokes = [pen.stroke({ x, y }, { x: x + len, y })];
    // arrowheads at both ends, one V stroke each
    strokes.push(pen.stroke({ x: x + len - 14, y: y - 10 }, { x: x + len + 2, y }, { x: x + len - 14, y: y + 10 }));
    strokes.push(pen.stroke({ x: x + 14, y: y - 10 }, { x: x - 2, y }, { x: x + 14, y: y + 10 }));
    const labels: InkStroke[][] = [];
    for (let k = 0; k < 7; k++) {
      const tx = x + 30 + k * 50;
      strokes.push(pen.stroke({ x: tx, y: y - 9 }, { x: tx + 1, y: y + 9 }));
      labels.push(labelAt(String(k - 3), tx, y + 30));
    }
    // an open circle at 1
    strokes.push(pen.arc(x + 30 + 4 * 50, y, 7, 7));
    return { name: "number line: ticks, arrows, an open circle, numbers under it", kinds: ["numberLine"], strokes, labels };
  },
  axesAndLine: (x, y, seed) => {
    const pen = new Pen(`ax${seed}`, seed);
    const ox = x + 100, oy = y + 150;
    return {
      name: "axes with a line sketched on them",
      kinds: ["axes"],
      strokes: [pen.stroke({ x, y: oy }, { x: x + 240, y: oy }), pen.stroke({ x: ox, y: y + 250 }, { x: ox, y }), pen.stroke({ x: x + 30, y: y + 230 }, { x: x + 220, y: y + 20 })],
      labels: [labelAt("x", x + 256, oy + 4), labelAt("y", ox + 16, y - 10), labelAt("(2, 3)", x + 210, y + 100)],
    };
  },
  arrow: (x, y, seed) => {
    const pen = new Pen(`ar${seed}`, seed);
    return {
      name: "an arrow",
      kinds: ["arrow"],
      strokes: [pen.stroke({ x, y: y + 20 }, { x: x + 170, y: y + 20 }), pen.stroke({ x: x + 152, y: y + 8 }, { x: x + 171, y: y + 20 }, { x: x + 152, y: y + 33 })],
      labels: [],
    };
  },
  rectangle: (x, y, seed) => {
    const pen = new Pen(`re${seed}`, seed);
    const w = 220, h = 140;
    return {
      name: "rectangle, four strokes, sides labelled",
      kinds: ["quadrilateral"],
      strokes: [
        pen.stroke({ x, y }, { x: x + w, y: y + 1 }),
        pen.stroke({ x: x + w, y: y + 1 }, { x: x + w - 1, y: y + h }),
        pen.stroke({ x: x + w - 1, y: y + h }, { x: x + 1, y: y + h - 1 }),
        pen.stroke({ x: x + 1, y: y + h - 1 }, { x, y }),
      ],
      labels: [labelAt("7", x + w / 2, y + h + 22), labelAt("3", x + w + 22, y + h / 2)],
    };
  },
};

// ---------------------------------------------------------------- scenes

export interface Scene {
  id: string;
  drawing: string;
  placement: string;
  /** the maths line's strokes */
  math: InkStroke[];
  mathLatex: string;
  drawn: Drawing;
}

/** Where the drawing goes relative to the maths line (its box), and how far (px). */
export const PLACEMENTS: Record<string, (line: Rect, drawing: Rect) => Pt> = {
  "right, close": (l, d) => ({ x: l.x + l.w + 24, y: l.y + l.h / 2 - d.h / 2 }),
  "left, close": (l, d) => ({ x: l.x - d.w - 24, y: l.y + l.h / 2 - d.h / 2 }),
  "below, close": (l) => ({ x: l.x, y: l.y + l.h + 28 }),
  "above, close": (l, d) => ({ x: l.x + 20, y: l.y - d.h - 36 }),
  far: (l) => ({ x: l.x + l.w + 360, y: l.y - 40 }),
};

export const SCENE_LINES = ["a^{2} + b^{2} = c^{2}", "x + 40 + 65 = 180", "3^{2} + 4^{2} = x^{2}", "x = ?", "\\frac{x}{2} + 3 = 7", "2x + 3 > 11"];

function moveStroke(s: InkStroke, f: (p: Pt) => Pt, tag: string): InkStroke {
  const segments = s.segments.map((seg) => seg.map(f));
  const pts = segments.flat();
  const xs = pts.map((p) => p.x);
  const ys = pts.map((p) => p.y);
  const x = Math.min(...xs);
  const y = Math.min(...ys);
  return { id: `${s.id}_${tag}` as TLShapeId, bounds: { x, y, w: Math.max(...xs) - x, h: Math.max(...ys) - y }, segments };
}

function shift(d: Drawing, dx: number, dy: number, tag: string): Drawing {
  const f = (p: Pt) => ({ x: p.x + dx, y: p.y + dy });
  return { ...d, strokes: d.strokes.map((s) => moveStroke(s, f, tag)), labels: d.labels.map((l) => l.map((s) => moveStroke(s, f, tag))) };
}

/**
 * The drawing `scale` times as big; its labels stay the size they were written and move with the
 * point they label.
 */
function scaled(d: Drawing, scale: number): Drawing {
  if (scale === 1) return d;
  const labels = d.labels.map((l) => {
    const r = boundsOf(l);
    const cx = r.x + r.w / 2;
    const cy = r.y + r.h / 2;
    const dx = cx * scale - cx;
    const dy = cy * scale - cy;
    return l.map((s) => moveStroke(s, (p) => ({ x: p.x + dx, y: p.y + dy }), "sc"));
  });
  return { ...d, strokes: d.strokes.map((s) => moveStroke(s, (p) => ({ x: p.x * scale, y: p.y * scale }), "sc")), labels };
}

/** How big the drawings are drawn: as generated (~200 px across), smaller, bigger. */
export const SCENE_SCALES = [1, 0.7, 1.4] as const;

/** Every drawing, at every size, in every placement, beside every scene line, in every hand. */
export function buildScenes(): Scene[] {
  const scenes: Scene[] = [];
  let seed = 1;
  for (const variant of VARIANTS) {
    for (const scale of SCENE_SCALES) {
      for (const [name, make] of Object.entries(DRAWINGS)) {
        for (const [placement, place] of Object.entries(PLACEMENTS)) {
          for (const latex of SCENE_LINES) {
            seed++;
            const math = writeAt(latex, 600, 420, variant);
            const line = boundsOf(math);
            const raw = scaled(make(0, 0, seed), scale);
            const rb = boundsOf([...raw.strokes, ...raw.labels.flat()]);
            const at = place(line, rb);
            const drawn = shift(raw, at.x - rb.x, at.y - rb.y, `s${seed}`);
            scenes.push({ id: `${name}/${placement}/x${scale}/${variant.name}/${latex}`, drawing: name, placement, math, mathLatex: latex, drawn });
          }
        }
      }
    }
  }
  return scenes;
}

// ---------------------------------------------------------------- scoring

export interface SceneScore {
  id: string;
  drawing: string;
  placement: string;
  /** the maths line is one line of exactly its own strokes */
  mathIntact: boolean;
  /** no stroke of the drawing (or its marks) is in any line */
  drawingOut: boolean;
  /** lines holding no maths stroke: each a recognizer call for nothing (and a "?" or ring waiting) */
  strayLines: number;
  /** labels whose strokes all ended up attached to a drawing (after only) */
  labelsAttached: number;
  labels: number;
  /** what the split called it (after only) */
  kinds: DiagramKind[];
  /** division bars the split found (after only): a drawing beside maths is never one */
  bars: number;
}

function scoreLines(scene: Scene, lines: InkLine[]): Pick<SceneScore, "mathIntact" | "drawingOut" | "strayLines"> {
  const mathIds = new Set<string>(scene.math.map((s) => s.id));
  const drawingIds = new Set<string>(scene.drawn.strokes.map((s) => s.id));
  const mathLines = lines.filter((l) => l.strokeIds.some((id) => mathIds.has(id)));
  const mathIntact = mathLines.length === 1 && mathLines[0].strokeIds.length === mathIds.size;
  const drawingOut = lines.every((l) => l.strokeIds.every((id) => !drawingIds.has(id)));
  const strayLines = lines.filter((l) => l.strokeIds.every((id) => !mathIds.has(id))).length;
  return { mathIntact, drawingOut, strayLines };
}

export function scoreScene(scene: Scene, mode: "before" | "after"): SceneScore {
  const ink = [...scene.math, ...scene.drawn.strokes, ...scene.drawn.labels.flat()];
  const base = { id: scene.id, drawing: scene.drawing, placement: scene.placement, labels: scene.drawn.labels.length };
  if (mode === "before") return { ...base, ...scoreLines(scene, clusterLines(ink)), labelsAttached: 0, kinds: [], bars: 0 };
  const split = splitInk(ink);
  // the lines as `LiveLoop.flush` makes them: a division bar and its divisor are one line
  const lines = clusterLines(split.writing, [], barGroups(split.bars, ink));
  const attached = new Set<string>(split.diagrams.flatMap((d) => [...d.labels.flat(), ...d.strokeIds]));
  const labelsAttached = scene.drawn.labels.filter((l) => l.every((s) => attached.has(s.id))).length;
  return { ...base, ...scoreLines(scene, lines), labelsAttached, kinds: [...new Set(split.diagrams.flatMap((d) => d.kinds))], bars: split.bars.length };
}

export interface DrawingBoard {
  scenes: number;
  before: Totals;
  after: Totals;
  byDrawing: Array<{ drawing: string; name: string; scenes: number; before: Totals; after: Totals; kinds: string[] }>;
  byPlacement: Array<{ placement: string; scenes: number; before: Totals; after: Totals }>;
  failures: SceneScore[];
  /** scenes (after) with a line that holds no maths */
  stray: SceneScore[];
}

export interface Totals {
  mathIntact: number;
  drawingOut: number;
  strayLines: number;
  labelsAttached: number;
  labels: number;
  /** division bars found among drawings beside maths: 0 */
  bars: number;
}

function totals(scores: readonly SceneScore[]): Totals {
  return {
    mathIntact: scores.filter((s) => s.mathIntact).length,
    drawingOut: scores.filter((s) => s.drawingOut).length,
    strayLines: scores.reduce((n, s) => n + s.strayLines, 0),
    labelsAttached: scores.reduce((n, s) => n + s.labelsAttached, 0),
    labels: scores.reduce((n, s) => n + s.labels, 0),
    bars: scores.reduce((n, s) => n + s.bars, 0),
  };
}

export function runDrawingEval(scenes = buildScenes()): DrawingBoard {
  const before = scenes.map((s) => scoreScene(s, "before"));
  const after = scenes.map((s) => scoreScene(s, "after"));
  const drawings = [...new Set(scenes.map((s) => s.drawing))];
  const placements = [...new Set(scenes.map((s) => s.placement))];
  const pick = <K extends "drawing" | "placement">(arr: SceneScore[], key: K, v: string) => arr.filter((s) => s[key] === v);
  return {
    scenes: scenes.length,
    before: totals(before),
    after: totals(after),
    byDrawing: drawings.map((d) => ({
      drawing: d,
      name: DRAWINGS[d](0, 0, 1).name,
      scenes: pick(after, "drawing", d).length,
      before: totals(pick(before, "drawing", d)),
      after: totals(pick(after, "drawing", d)),
      kinds: [...new Set(pick(after, "drawing", d).flatMap((s) => s.kinds))],
    })),
    byPlacement: placements.map((p) => ({ placement: p, scenes: pick(after, "placement", p).length, before: totals(pick(before, "placement", p)), after: totals(pick(after, "placement", p)) })),
    failures: after.filter((s) => !s.mathIntact || !s.drawingOut),
    stray: after.filter((s) => s.strayLines > 0),
  };
}

// ---------------------------------------------------------------- division bars

/**
 * "Divide both sides by n" drawn as a bar under the whole equation with n under it (the owner's
 * board: the tutor wrote `2\sin x = 1`, the student drew a bar under it and a `2` under the bar),
 * and the rules under an equation that are NOT that. The equation is the student's own, or a
 * problem the tutor wrote: its ink then is not among the strokes, only its box
 * (`SplitOptions.equations`), as on the board (`LiveLoop.problemCells`).
 */
export interface BarScene {
  id: string;
  kind: string;
  /** a division bar (true), or a look-alike that must not become one */
  bar: boolean;
  ink: InkStroke[];
  equations: Rect[];
  /** the rule under the equation */
  rule: InkStroke;
  /** what is under the rule, when it is a divisor */
  divisor: InkStroke[];
  /** lines of the student's own that must each stay one line of exactly their strokes */
  lines: InkStroke[][];
}

export const BAR_EQUATIONS = ["2x + 3 = 11", "2 \\sin x = 1", "4x - 7 = 13", "2x + 3 > 11", "5x = 2x + 9"];
export const BAR_DIVISORS = ["2", "-3", "4", "\\frac{1}{2}"];

/** The tutor's problem as the chat writes it (`1.` then the problem, hand size 48): its box only. */
function tutorProblemBox(latex: string, x: number, y: number): Rect {
  return boundsOf(writeAt(`1. \\quad ${latex}`, x, y, VARIANTS[0], 48 / 44));
}

/** `latex` centred under a rule at `ruleY` whose middle is `cx`. */
function centredUnder(latex: string, cx: number, ruleY: number, variant: Variant): InkStroke[] {
  const w = boundsOf(writeAt(latex, 0, 0, variant)).w;
  return writeAt(latex, cx - w / 2, ruleY + 10, variant);
}

/** Every division bar, and every look-alike, under every equation, in every hand. */
export function buildBarScenes(): BarScene[] {
  const scenes: BarScene[] = [];
  let seed = 500;
  for (const variant of VARIANTS) {
    for (const latex of BAR_EQUATIONS) {
      for (const tutor of [false, true]) {
        const who = tutor ? "tutor's problem" : "student's line";
        const own = tutor ? [] : writeAt(latex, 600, 420, variant);
        const box = tutor ? tutorProblemBox(latex, 600, 420) : boundsOf(own);
        const equations = tutor ? [box] : [];
        const ruleY = box.y + box.h + (tutor ? 20 : 14);
        const rule = (pen: Pen) =>
          tutor ? pen.stroke({ x: box.x + 16, y: ruleY }, { x: box.x + box.w + 48, y: ruleY + 1 }) : pen.stroke({ x: box.x - 6, y: ruleY }, { x: box.x + box.w + 16, y: ruleY + 1 });
        const mid = (r: InkStroke) => r.bounds.x + r.bounds.w / 2;
        const base = (kind: string) => `${kind}/${who}/${variant.name}/${latex}`;
        // the division bars: the divisor under it, alone or with the next line written under it
        for (const d of BAR_DIVISORS) {
          for (const next of [false, true]) {
            const pen = new Pen(`bar${++seed}`, seed);
            const r = rule(pen);
            const divisor = centredUnder(d, mid(r), ruleY, variant);
            const after = next ? writeAt("x = 4", box.x + 10, boundsOf(divisor).y + boundsOf(divisor).h + 30, variant) : [];
            const kind = next ? "bar, divisor, next line" : "bar, divisor";
            scenes.push({ id: `${base(kind)}/${d}`, kind: `${kind} (${who})`, bar: true, ink: [...own, r, ...divisor, ...after], equations, rule: r, divisor, lines: [own, after].filter((l) => l.length > 0) });
          }
        }
        // look-alikes: an underline; a rule with the next line (a relation) right under it — the
        // sum under a system; a number line under the equation
        {
          const pen = new Pen(`ul${++seed}`, seed);
          const r = rule(pen);
          scenes.push({ id: base("underline"), kind: `an underline, nothing under it (${who})`, bar: false, ink: [...own, r], equations, rule: r, divisor: [], lines: [] });
        }
        {
          const pen = new Pen(`sum${++seed}`, seed);
          const r = rule(pen);
          const sum = writeAt("2x = 12", box.x + 4, ruleY + 12, variant);
          // under the student's line the rule is a fraction bar between the two, as it always was
          scenes.push({ id: base("rule over a line"), kind: `a rule with a line of maths under it (${who})`, bar: false, ink: [...own, r, ...sum], equations, rule: r, divisor: [], lines: tutor ? [sum] : [] });
        }
        {
          const nl = DRAWINGS.numberLine(0, 0, ++seed);
          const nb = boundsOf([...nl.strokes, ...nl.labels.flat()]);
          const moved = shift(nl, box.x - nb.x, ruleY + 14 - nb.y, `nl${seed}`);
          scenes.push({ id: base("number line"), kind: `a number line under it (${who})`, bar: false, ink: [...own, ...moved.strokes, ...moved.labels.flat()], equations, rule: moved.strokes[0], divisor: [], lines: [] });
        }
      }
    }
    // a proof's T-table: its bar under a heading, a rule down the middle, rows either side
    {
      const pen = new Pen(`tt${++seed}`, seed);
      const heading = [...writeAt("\\text{Statements}", 400, 300, variant), ...writeAt("\\text{Reasons}", 760, 300, variant)];
      const hb = boundsOf(heading);
      const barY = hb.y + hb.h + 12;
      const bar = pen.stroke({ x: 380, y: barY }, { x: 1000, y: barY + 1 });
      const upright = pen.stroke({ x: 690, y: barY - 2 }, { x: 691, y: barY + 260 });
      const rows = [
        ...writeAt("AB = CD", 420, barY + 24, variant),
        ...writeAt("\\text{Given}", 760, barY + 24, variant),
        ...writeAt("AB + BC = CD + BC", 400, barY + 110, variant),
        ...writeAt("\\text{Addition}", 760, barY + 110, variant),
      ];
      scenes.push({ id: `T-table/${variant.name}`, kind: "a proof's T-table", bar: false, ink: [...heading, bar, upright, ...rows], equations: [], rule: bar, divisor: [], lines: [] });
    }
    // a fraction in the student's own line; long division
    for (const [kind, latex] of [
      ["a fraction bar in the student's line", "\\frac{x + 1}{2} = 5"],
      ["a fraction bar under an equation's side", "\\frac{2x + 6}{2} = \\frac{10}{2}"],
      ["long division", "3 \\overline{)126}"],
    ] as const) {
      const ink = writeAt(latex, 600, 420, variant);
      scenes.push({ id: `${kind}/${variant.name}`, kind, bar: false, ink, equations: [], rule: ink[0], divisor: [], lines: [ink] });
    }
  }
  return scenes;
}

export interface BarScore {
  id: string;
  kind: string;
  bar: boolean;
  /** a bar: found, with exactly its divisor; a look-alike: no bar found */
  right: boolean;
  /** the student's own lines each one line of exactly their strokes */
  linesIntact: boolean;
}

export function scoreBarScene(scene: BarScene): BarScore {
  const split = splitInk(scene.ink, [], { equations: scene.equations });
  const lines = clusterLines(split.writing, [], barGroups(split.bars, scene.ink));
  const sameSet = (a: readonly string[], b: readonly string[]) => a.length === b.length && a.every((id) => b.includes(id));
  const right = scene.bar
    ? split.bars.length === 1 && split.bars[0].bar === scene.rule.id && sameSet(split.bars[0].divisor, scene.divisor.map((s) => s.id))
    : split.bars.length === 0;
  const linesIntact = scene.lines.every((own) => {
    const ids = own.map((s) => s.id as string);
    const holding = lines.filter((l) => l.strokeIds.some((id) => ids.includes(id)));
    return holding.length === 1 && sameSet(holding[0].strokeIds, ids);
  });
  return { id: scene.id, kind: scene.kind, bar: scene.bar, right, linesIntact };
}

export interface BarBoard {
  scenes: number;
  bars: { total: number; found: number; linesIntact: number };
  lookalikes: { total: number; taken: number };
  byKind: Array<{ kind: string; bar: boolean; scenes: number; right: number; linesIntact: number }>;
  failures: BarScore[];
}

export function runBarEval(scenes = buildBarScenes()): BarBoard {
  const scores = scenes.map(scoreBarScene);
  const bars = scores.filter((s) => s.bar);
  const look = scores.filter((s) => !s.bar);
  const kinds = [...new Set(scores.map((s) => s.kind))];
  return {
    scenes: scores.length,
    bars: { total: bars.length, found: bars.filter((s) => s.right).length, linesIntact: bars.filter((s) => s.right && s.linesIntact).length },
    lookalikes: { total: look.length, taken: look.filter((s) => !s.right).length },
    byKind: kinds.map((kind) => {
      const of = scores.filter((s) => s.kind === kind);
      return { kind, bar: of[0].bar, scenes: of.length, right: of.filter((s) => s.right).length, linesIntact: of.filter((s) => s.linesIntact).length };
    }),
    failures: scores.filter((s) => !s.right || !s.linesIntact),
  };
}

// ---------------------------------------------------------------- the writing must stay writing

export interface WritingCheck {
  lines: number;
  /** strokes of a written line `splitInk` did not call writing */
  misread: Array<{ latex: string; variant: string; stroke: string; role: string; reason: string }>;
  /** lines whose clustering changed because of the split */
  regrouped: number;
}

/** Every line in `lines`, in every hand: nothing in it may be taken for a drawing. */
export function checkWriting(lines: readonly string[], variants: readonly Variant[] = VARIANTS): WritingCheck {
  const misread: WritingCheck["misread"] = [];
  let regrouped = 0;
  let count = 0;
  for (const variant of variants) {
    for (const latex of lines) {
      const ink = handInk(latex, variant);
      if (ink.unsupported.length > 0) continue;
      count++;
      const split = splitInk(ink.strokes);
      for (const s of ink.strokes) {
        const v = split.roles.get(s.id);
        if (v && v.role !== "writing") misread.push({ latex, variant: variant.name, stroke: s.id, role: v.role, reason: v.reason });
      }
      if (split.writing.length !== ink.strokes.length) regrouped++;
    }
  }
  return { lines: count, misread, regrouped };
}

// ---------------------------------------------------------------- report

const pct = (n: number, d: number) => (d === 0 ? "—" : `${Math.round((100 * n) / d)}%`);

export function renderDrawingsMarkdown(board: DrawingBoard, writing: WritingCheck, bars?: BarBoard): string {
  const row = (cells: string[]) => `| ${cells.join(" | ")} |`;
  const table = (head: string[], rows: string[][]) => [row(head), row(head.map(() => "---")), ...rows.map(row)].join("\n");
  const n = board.scenes;
  return [
    "# Drawings scoreboard",
    "",
    "> Generated by `npm run eval:drawings` (src/__eval__/drawings.test.ts). Offline: no recognizer, no model.",
    "> Each scene is one generated drawing (drawn by a wobbling pen, at 0.7x, 1x and 1.4x of ~200 px) beside,",
    "> above, below or far from one line of maths in the tutor's hand writing as the student",
    `> (${VARIANTS.map((v) => v.name).join(", ")}). **Before** is \`clusterLines\` over all the ink (the board until`,
    "> drawings were told apart); **after** is `splitInk`, then `clusterLines` over the writing only (`LiveLoop.flush`).",
    "",
    table(
      ["", "before", "after"],
      [
        ["maths line intact (one line, exactly its strokes)", `${board.before.mathIntact} / ${n} (${pct(board.before.mathIntact, n)})`, `${board.after.mathIntact} / ${n} (${pct(board.after.mathIntact, n)})`],
        ["drawing kept out of every line", `${board.before.drawingOut} / ${n} (${pct(board.before.drawingOut, n)})`, `${board.after.drawingOut} / ${n} (${pct(board.after.drawingOut, n)})`],
        ["stray lines (no maths in them: a wasted recognizer call each)", String(board.before.strayLines), String(board.after.strayLines)],
        ["labels attached to their drawing", "—", `${board.after.labelsAttached} / ${board.after.labels} (${pct(board.after.labelsAttached, board.after.labels)})`],
        ["drawings taken for a division bar", "—", String(board.after.bars)],
      ],
    ),
    "",
    ...(bars ? renderBars(bars, table) : []),
    "## The writing stays writing",
    "",
    `Every line of the maths corpus (src/__eval__/corpus.ts) written in every hand (${VARIANTS.map((v) => v.name).join(", ")}): ${writing.lines} lines — fraction bars, long \`=\`, radicals, integral signs, \`\\left( \\right)\`, matrices, cases — split on its own.`,
    "",
    table(
      ["strokes taken for a drawing, mark or label", "lines regrouped by the split"],
      [[String(writing.misread.length), String(writing.regrouped)]],
    ),
    writing.misread.length === 0
      ? ""
      : "\n" + table(["line", "hand", "stroke", "role", "why"], writing.misread.slice(0, 40).map((m) => [`\`${m.latex}\``, m.variant, m.stroke, m.role, m.reason])),
    "",
    "## By drawing",
    "",
    table(
      ["drawing", "scenes", "maths intact before → after", "drawing out before → after", "stray lines before → after", "labels attached", "read as"],
      board.byDrawing.map((d) => [
        d.name,
        String(d.scenes),
        `${d.before.mathIntact} → ${d.after.mathIntact}`,
        `${d.before.drawingOut} → ${d.after.drawingOut}`,
        `${d.before.strayLines} → ${d.after.strayLines}`,
        `${d.after.labelsAttached} / ${d.after.labels}`,
        d.kinds.join(", "),
      ]),
    ),
    "",
    "## By placement",
    "",
    table(
      ["placement", "scenes", "maths intact before → after", "drawing out before → after", "stray lines before → after"],
      board.byPlacement.map((p) => [p.placement, String(p.scenes), `${p.before.mathIntact} → ${p.after.mathIntact}`, `${p.before.drawingOut} → ${p.after.drawingOut}`, `${p.before.strayLines} → ${p.after.strayLines}`]),
    ),
    "",
    "## Scenes still wrong after",
    "",
    "Each is a label written in the gap between the line and the drawing, nearer the line than the drawing (at 1.4x the",
    "labels move away from the drawing with the point they label): the clusterer runs it into the line and nothing tells",
    "them apart. Stray lines after are labels written further than `labelReachFactor` glyphs from their drawing; they are",
    "read as a line of their own, as before.",
    "",
    board.failures.length === 0
      ? "None."
      : table(["scene", "maths intact", "drawing out", "stray lines"], board.failures.slice(0, 60).map((f) => [f.id.replace(/\|/g, "\\|"), String(f.mathIntact), String(f.drawingOut), String(f.strayLines)])),
    "",
  ].join("\n");
}

/** The division-bar section: found under every equation, never taken for a look-alike. */
function renderBars(bars: BarBoard, table: (head: string[], rows: string[][]) => string): string[] {
  return [
    "## Division bars",
    "",
    "\"Divide both sides by n\" drawn as a bar under the whole equation with n under it (`divisionBars` in",
    "`src/lib/live/diagrams.ts`): under the student's own line, or under a problem the tutor wrote (its box only, as",
    "`SplitOptions.equations`), with the next line written under it or not, in every hand, the divisors",
    `${BAR_DIVISORS.map((d) => `\`${d}\``).join(", ")} under ${BAR_EQUATIONS.map((e) => `\`${e}\``).join(", ")} — and the rules under an equation that are not one.`,
    "",
    table(
      ["", "right"],
      [
        ["division bars found, with exactly their divisor", `${bars.bars.found} / ${bars.bars.total} (${pct(bars.bars.found, bars.bars.total)})`],
        ["… and the student's own lines each one line of exactly their strokes", `${bars.bars.linesIntact} / ${bars.bars.total}`],
        ["look-alikes taken for a division bar", `${bars.lookalikes.taken} / ${bars.lookalikes.total}`],
      ],
    ),
    "",
    table(
      ["scene", "a bar?", "scenes", "right", "lines intact"],
      bars.byKind.map((k) => [k.kind, k.bar ? "yes" : "no", String(k.scenes), String(k.right), String(k.linesIntact)]),
    ),
    "",
    bars.failures.length === 0 ? "Every scene right." : table(["scene"], bars.failures.slice(0, 40).map((f) => [f.id.replace(/\|/g, "\\|")])),
    "",
  ];
}
