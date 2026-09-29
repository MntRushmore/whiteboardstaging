import type { Rect } from "../../contracts";
import { PEN, rectsOverlap, type Align, type Pt, type VAlign } from "../../graphing/pen";
import type { HandLineStyle } from "../../handwriting";
import type { LectureInk } from "../contracts";
import { INK, LECTURE_PACE, LECTURE_TEXT, Sketch, TITLE_GAP, curvedArrow, fitTitle, handArrow, handBox, handEllipse, innerBox, shapeStyle, union, type LectureSketch } from "../chart/sketch";
import { measureWords, type WordsLayout } from "../words";

/**
 * What every diagram is made of, as data first: boxes and ellipses round words, arrows, lines and
 * words on their own, in the order a teacher draws them, each a named part (`part`) with its ink
 * (`style`). A diagram's planner tries layouts until one is `clean` — no two pieces of writing
 * touch, no line runs through any — and fits the room under the title; only then is it drawn
 * (`drawDiagram`).
 *
 * The room is a fixed frame: a layout puts things at positions in it, the title is centred over
 * it, and nothing is re-centred round what happens to be drawn — so a diagram planned again with
 * one more step keeps what it had where it was (see each kind for when it cannot).
 *
 * Inks: the words, arrows and lines are the tutor's; a box or an ellipse round words is drawn in
 * the diagram's accent colour and tinted inside (`boxNode`).
 */

export const DIAGRAM = {
  /** the writing's scale, largest first */
  levels: [1, 0.93, 0.86, 0.8],
  /** a node's words: size (× level), the smallest, most lines; the box round them */
  node: { size: 27, min: 22, maxLines: 3, padX: 12, padY: 9, radius: 11 },
  /** an arrow or a line stops this far from what it joins */
  linkGap: 6,
  arrowHead: 13,
  /** px any writing keeps from a line, and from other writing */
  clear: 3,
  textPad: 5,
} as const;

type Parted = { part: string; style?: HandLineStyle };

export type Item = Parted &
  (
    | { t: "box"; rect: Rect }
    | { t: "ellipse"; c: Pt; rx: number; ry: number }
    | { t: "text"; layout: WordsLayout; at: Pt; align: Align; valign: VAlign }
    | { t: "arrow"; pts: Pt[] }
    | { t: "line"; pts: Pt[] }
    | { t: "dot"; c: Pt; r: number }
  );

/** Hand sizes of a node's words and of the small writing (arrow labels, a timeline's items) at level k. */
export function sizesAt(k: number): { node: number; small: number } {
  const N = DIAGRAM.node;
  const S = LECTURE_TEXT.small;
  return { node: Math.max(N.min, Math.round(N.size * k)), small: Math.max(S.min, Math.round(S.size * k)) };
}

/** Every text at one hand size, each wrapped (evenly) into `maxW`, at most `maxLines` lines; null if one will not fit. */
export function fitAll(texts: readonly string[], size: number, maxW: number, maxLines: number = DIAGRAM.node.maxLines): WordsLayout[] | null {
  const out: WordsLayout[] = [];
  for (const t of texts) {
    const m = measureWords(t, size, { maxWidth: maxW, maxLines, balance: true });
    if (!m) return null;
    out.push(m);
  }
  return out;
}

/** The box round a node's words. */
export function nodeSize(text: WordsLayout): { w: number; h: number } {
  const N = DIAGRAM.node;
  return { w: text.w + 2 * N.padX, h: text.h + 2 * N.padY };
}

export function rectAt(l: { w: number; h: number }, at: Pt, align: Align, valign: VAlign): Rect {
  const x = align === "left" ? at.x : align === "center" ? at.x - l.w / 2 : at.x - l.w;
  const y = valign === "top" ? at.y : valign === "middle" ? at.y - l.h / 2 : at.y - l.h;
  return { x, y, w: l.w, h: l.h };
}

/** A node: its box (in the accent colour, tinted), then its words in the middle of it. */
export function boxNode(rect: Rect, text: WordsLayout, part: string, accent: LectureInk): Item[] {
  return [
    { t: "box", rect, part, style: shapeStyle(accent) },
    { t: "text", layout: text, at: { x: rect.x + rect.w / 2, y: rect.y + rect.h / 2 }, align: "center", valign: "middle", part: `${part}:text` },
  ];
}

