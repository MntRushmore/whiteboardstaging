import { LabelSchema, LECTURE_LIMITS, LECTURE_SKETCH_LIMITS, SketchDrawingSchema, type LectureInk, type SketchDrawing } from "@/lib/live/lecture/contracts";
import { nearestInk, parsePaint, type Paint } from "./colour";
import {
  apply,
  areaScale,
  bbox,
  clipPolygon,
  clipPolyline,
  dedupe,
  ellipseArcPoints,
  extent,
  IDENTITY,
  inside,
  isFiniteMatrix,
  maxScale,
  multiply,
  numbers,
  parseTransform,
  simplify,
  type Matrix,
  type Pt,
  type Rect,
} from "./geometry";
import { parsePathData, type Subpath } from "./pathData";
import { xmlTokens } from "./xml";

/**
 * The illustrator's SVG → a `SketchDrawing` (the contract's sampled strokes), on the server, so the
 * client never parses markup a model wrote. PURE and bounded: no DOM, nothing evaluated, every loop
 * capped, and whatever the input, it returns (a drawing or null, and the problems in words — the
 * retry tells the model what was wrong).
 *
 * THE SUBSET: the root `svg` (its viewBox, else width/height, else what was drawn), `g` (and `a`,
 * `switch`, a nested `svg`) with `transform` (translate, scale, rotate, skewX/Y, matrix) composed
 * through any depth, `path` (every command), `line`, `polyline`, `polygon`, `rect` (rounded),
 * `circle`, `ellipse`, and `text`/`tspan` (→ labels: plain words, `LabelSchema`). Colours from
 * attributes or `style="…"` (inherited as SVG inherits them), `opacity`, `display`, `visibility`.
 * Everything else — script, style sheets and classes, image, foreignObject, defs/use, gradients,
 * patterns, filters, masks, clip paths, animation — is skipped with its whole subtree.
 *
 * INK: every colour → the nearest marker (`nearestInk`: the palette, black, grey; reds are orange).
 * A filled closed shape is a closed stroke with `fill: true` (the board tints it pale). A shape
 * covering (nearly) the whole canvas is a background or a border and is dropped; white lines are
 * invisible on a whiteboard and dropped too — unless the background they sat on was dark, when
 * they are the drawing, in black.
 *
 * THE BOX: 1000 wide and 1000 / aspect tall (`sketchBox`); the viewBox is fitted into it with its
 * aspect kept and centred (xMidYMid meet, SVG's default), and what lies outside is clipped as a
 * renderer would — unless most of the drawing is outside the viewBox (a model that drew in 0..1000
 * inside a viewBox of 0..100), when the box is fitted to what was drawn instead.
 *
 * THE CAPS (`LECTURE_SKETCH_LIMITS`): curves are flattened within ~0.5 units and every stroke is
 * simplified within `tolerance` (1 unit of the 1000 box by default); when a stroke has too many
 * points it is simplified harder, never cut short; when the drawing has too many points the whole
 * drawing is simplified harder; when it still has too many strokes or points, the smallest shapes
 * go first (a button before a coat).
 */

export const SKETCH_WIDTH = 1000;

/** Input bounds: a reply of a few thousand tokens is ~30k characters; these are far past it. */
export const SVG_LIMITS = {
  chars: 300_000,
  /** elements read (open tags), skipped ones included */
  elements: 5000,
  /** group nesting read; deeper elements are skipped */
  depth: 48,
  /** points before simplification, over the whole drawing (flattening is capped per curve too) */
  rawPoints: 400_000,
} as const;

/** How far up the open elements a close tag looks for its match. */
const CLOSE_SEARCH = 64;
/** A stroke smaller than this (its box's diagonal, drawing units) cannot be seen: dropped. */
const MIN_EXTENT = 2;
/** Fewer strokes than this is not a picture (the route retries). */
export const MIN_USABLE_STROKES = 3;

/**
 * The drawing's box for a frame of `aspect` (width / height): 1000 wide, 1000 / aspect tall (whole
 * units, within the contract's 300..2500). The model is asked to draw in exactly this viewBox.
 */
export function sketchBox(aspect: number): { w: 1000; h: number } {
  const a = Number.isFinite(aspect) && aspect > 0 ? aspect : 4 / 3;
  return { w: SKETCH_WIDTH, h: Math.round(Math.max(300, Math.min(2500, SKETCH_WIDTH / a))) };
}

export interface SvgParseOptions {
  /** width / height of the frame it fills */
  aspect: number;
  /** the simplification tolerance in drawing units (default 1) */
  tolerance?: number;
}

export interface SvgParseStats {
  elements: number;
  shapes: number;
  strokes: number;
  points: number;
  labels: number;
  /** skipped elements by name */
  ignored: Record<string, number>;
  /** small shapes dropped to keep within the caps */
  dropped: number;
  /** the simplification tolerance the drawing ended at */
  tolerance: number;
}