function textRect(it: Extract<Item, { t: "text" }>): Rect {
  return rectAt(it.layout, it.at, it.align, it.valign);
}

function sample(pts: readonly Pt[], step = 3): Pt[] {
  const out: Pt[] = [];
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1];
    const b = pts[i];
    const n = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) / step));
    for (let j = 0; j <= n; j++) out.push({ x: a.x + ((b.x - a.x) * j) / n, y: a.y + ((b.y - a.y) * j) / n });
  }
  return out;
}

function ellipsePts(c: Pt, rx: number, ry: number): Pt[] {
  const n = Math.max(48, Math.ceil((Math.PI * (rx + ry)) / 3));
  return Array.from({ length: n + 1 }, (_, i) => ({ x: c.x + rx * Math.cos((i / n) * Math.PI * 2), y: c.y + ry * Math.sin((i / n) * Math.PI * 2) }));
}

/** Where an item's ink goes, as points (lines, outlines) — what writing must keep off. */
function inkOf(it: Item): Pt[] {
  switch (it.t) {
    case "box": {
      const r = it.rect;
      return sample([
        { x: r.x, y: r.y },
        { x: r.x + r.w, y: r.y },
        { x: r.x + r.w, y: r.y + r.h },
        { x: r.x, y: r.y + r.h },
        { x: r.x, y: r.y },
      ]);
    }
    case "ellipse":
      return ellipsePts(it.c, it.rx, it.ry);
    case "arrow": {
      const end = it.pts[it.pts.length - 1];
      const [b1, b2] = barbs(it.pts);
      return [...sample(it.pts), ...sample([b1, end, b2])];
    }
    case "line":
      return sample(it.pts);
    case "dot":
      return [it.c];
    case "text":
      return [];
  }
}

/** The two ends of an arrowhead at the last point of `pts` (as `Pen.arrowhead` draws them). */
function barbs(pts: readonly Pt[]): Pt[] {
  const end = pts[pts.length - 1];
  let i = pts.length - 2;
  while (i > 0 && Math.hypot(end.x - pts[i].x, end.y - pts[i].y) < 8) i--;
  const d = Math.hypot(end.x - pts[i].x, end.y - pts[i].y) || 1;
  const ux = (end.x - pts[i].x) / d;
  const uy = (end.y - pts[i].y) / d;
  return [1, -1].map((sign) => {
    const a = Math.PI + sign * PEN.arrowAngle;
    return { x: end.x + (ux * Math.cos(a) - uy * Math.sin(a)) * DIAGRAM.arrowHead, y: end.y + (ux * Math.sin(a) + uy * Math.cos(a)) * DIAGRAM.arrowHead };
  });
}

/** The bounding rect of everything in the items (writing by its layout box, an arrow's head by its reach). */
export function boundsOf(items: readonly Item[]): Rect {
  const rects: Rect[] = [];
  for (const it of items) {
    if (it.t === "text") rects.push(textRect(it));
    else if (it.t === "box") rects.push(it.rect);
    else if (it.t === "ellipse") rects.push({ x: it.c.x - it.rx, y: it.c.y - it.ry, w: 2 * it.rx, h: 2 * it.ry });
    else if (it.t === "dot") rects.push({ x: it.c.x - it.r, y: it.c.y - it.r, w: 2 * it.r, h: 2 * it.r });
    else {
      const pts = it.t === "arrow" ? [...it.pts, ...barbs(it.pts)] : it.pts;
      const xs = pts.map((p) => p.x);
      const ys = pts.map((p) => p.y);
      rects.push({ x: Math.min(...xs), y: Math.min(...ys), w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys) });
    }
  }
  return union(rects);
}

/**
 * Is the layout clean: no two pieces of writing within `textPad` of each other, and no line,
 * arrow or outline within `clear` of any writing?
 */
export function clean(items: readonly Item[]): boolean {
  const texts = items.filter((i): i is Extract<Item, { t: "text" }> => i.t === "text").map(textRect);
  for (let i = 0; i < texts.length; i++) for (let j = i + 1; j < texts.length; j++) if (rectsOverlap(texts[i], texts[j], DIAGRAM.textPad)) return false;
  const c = DIAGRAM.clear;
  for (const it of items) {
    if (it.t === "text") continue;
    for (const p of inkOf(it)) {
      for (const r of texts) if (p.x > r.x - c && p.x < r.x + r.w + c && p.y > r.y - c && p.y < r.y + r.h + c) return false;
    }
  }
  return true;
}