export interface SvgParse {
  drawing: SketchDrawing | null;
  /** what was wrong or left out, in words (for the retry and the log) */
  problems: string[];
  stats: SvgParseStats;
}

// ------------------------------------------------------------------ styles

interface Style {
  fill: Paint | null;
  stroke: Paint | null;
  color: Paint | null;
  strokeWidth: number;
  fillOpacity: number;
  strokeOpacity: number;
  /** the product of `opacity` down the tree (not inherited in SVG, but a group's applies to its children) */
  opacity: number;
  hidden: boolean;
}

const ROOT_STYLE: Style = { fill: null, stroke: null, color: null, strokeWidth: 1, fillOpacity: 1, strokeOpacity: 1, opacity: 1, hidden: false };

/** `style="stroke: #333; fill:none"` as properties (lower-cased names; `!important` dropped). */
function styleProps(style: string | undefined): Record<string, string> {
  const out = Object.create(null) as Record<string, string>;
  if (!style) return out;
  for (const decl of style.slice(0, 4000).split(";")) {
    const at = decl.indexOf(":");
    if (at < 0) continue;
    const k = decl.slice(0, at).trim().toLowerCase();
    const v = decl.slice(at + 1).replace(/!important/i, "").trim();
    if (k && v) out[k] = v;
  }
  return out;
}

const opacityOf = (v: string | undefined, fallback: number) => {
  if (v === undefined) return fallback;
  const n = v.trim().endsWith("%") ? parseFloat(v) / 100 : parseFloat(v);
  return Number.isFinite(n) ? Math.max(0, Math.min(1, n)) : fallback;
};

function childStyle(parent: Style, attrs: Record<string, string>): Style {
  const css = styleProps(attrs.style);
  const get = (k: string) => css[k] ?? attrs[k];
  const width = get("stroke-width");
  const w = width === undefined ? NaN : parseFloat(width);
  const display = get("display");
  const visibility = get("visibility");
  return {
    fill: parsePaint(get("fill")) ?? parent.fill,
    stroke: parsePaint(get("stroke")) ?? parent.stroke,
    color: parsePaint(get("color")) ?? parent.color,
    strokeWidth: Number.isFinite(w) ? w : parent.strokeWidth,
    fillOpacity: opacityOf(get("fill-opacity"), parent.fillOpacity),
    strokeOpacity: opacityOf(get("stroke-opacity"), parent.strokeOpacity),
    opacity: parent.opacity * opacityOf(get("opacity"), 1),
    hidden: parent.hidden || display?.trim() === "none" || visibility?.trim() === "hidden" || visibility?.trim() === "collapse",
  };
}

/** A paint as a colour we can ink: `currentColor` through `color`; an unresolvable paint (a gradient) as grey. */
function resolve(p: Paint | null, s: Style, fallback: Paint): Paint {
  const paint = p ?? fallback;
  if (paint.kind === "current") return s.color && s.color.kind === "colour" ? s.color : { kind: "colour", rgb: { r: 0, g: 0, b: 0 }, alpha: 1 };
  if (paint.kind === "unknown") return { kind: "colour", rgb: { r: 159, g: 168, b: 178 }, alpha: 1 };
  return paint;
}

// ------------------------------------------------------------------ elements

/** Elements whose subtree never draws (or must never be read): skipped whole. */
const SKIPPED = new Set([
  "defs", "symbol", "use", "clippath", "mask", "pattern", "marker", "lineargradient", "radialgradient", "filter", "style", "script",
  "foreignobject", "image", "metadata", "title", "desc", "iframe", "video", "audio", "canvas", "animate", "animatetransform",
  "animatemotion", "set", "view", "cursor", "font", "font-face", "glyph", "missing-glyph", "hatch", "mesh", "solidcolor",
]);
const GROUPS = new Set(["g", "a", "switch", "svg"]);
const SHAPES = new Set(["path", "line", "polyline", "polygon", "rect", "circle", "ellipse"]);
const TEXTS = new Set(["text"]);

interface Frame {
  name: string;
  m: Matrix;
  style: Style;
  /** this element's subtree is not drawn */
  skip: boolean;
}

/** One element's geometry in the root's user space, with its paint. */
interface RawShape {
  subpaths: Subpath[];
  style: Style;
  /** rect, circle, ellipse, polygon: closed whatever the path says */
  order: number;
}

interface RawLabel {
  text: string;
  x: number;
  y: number;
  size: number;
  anchor: "start" | "middle" | "end";
}

const num = (v: string | undefined, fallback = 0): number => {
  if (v === undefined) return fallback;
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : fallback;
};

/** A length that may be a percentage of the viewport's width or height. */
const len = (v: string | undefined, of: number, fallback = 0): number => {
  if (v === undefined) return fallback;
  const n = parseFloat(v);
  if (!Number.isFinite(n)) return fallback;
  return v.trim().endsWith("%") ? (n * of) / 100 : n;
};

/** The element's outline(s) in its own coordinates; `tol` is the flattening tolerance there. */
function shapeGeometry(name: string, a: Record<string, string>, tol: number, vp: { w: number; h: number }): Subpath[] {
  switch (name) {
    case "path":
      return a.d ? parsePathData(a.d, tol) : [];
    case "line":
      return [{ points: [[num(a.x1), num(a.y1)], [num(a.x2), num(a.y2)]], closed: false }];
    case "polyline":
    case "polygon": {
      const n = numbers(a.points ?? "", 20_000);
      const pts: Pt[] = [];
      for (let i = 0; i + 1 < n.length; i += 2) pts.push([n[i], n[i + 1]]);
      return pts.length >= 2 ? [{ points: pts, closed: name === "polygon" }] : [];
    }
    case "rect": {
      const x = len(a.x, vp.w);
      const y = len(a.y, vp.h);
      const w = len(a.width, vp.w);
      const h = len(a.height, vp.h);
      if (!(w > 0) || !(h > 0)) return [];
      let rx = a.rx !== undefined ? len(a.rx, vp.w) : NaN;
      let ry = a.ry !== undefined ? len(a.ry, vp.h) : NaN;
      if (!(rx >= 0)) rx = ry >= 0 ? ry : 0;
      if (!(ry >= 0)) ry = rx;
      rx = Math.min(rx, w / 2);
      ry = Math.min(ry, h / 2);
      if (rx <= 0 || ry <= 0) return [{ points: [[x, y], [x + w, y], [x + w, y + h], [x, y + h]], closed: true }];
      // rounded: the four sides and a quarter ellipse at each corner, clockwise from the top-left
      const pts: Pt[] = [[x + rx, y], [x + w - rx, y]];
      pts.push(...ellipseArcPoints(x + w - rx, y + ry, rx, ry, 0, -Math.PI / 2, Math.PI / 2, tol));
      pts.push([x + w, y + h - ry]);
      pts.push(...ellipseArcPoints(x + w - rx, y + h - ry, rx, ry, 0, 0, Math.PI / 2, tol));
      pts.push([x + rx, y + h]);
      pts.push(...ellipseArcPoints(x + rx, y + h - ry, rx, ry, 0, Math.PI / 2, Math.PI / 2, tol));
      pts.push([x, y + ry]);
      pts.push(...ellipseArcPoints(x + rx, y + ry, rx, ry, 0, Math.PI, Math.PI / 2, tol));
      return [{ points: pts, closed: true }];
    }
    case "circle":
    case "ellipse": {
      const cx = len(a.cx, vp.w);
      const cy = len(a.cy, vp.h);
      const rx = name === "circle" ? len(a.r, Math.hypot(vp.w, vp.h) / Math.SQRT2) : len(a.rx, vp.w, NaN);
      const ry = name === "circle" ? rx : len(a.ry, vp.h, NaN);
      const rX = Number.isFinite(rx) ? rx : ry;
      const rY = Number.isFinite(ry) ? ry : rx;
      if (!(rX > 0) || !(rY > 0)) return [];
      const pts: Pt[] = [[cx + rX, cy], ...ellipseArcPoints(cx, cy, rX, rY, 0, 0, 2 * Math.PI, tol)];
      pts.pop(); // the last point is the first again: `closed` joins them
      return [{ points: pts, closed: true }];
    }
  }
  return [];
}

// ------------------------------------------------------------------ labels

/** A text as a label the hand can write: plain words, cut at a word to `LabelSchema`'s length; null when nothing is left. */
export function cleanLabel(text: string): string | null {
  const plain = text.replace(/[\\$<>{}]/g, " ").replace(/\s+/g, " ").trim();
  if (!plain) return null;
  let out = plain;
  if (out.length > LECTURE_LIMITS.label) {
    const words = out.split(" ");
    out = "";
    for (const w of words) {
      const next = out ? `${out} ${w}` : w;
      if (next.length > LECTURE_LIMITS.label) break;
      out = next;
    }
  }
  return LabelSchema.safeParse(out).success ? out : null;
}

// ------------------------------------------------------------------ the walk

interface Walk {
  root: { viewBox: Rect | null; w: number | null; h: number | null } | null;
  shapes: RawShape[];
  labels: RawLabel[];
  ignored: Record<string, number>;
  elements: number;
  truncated: boolean;
  rawPoints: number;
}