/** Does any line, arrow or outline (other than `except`) pass through the rect? */
export function crosses(items: readonly Item[], r: Rect, except: readonly Item[] = []): boolean {
  for (const it of items) {
    if (it.t === "text" || except.includes(it)) continue;
    for (const p of inkOf(it)) if (p.x > r.x && p.x < r.x + r.w && p.y > r.y && p.y < r.y + r.h) return true;
  }
  return false;
}

function shift(it: Item, dx: number, dy: number): Item {
  const m = (p: Pt) => ({ x: p.x + dx, y: p.y + dy });
  switch (it.t) {
    case "box":
      return { ...it, rect: { ...it.rect, x: it.rect.x + dx, y: it.rect.y + dy } };
    case "ellipse":
      return { ...it, c: m(it.c) };
    case "text":
      return { ...it, at: m(it.at) };
    case "arrow":
    case "line":
      return { ...it, pts: it.pts.map(m) };
    case "dot":
      return { ...it, c: m(it.c) };
  }
}

/**
 * The title and the laid-out items as a sketch: the title centred over the room, the items where
 * the layout put them in the room, in order. Null when they leave the room or are not clean.
 * `anchor`: the frame the plan is given in (see `Sketch.finish`) — the room, or what was drawn.
 */
export function drawDiagram(
  items: readonly Item[],
  title: string | undefined,
  box: { w: number; h: number },
  k: number,
  seed: number,
  size: number,
  anchor: "room" | "content" = "room",
): LectureSketch | null {
  if (!clean(items)) return null;
  const inner = innerBox(box);
  const t = title ? fitTitle(title, inner.w, k) : null;
  if (title && !t) return null;
  const top = t ? t.h + TITLE_GAP : 0;
  const b = boundsOf(items);
  if (b.x < -0.5 || b.y < -0.5 || b.x + b.w > inner.w + 0.5 || b.y + b.h + top > inner.h + 0.5) return null;
  const s = new Sketch(seed);
  if (t) s.write("title", t, { x: inner.w / 2, y: 0 }, "center", "top");
  const line = { color: INK.line };
  for (const raw of items) {
    const it = shift(raw, 0, top);
    switch (it.t) {
      case "box":
        s.draw(it.part, (pen) => handBox(pen, it.rect, DIAGRAM.node.radius), it.style ?? line);
        break;
      case "ellipse":
        s.draw(it.part, (pen) => handEllipse(pen, it.c, it.rx, it.ry), it.style ?? line);
        break;
      case "text":
        s.write(it.part, it.layout, it.at, it.align, it.valign, it.style);
        break;
      case "arrow":
        s.draw(it.part, (pen) => (it.pts.length === 2 ? handArrow(pen, it.pts[0], it.pts[1], DIAGRAM.arrowHead) : curvedArrow(pen, it.pts, DIAGRAM.arrowHead)), it.style ?? line);
        break;
      case "line":
        s.draw(it.part, (pen) => (it.pts.length === 2 ? pen.line(it.pts[0], it.pts[1]) : pen.polyline(it.pts, 0.3)), it.style ?? line);
        break;
      case "dot":
        s.draw(it.part, (pen) => pen.dot(it.c, it.r), it.style ?? line);
        break;
    }
  }
  // the frame: the room, for a layout of fixed slots; for one centred in the room, the left edge of
  // what it drew (its layout, not its ink) or of the title
  const left = anchor === "room" ? 0 : Math.min(b.x, t ? (inner.w - t.w) / 2 : Infinity);
  return s.finish(inner, LECTURE_PACE.diagram, size, { x: left, y: 0 });
}

/** Room for the drawing under a title at level k. */
export function roomUnder(title: string | undefined, box: { w: number; h: number }, k: number): { w: number; h: number } | null {
  const inner = innerBox(box);
  if (!title) return inner;
  const t = fitTitle(title, inner.w, k);
  return t ? { w: inner.w, h: inner.h - t.h - TITLE_GAP } : null;
}