function walk(svg: string, tolFor: (m: Matrix) => number, setViewport: (vb: Rect | null, w: number | null, h: number | null) => void): Walk {
  const out: Walk = { root: null, shapes: [], labels: [], ignored: {}, elements: 0, truncated: false, rawPoints: 0 };
  const stack: Frame[] = [];
  let vp = { w: SKETCH_WIDTH, h: SKETCH_WIDTH };
  let text: { frame: Frame; attrs: Record<string, string>; parts: string[]; x?: number; y?: number } | null = null;
  const ignore = (name: string) => {
    out.ignored[name] = (out.ignored[name] ?? 0) + 1;
  };

  for (const tok of xmlTokens(svg.length > SVG_LIMITS.chars ? svg.slice(0, SVG_LIMITS.chars) : svg)) {
    if (tok.type === "text") {
      if (text && !stack[stack.length - 1]?.skip) text.parts.push(tok.text);
      continue;
    }
    if (tok.type === "close") {
      // pop to the matching open tag, looked for among the innermost few (a flood of stray close
      // tags against a deep stack must not be quadratic); a close tag with none is ignored
      let at = stack.length - 1;
      const floor = Math.max(0, stack.length - CLOSE_SEARCH);
      while (at >= floor && stack[at].name !== tok.name) at--;
      if (at < floor) continue;
      while (stack.length > at) {
        const f = stack.pop()!;
        if (text && f === text.frame) finishText();
      }
      continue;
    }
    // an open tag
    if (++out.elements > SVG_LIMITS.elements) {
      out.truncated = true;
      break;
    }
    const parent = stack[stack.length - 1];
    const name = tok.name;
    const push = (f: Frame) => {
      if (!tok.selfClosing) stack.push(f);
    };
    if (parent?.skip || stack.length >= SVG_LIMITS.depth) {
      if (!parent?.skip) ignore("(nested too deep)");
      push({ name, m: IDENTITY, style: ROOT_STYLE, skip: true });
      continue;
    }
    const style = childStyle(parent?.style ?? ROOT_STYLE, tok.attrs);
    if (name === "svg" && !out.root) {
      const vb = numbers(tok.attrs.viewbox ?? "", 4);
      const viewBox = vb.length === 4 && vb[2] > 0 && vb[3] > 0 && vb.every(Number.isFinite) ? { x0: vb[0], y0: vb[1], x1: vb[0] + vb[2], y1: vb[1] + vb[3] } : null;
      const w = parseFloat(tok.attrs.width ?? "");
      const h = parseFloat(tok.attrs.height ?? "");
      const size = { w: Number.isFinite(w) && w > 0 && !/%/.test(tok.attrs.width ?? "") ? w : null, h: Number.isFinite(h) && h > 0 && !/%/.test(tok.attrs.height ?? "") ? h : null };
      out.root = { viewBox, ...size };
      if (viewBox) vp = { w: viewBox.x1 - viewBox.x0, h: viewBox.y1 - viewBox.y0 };
      else if (size.w && size.h) vp = { w: size.w, h: size.h };
      setViewport(viewBox, size.w, size.h);
      push({ name, m: IDENTITY, style, skip: false });
      continue;
    }
    const own = parseTransform(tok.attrs.transform);
    let m = multiply(parent?.m ?? IDENTITY, own);
    if (name === "svg") m = multiply(m, [1, 0, 0, 1, num(tok.attrs.x), num(tok.attrs.y)]); // a nested svg: placed at x, y
    const usable = isFiniteMatrix(m) && areaScale(m) > 1e-12;
    if (GROUPS.has(name)) {
      push({ name, m, style, skip: style.hidden || !usable || style.opacity <= 0.02 });
      continue;
    }
    if (SHAPES.has(name)) {
      // a shape's children (a <title>, an <animate>) never draw
      push({ name, m, style, skip: true });
      if (style.hidden || !usable || style.opacity <= 0.02) continue;
      if (out.rawPoints > SVG_LIMITS.rawPoints) {
        out.truncated = true;
        continue;
      }
      const local = shapeGeometry(name, tok.attrs, tolFor(m), vp);
      const subpaths: Subpath[] = [];
      for (const sp of local) {
        const pts = sp.points.map((p) => apply(m, p));
        if (!pts.every((p) => Number.isFinite(p[0]) && Number.isFinite(p[1]))) continue;
        out.rawPoints += pts.length;
        subpaths.push({ points: pts, closed: sp.closed || name === "polygon" || name === "rect" || name === "circle" || name === "ellipse" });
      }
      if (subpaths.length) out.shapes.push({ subpaths, style, order: out.shapes.length });
      continue;
    }
    if (TEXTS.has(name)) {
      if (text) finishText();
      const frame: Frame = { name, m, style, skip: style.hidden || !usable };
      if (tok.selfClosing) continue;
      stack.push(frame);
      const xs = numbers(tok.attrs.x ?? "", 1);
      const ys = numbers(tok.attrs.y ?? "", 1);
      text = { frame, attrs: tok.attrs, parts: [], x: xs[0], y: ys[0] };
      continue;
    }
    if (name === "tspan" || name === "textpath") {
      if (text) {
        // a tspan's own position counts when the text has none
        const xs = numbers(tok.attrs.x ?? "", 1);
        const ys = numbers(tok.attrs.y ?? "", 1);
        if (text.x === undefined && xs.length) text.x = xs[0];
        if (text.y === undefined && ys.length) text.y = ys[0];
        push({ name, m: parent!.m, style, skip: style.hidden });
      } else {
        ignore(name);
        push({ name, m, style, skip: true });
      }
      continue;
    }
    ignore(SKIPPED.has(name) ? name : name.slice(0, 24));
    push({ name, m, style, skip: true });
  }
  if (text) finishText();
  return out;

  function finishText() {
    const t = text!;
    text = null;
    if (t.frame.skip) return;
    const words = cleanLabel(t.parts.join(" "));
    if (!words) return;
    const css = styleProps(t.attrs.style);
    const fontSize = num(css["font-size"] ?? t.attrs["font-size"], 16);
    const anchorRaw = (css["text-anchor"] ?? t.attrs["text-anchor"] ?? "start").trim();
    const anchor = anchorRaw === "middle" || anchorRaw === "end" ? anchorRaw : "start";
    const [x, y] = apply(t.frame.m, [t.x ?? 0, t.y ?? 0]);
    const size = Math.max(1, fontSize) * Math.sqrt(areaScale(t.frame.m));
    if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(size)) return;
    out.labels.push({ text: words, x, y, size, anchor });
  }
}

// ------------------------------------------------------------------ fitting, inking, caps

interface Stroke {
  points: Pt[];
  closed: boolean;
  color: LectureInk;
  fill: boolean;
  /** the shape it belongs to, and that shape's size (the smallest go first) */
  shape: number;
  shapeExtent: number;
}

const round1 = (n: number) => Math.round(n * 10) / 10;

/** A fit of `from` (user space) into the box, aspect kept and centred. */
function fitMatrix(from: Rect, box: { w: number; h: number }): Matrix {
  const fw = Math.max(from.x1 - from.x0, 1e-9);
  const fh = Math.max(from.y1 - from.y0, 1e-9);
  const s = Math.min(box.w / fw, box.h / fh);
  return [s, 0, 0, s, (box.w - fw * s) / 2 - from.x0 * s, (box.h - fh * s) / 2 - from.y0 * s];
}

/** A polygon's area (shoelace), unsigned. */
function polygonArea(points: readonly Pt[]): number {
  let a = 0;
  for (let i = 0; i < points.length; i++) {
    const [x0, y0] = points[i];
    const [x1, y1] = points[(i + 1) % points.length];
    a += x0 * y1 - x1 * y0;
  }
  return Math.abs(a) / 2;
}

function lightness(p: Paint): number {
  if (p.kind !== "colour") return 1;
  const { r, g, b } = p.rgb;
  return (Math.max(r, g, b) + Math.min(r, g, b)) / 510;
}

/**
 * Parses the SVG and samples it into the contract's drawing. Never throws: a hopeless input is
 * `{ drawing: null, problems: [why] }`.
 */
export function svgToDrawing(svg: string, opts: SvgParseOptions): SvgParse {
  const tol = opts.tolerance ?? 1;
  const box = sketchBox(opts.aspect);
  const problems: string[] = [];
  const stats: SvgParseStats = { elements: 0, shapes: 0, strokes: 0, points: 0, labels: 0, ignored: {}, dropped: 0, tolerance: tol };
  if (typeof svg !== "string" || !svg.trim()) return { drawing: null, problems: ["the reply was empty"], stats };

  // flatten curves finely for the scale the viewBox will be drawn at (the simplification below
  // takes out what is not needed); before the root is read, as if user units were drawing units
  let unitScale = 1;
  const setViewport = (vb: Rect | null, w: number | null, h: number | null) => {
    const vw = vb ? vb.x1 - vb.x0 : w;
    const vh = vb ? vb.y1 - vb.y0 : h;
    if (vw && vh) unitScale = Math.min(box.w / vw, box.h / vh);
  };
  const tolFor = (m: Matrix) => (tol * 0.5) / Math.max(1e-9, maxScale(m) * unitScale);
  const w = walk(svg, tolFor, setViewport);
  stats.elements = w.elements;
  stats.ignored = w.ignored;
  stats.shapes = w.shapes.length;
  if (w.truncated) problems.push(`the drawing is too big: only the first ${SVG_LIMITS.elements} elements were read`);
  const skipped = Object.entries(w.ignored).filter(([k]) => !["title", "desc", "metadata"].includes(k));
  if (skipped.length) problems.push(`ignored (not drawable): ${skipped.map(([k, n]) => `<${k}>${n > 1 ? ` ×${n}` : ""}`).join(", ")}`);
  if (!w.root) problems.push("no <svg> element: read what was there");
  if (!w.shapes.length) {
    problems.push("nothing to draw: no path, line, polyline, polygon, rect, circle or ellipse");
    return { drawing: null, problems, stats };
  }

  // the viewBox (else width × height from 0, 0); what was drawn when there is neither, or when
  // most of the drawing lies outside it
  const all = w.shapes.flatMap((s) => s.subpaths.flatMap((sp) => sp.points));
  const drawn = bbox(all);
  let view: Rect | null = w.root?.viewBox ?? (w.root?.w && w.root.h ? { x0: 0, y0: 0, x1: w.root.w, y1: w.root.h } : null);
  /** the canvas is the model's own (a background there is a background, not the subject) */
  let ownCanvas = view !== null;
  if (view) {
    // outside by both measures: most of its points, and most of its extent (a long line running a
    // little past the edges has few points inside and is still in the picture)
    const inView = all.filter((p) => inside(p, view!)).length;
    const overlap = (a0: number, a1: number, b0: number, b1: number) => (a1 - a0 > 1e-9 ? Math.max(0, Math.min(a1, b1) - Math.max(a0, b0)) / (a1 - a0) : a0 >= b0 && a0 <= b1 ? 1 : 0);
    const shared = overlap(drawn.x0, drawn.x1, view.x0, view.x1) * overlap(drawn.y0, drawn.y1, view.y0, view.y1);
    if (inView < all.length * 0.6 && shared < 0.5) {
      problems.push("most of the drawing is outside its viewBox: fitted to what was drawn");
      view = null;
      ownCanvas = false;
    }
  }
  if (!view) {
    const pad = Math.max(drawn.x1 - drawn.x0, drawn.y1 - drawn.y0) * 0.04 || 1;
    view = { x0: drawn.x0 - pad, y0: drawn.y0 - pad, x1: drawn.x1 + pad, y1: drawn.y1 + pad };
  }
  const fit = fitMatrix(view, box);
  const clip: Rect = { x0: 0, y0: 0, x1: box.w, y1: box.h };
  const vb = { x0: apply(fit, [view.x0, view.y0])[0], y0: apply(fit, [view.x0, view.y0])[1], x1: apply(fit, [view.x1, view.y1])[0], y1: apply(fit, [view.x1, view.y1])[1] };

  // backgrounds and borders: a closed shape over (nearly) the whole of the model's canvas — its box
  // reaching every edge and its area most of the canvas (a planet drawn edge to edge is a circle, and stays)
  const fitted = w.shapes.map((s) => ({ ...s, subpaths: s.subpaths.map((sp) => ({ points: sp.points.map((p) => apply(fit, p)), closed: sp.closed })) }));
  let darkBackground = false;
  const canvasArea = (vb.x1 - vb.x0) * (vb.y1 - vb.y0);
  const kept = fitted.filter((s) => {
    if (!ownCanvas) return true;
    const b = bbox(s.subpaths.flatMap((sp) => sp.points));
    const covers = b.x0 <= vb.x0 + (vb.x1 - vb.x0) * 0.04 && b.x1 >= vb.x1 - (vb.x1 - vb.x0) * 0.04 && b.y0 <= vb.y0 + (vb.y1 - vb.y0) * 0.04 && b.y1 >= vb.y1 - (vb.y1 - vb.y0) * 0.04;
    if (!covers) return true;
    const area = Math.max(0, ...s.subpaths.filter((sp) => sp.closed).map((sp) => polygonArea(sp.points)));
    if (area < canvasArea * 0.8) return true;
    const fill = resolve(s.style.fill, s.style, { kind: "colour", rgb: { r: 0, g: 0, b: 0 }, alpha: 1 });
    if (fill.kind === "colour" && lightness(fill) < 0.35 && s.style.fillOpacity * s.style.opacity > 0.5) darkBackground = true;
    return false;
  });
  if (kept.length < fitted.length) problems.push("dropped a background or a border (the board draws on white, inside its own frame)");

  // ink
  let strokes: Stroke[] = [];
  for (const s of kept) {
    const st = s.style;
    const strokePaint = resolve(st.stroke, st, { kind: "none" });
    const fillPaint = resolve(st.fill, st, { kind: "colour", rgb: { r: 0, g: 0, b: 0 }, alpha: 1 });
    const strokeOn = strokePaint.kind === "colour" && st.strokeWidth > 0 && strokePaint.alpha * st.strokeOpacity * st.opacity > 0.05;
    const fillOn = fillPaint.kind === "colour" && fillPaint.alpha * st.fillOpacity * st.opacity > 0.05;
    const lineInk = strokeOn && strokePaint.kind === "colour" ? nearestInk(strokePaint.rgb) : null;
    const fillInk = fillOn && fillPaint.kind === "colour" ? nearestInk(fillPaint.rgb) : null;
    const line: LectureInk | null = lineInk === "white" ? (darkBackground ? "black" : null) : lineInk;
    const tint: LectureInk | null = fillInk === "white" ? (darkBackground && !line ? "black" : null) : fillInk;
    // one ink per stroke: the line's, except a black or grey outline round a coloured fill, which
    // keeps the fill's colour (a blue coat outlined in black is a blue coat)
    const neutral = (c: LectureInk | null) => c === "black" || c === "grey";
    const color: LectureInk | null = line && !(neutral(line) && tint && !neutral(tint)) ? line : (tint ?? line);
    if (!color) continue;
    const shapeExtent = extent(s.subpaths.flatMap((sp) => sp.points));
    for (const sp of s.subpaths) {
      let closed = sp.closed;
      let pts = dedupe(sp.points);
      if (closed && pts.length > 2) {
        const [f, l] = [pts[0], pts[pts.length - 1]];
        if (Math.hypot(f[0] - l[0], f[1] - l[1]) < 1e-6) pts = pts.slice(0, -1);
      }
      const e = extent(pts);
      // a filled open subpath is filled as if closed; one with a line keeps its gap unless it is small
      if (!closed && tint && pts.length > 2) {
        const gap = Math.hypot(pts[0][0] - pts[pts.length - 1][0], pts[0][1] - pts[pts.length - 1][1]);
        if (!line || gap < e * 0.1) closed = true;
      }
      const fill = Boolean(tint) && closed;
      if (!line && !fill) continue; // an unfilled piece with no line: nothing to see
      const base = { color, shape: s.order, shapeExtent };
      if (pts.every((p) => inside(p, clip))) strokes.push({ ...base, points: pts, closed, fill });
      else if (fill) {
        // a filled shape keeps its fill: clipped as a polygon, closed along the box's edge
        const poly = clipPolygon(pts, clip);
        if (poly.length >= 3) strokes.push({ ...base, points: poly, closed: true, fill: true });
      } else {
        // a line leaving the box is cut there, never drawn along the edge
        for (const run of clipPolyline(closed ? [...pts, pts[0]] : pts, clip)) strokes.push({ ...base, points: run, closed: false, fill: false });
      }
    }
  }

  // labels: centred at (x, y) as the hand writes them; SVG's y is the baseline
  const labelFit = Math.sqrt(areaScale(fit));
  let labels = w.labels
    .map((l) => {
      const [x, y] = apply(fit, [l.x, l.y]);
      const size = l.size * labelFit;
      const width = 0.55 * size * l.text.length;
      const cx = l.anchor === "middle" ? x : l.anchor === "end" ? x - width / 2 : x + width / 2;
      return { text: l.text, x: cx, y: y - 0.35 * size, size, half: Math.min(width / 2, box.w / 2), at: [x, y] };
    })
    // where the model put it (its anchor) must be in the picture
    .filter(({ at: [x, y] }) => x >= -box.w * 0.05 && x <= box.w * 1.05 && y >= -box.h * 0.05 && y <= box.h * 1.05)
    // a label a model set against the edge (or past it) is moved in until its words fit the box
    .map((l) => ({ text: l.text, x: round1(Math.max(l.half, Math.min(box.w - l.half, l.x))), y: round1(Math.max(0, Math.min(box.h, l.y))), size: round1(Math.max(10, Math.min(200, l.size))) }));
  if (labels.length > LECTURE_SKETCH_LIMITS.labels) {
    // the largest words stay (a name on a sign before a footnote)
    const keep = new Set([...labels].sort((a, b) => b.size - a.size).slice(0, LECTURE_SKETCH_LIMITS.labels));
    labels = labels.filter((l) => keep.has(l));
    problems.push(`more than ${LECTURE_SKETCH_LIMITS.labels} labels: the smallest were left out`);
  }

  // simplify; then the caps, the smallest details first
  const capped = capStrokes(strokes, tol);
  strokes = capped.strokes;
  stats.dropped = capped.dropped;
  stats.tolerance = capped.tolerance;
  if (capped.dropped) problems.push(`too detailed for the board: ${capped.dropped} of the smallest details left out`);
  if (!strokes.length) {
    problems.push("nothing visible: every shape was unpainted, white, too small, or outside the viewBox");
    return { drawing: null, problems, stats };
  }

  const drawing = SketchDrawingSchema.safeParse({
    w: box.w,
    h: box.h,
    strokes: strokes.map((s) => ({ points: s.points.map(([x, y]) => [round1(x), round1(y)]), closed: s.closed, color: s.color, fill: s.fill })),
    labels,
  });
  if (!drawing.success) {
    problems.push(`the drawing did not validate: ${drawing.error.issues[0]?.message ?? "invalid"}`);
    return { drawing: null, problems, stats };
  }
  stats.strokes = drawing.data.strokes.length;
  stats.points = drawing.data.strokes.reduce((n, s) => n + s.points.length, 0);
  stats.labels = drawing.data.labels.length;
  return { drawing: drawing.data, problems, stats };
}

/**
 * Every stroke simplified within `tol`; a stroke past `pointsPerStroke` simplified harder until it
 * fits (never cut); the drawing past `points` simplified harder as a whole (up to 8×); then, while
 * there are too many strokes or points, the smallest shapes are dropped whole.
 */
export function capStrokes<S extends { points: Pt[]; closed: boolean; shape: number; shapeExtent: number }>(input: readonly S[], tol: number): { strokes: S[]; dropped: number; tolerance: number } {
  const L = LECTURE_SKETCH_LIMITS;
  const simplifyStroke = (s: S, t: number): S => {
    let pts = simplify(s.points, t);
    let tt = t;
    while (pts.length > L.pointsPerStroke && tt < 1e4) {
      tt *= 2;
      pts = simplify(s.points, tt);
    }
    if (pts.length > L.pointsPerStroke) pts = resample(pts, L.pointsPerStroke);
    return { ...s, points: pts };
  };
  const visible = (s: S) => s.points.length >= 2 && extent(s.points) >= MIN_EXTENT;
  let t = tol;
  let strokes = input.map((s) => simplifyStroke(s, t)).filter(visible);
  const total = (ss: readonly S[]) => ss.reduce((n, s) => n + s.points.length, 0);
  while (total(strokes) > L.points && t < tol * 8) {
    t *= 2;
    strokes = input.map((s) => simplifyStroke(s, t)).filter(visible);
  }
  let dropped = 0;
  if (strokes.length > L.strokes || total(strokes) > L.points) {
    // the smallest shapes first (a shape's strokes together), later ones first among equals
    const order = strokes.map((s, i) => ({ s, i })).sort((a, b) => a.s.shapeExtent - b.s.shapeExtent || b.s.shape - a.s.shape || b.i - a.i);
    const gone = new Set<number>();
    let count = strokes.length;
    let points = total(strokes);
    for (const { s, i } of order) {
      if (count <= L.strokes && points <= L.points) break;
      gone.add(i);
      count--;
      points -= s.points.length;
    }
    dropped = gone.size;
    strokes = strokes.filter((_, i) => !gone.has(i));
  }
  return { strokes, dropped, tolerance: t };
}

/** `n` points evenly spaced along the polyline (its ends kept): the last resort for a stroke too long to simplify. */
function resample(points: readonly Pt[], n: number): Pt[] {
  const d: number[] = [0];
  for (let i = 1; i < points.length; i++) d.push(d[i - 1] + Math.hypot(points[i][0] - points[i - 1][0], points[i][1] - points[i - 1][1]));
  const total = d[d.length - 1];
  if (!(total > 0)) return [points[0], points[points.length - 1]];
  const out: Pt[] = [];
  let j = 0;
  for (let k = 0; k < n; k++) {
    const at = (total * k) / (n - 1);
    while (j < d.length - 2 && d[j + 1] < at) j++;
    const seg = d[j + 1] - d[j] || 1;
    const t = Math.max(0, Math.min(1, (at - d[j]) / seg));
    out.push([points[j][0] + (points[j + 1][0] - points[j][0]) * t, points[j][1] + (points[j + 1][1] - points[j][1]) * t]);
  }
  return out;
}

// ------------------------------------------------------------------ the model's reply

/**
 * The SVG in a model's reply: `{"svg": "<svg…"}` (the JSON we ask for), a fenced block, or bare
 * markup with prose round it. A reply cut off mid-way is still returned (what is whole is drawn).
 * Null when there is no markup at all.
 */
export function extractSvg(reply: string): string | null {
  if (typeof reply !== "string" || !reply.trim()) return null;
  let text = reply.replace(/```(?:svg|xml|json|html)?/gi, "").trim();
  if (text.startsWith("{")) {
    try {
      const obj = JSON.parse(text.slice(0, text.lastIndexOf("}") + 1)) as unknown;
      if (obj && typeof obj === "object" && typeof (obj as { svg?: unknown }).svg === "string") return (obj as { svg: string }).svg;
    } catch {
      // cut off, or escaped badly: read the markup out of the string below
    }
  }
  // a JSON string may escape its angle brackets (\u003c)
  if (!/<svg[\s>]/i.test(text) && /\\u003c/i.test(text)) text = text.replace(/\\u([0-9a-fA-F]{4})/g, (_, h: string) => String.fromCharCode(parseInt(h, 16)));
  const start = text.search(/<svg[\s>]/i);
  const from = start >= 0 ? start : text.search(/<(path|g|circle|rect|ellipse|line|polyline|polygon)[\s>/]/i);
  if (from < 0) return null;
  const endAt = text.toLowerCase().lastIndexOf("</svg>");
  let svg = endAt > from ? text.slice(from, endAt + 6) : text.slice(from);
  // markup lifted out of a JSON string that did not parse: its escapes undone
  if (/\\"/.test(svg)) svg = svg.replace(/\\(["\\/nrt])/g, (_, c: string) => (c === "n" ? "\n" : c === "r" ? "\r" : c === "t" ? "\t" : c));
  return svg;
}
