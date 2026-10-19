#!/usr/bin/env node
/**
 * tldraw-reference.mjs — renders every page of a tldraw snapshot to a PNG with tldraw 4.2's OWN
 * ink algorithm, as the reference the Swift renderer (AgathonBoard) is compared against.
 *
 * Run from the worktree root (deterministic):
 *
 *   TLDRAW_NODE_MODULES=/Users/rushilchopra/whiteboardstaging/whiteboardstaging/node_modules \
 *     timeout 300 node ios/Packages/AgathonBoard/Tools/fixtures/tldraw-reference.mjs
 *
 * With no files it renders the four fixtures in Tests/AgathonBoardTests/Fixtures (synthetic-2000:
 * its first 2 pages) to Tests/AgathonBoardTests/Fixtures/reference/<fixture>-p<N>.png and writes
 * reference/manifest.json (each image's viewport, how it was chosen, its size). Options:
 *   --scale S   pixels per page unit (default 1)
 *   --pages N   at most N pages per fixture
 *   --svg       also write the SVG beside each PNG (the exact path data, for numeric comparison)
 *   --out DIR   output directory
 *   file.json…  any tldraw snapshot: {document:{store, schema?}, session?} or {store, schema}
 * Needs `rsvg-convert` (librsvg) on PATH.
 *
 * TLDRAW_NODE_MODULES is another checkout's node_modules (the web app's, tldraw 4.2.0). tldraw is
 * used READ-ONLY from there, for reference rendering only: its code is not copied into the app,
 * the fixtures or this repo. The tldraw package root (and "@tldraw/editor"'s) does not load in Node
 * — the import never returns — so this loads tldraw's freehand files directly from dist-esm and
 * answers their one bare import, "@tldraw/editor", with a small shim (a Node resolve hook) that
 * re-exports only what they use (Vec, EASINGS, PI, SIN, precise, toDomPrecision, average from
 * @tldraw/editor's primitives; modulate, rng, assert from @tldraw/utils), from the same deep paths.
 *
 * What is tldraw's own code here, and what is not:
 *  - draw: DrawShapeUtil's DrawShapeSvg at zoom 1 (as `toSvg` exports): getPointsFromSegments +
 *    getFreehandOptions + svgInk for dash "draw"; the closed fill (ShapeFill over
 *    getSvgPathFromStrokePoints(…, closed)); the solid / dashed / dotted path for other dashes; the
 *    dot; and the random width bump of a one-point non-pen stroke (rng(shape.id)), all tldraw's.
 *  - highlight: HighlightShapeUtil's renderer, its underlay (opacity 0.82, under every shape, as
 *    the export puts backgrounds) and its overlay (0.35, in its place).
 *  - colours: tldraw's light theme (DefaultColorThemePalette.lightMode).
 *  - geo (rectangle / ellipse; others as a rectangle), line, arrow (straight, simple head), text,
 *    image (grey box), and the board's math / graph shapes are drawn SIMPLY by this script so they
 *    show: they are not tldraw's rendering and must not be compared pixel for pixel.
 *  - transforms: x, y, rotation through every parent group; opacity multiplied down the tree.
 *  - viewport: the page's meta.screen, else the screen the board grows around old content
 *    (screenForContent in src/lib/screens/screens.ts: pad 40, union with 0,0,1600,900, keep 16:9,
 *    floor/ceil), over tldraw's own geometry bounds for draw and highlight shapes (text bounds
 *    are estimated). White background.
 */

import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { register } from "node:module";
import { pathToFileURL } from "node:url";

const NM = process.env.TLDRAW_NODE_MODULES;
if (!NM || !fs.existsSync(path.join(NM, "tldraw/package.json"))) {
  console.error("Set TLDRAW_NODE_MODULES to a node_modules directory with tldraw 4.2 installed (see the header).");
  process.exit(2);
}
const f = (p) => pathToFileURL(path.join(NM, p)).href;

// ---------------------------------------------------------------------------------------------
// Load tldraw's freehand code without the "@tldraw/editor" package root
// ---------------------------------------------------------------------------------------------

const shim = `
export { Vec } from ${JSON.stringify(f("@tldraw/editor/dist-esm/lib/primitives/Vec.mjs"))};
export { EASINGS } from ${JSON.stringify(f("@tldraw/editor/dist-esm/lib/primitives/easings.mjs"))};
export { PI, SIN, precise, toDomPrecision, average } from ${JSON.stringify(f("@tldraw/editor/dist-esm/lib/primitives/utils.mjs"))};
export { modulate, rng } from ${JSON.stringify(f("@tldraw/utils/dist-esm/lib/number.mjs"))};
export { assert } from ${JSON.stringify(f("@tldraw/utils/dist-esm/lib/control.mjs"))};
`;
const shimUrl = "data:text/javascript," + encodeURIComponent(shim);
register(
  "data:text/javascript," +
    encodeURIComponent(`export async function resolve(specifier, context, next) {
  if (specifier === "@tldraw/editor") return { url: ${JSON.stringify(shimUrl)}, shortCircuit: true };
  return next(specifier, context);
}`),
);

const TL = "tldraw/dist-esm/lib/shapes";
const { svgInk } = await import(f(`${TL}/shared/freehand/svgInk.mjs`));
const { getStrokePoints } = await import(f(`${TL}/shared/freehand/getStrokePoints.mjs`));
const { setStrokePointRadii } = await import(f(`${TL}/shared/freehand/setStrokePointRadii.mjs`));
const { getStrokeOutlinePoints } = await import(f(`${TL}/shared/freehand/getStrokeOutlinePoints.mjs`));
const { getSvgPathFromStrokePoints } = await import(f(`${TL}/shared/freehand/svg.mjs`));
const { getFreehandOptions, getHighlightFreehandSettings, getPointsFromSegments, getDrawShapeStrokeDashArray } = await import(f(`${TL}/draw/getPath.mjs`));
const { STROKE_SIZES, FONT_SIZES } = await import(f(`${TL}/shared/default-shape-constants.mjs`));
const { rng } = await import(f("@tldraw/utils/dist-esm/lib/number.mjs"));
const { DefaultColorThemePalette } = await import(f("@tldraw/tlschema/dist-esm/styles/TLColorStyle.mjs"));
const TLDRAW_VERSION = JSON.parse(fs.readFileSync(path.join(NM, "tldraw/package.json"), "utf8")).version;

const theme = DefaultColorThemePalette.lightMode;
/** tlschema's getColorValue: a palette name through the theme, anything else as it is */
const colorValue = (color, variant) => (theme[color] ? theme[color][variant] : color);

// ---------------------------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------------------------

const ROOT = process.cwd();
const FIXTURES = path.join(ROOT, "ios/Packages/AgathonBoard/Tests/AgathonBoardTests/Fixtures");
const args = process.argv.slice(2);
let scale = 1;
let maxPages = Infinity;
let writeSvg = false;
let outDir = path.join(FIXTURES, "reference");
const files = [];
for (let i = 0; i < args.length; i++) {
  const a = args[i];
  if (a === "--scale") scale = Number(args[++i]);
  else if (a === "--pages") maxPages = Number(args[++i]);
  else if (a === "--svg") writeSvg = true;
  else if (a === "--out") outDir = path.resolve(args[++i]);
  else files.push({ file: path.resolve(a), pages: maxPages });
}
if (!(scale > 0)) throw new Error("--scale must be > 0");
if (files.length === 0) {
  for (const [name, pages] of [
    ["kid-algebra.tldraw.json", Infinity],
    ["legacy-noscreen.tldraw.json", Infinity],
    ["synthetic-2000.tldraw.json", 2],
    ["legacy-small.tldraw.json", Infinity],
  ]) {
    files.push({ file: path.join(FIXTURES, name), pages: Math.min(pages, maxPages) });
  }
}
fs.mkdirSync(outDir, { recursive: true });

// ---------------------------------------------------------------------------------------------
// Matrices (SVG order: [a c e; b d f])
// ---------------------------------------------------------------------------------------------

const I = [1, 0, 0, 1, 0, 0];
const mul = (m, n) => [
  m[0] * n[0] + m[2] * n[1],
  m[1] * n[0] + m[3] * n[1],
  m[0] * n[2] + m[2] * n[3],
  m[1] * n[2] + m[3] * n[3],
  m[0] * n[4] + m[2] * n[5] + m[4],
  m[1] * n[4] + m[3] * n[5] + m[5],
];
const local = (s) => {
  const c = Math.cos(s.rotation || 0);
  const sn = Math.sin(s.rotation || 0);
  return [c, sn, -sn, c, s.x, s.y];
};
const apply = (m, p) => ({ x: m[0] * p.x + m[2] * p.y + m[4], y: m[1] * p.x + m[3] * p.y + m[5] });
const num = (v) => +v.toFixed(4);
const matrixAttr = (m) => `matrix(${m.map(num).join(" ")})`;
const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

// ---------------------------------------------------------------------------------------------
// Shapes
// ---------------------------------------------------------------------------------------------

const lastOf = (a) => a[a.length - 1];

/** ShapeFill.mjs */
function shapeFill(d, color, fill) {
  switch (fill) {
    case "solid":
      return `<path fill="${colorValue(color, "semi")}" d="${d}"/>`;
    case "semi":
      return `<path fill="${theme.solid}" d="${d}"/>`;
    case "fill":
      return `<path fill="${colorValue(color, "fill")}" d="${d}"/>`;
    case "pattern": // tldraw adds a hatch over this; the hatch is left out here
      return `<path fill="${colorValue(color, "pattern")}" d="${d}"/>`;
    case "lined-fill":
      return `<path fill="${colorValue(color, "linedFill")}" d="${d}"/>`;
    default:
      return "";
  }
}

/** DrawShapeUtil.mjs getDot */
function getDot(point, sw) {
  const r = (sw + 1) * 0.5;
  return `M ${point.x} ${point.y} m -${r}, 0 a ${r},${r} 0 1,0 ${r * 2},0 a ${r},${r} 0 1,0 -${r * 2},0`;
}

/** DrawShapeUtil.mjs DrawShapeSvg at zoom 1 (zoomOverride 1, as toSvg exports) */
function drawSvg(shape) {
  const { props } = shape;
  const zoom = 1;
  const allPointsFromSegments = getPointsFromSegments(props.segments);
  if (allPointsFromSegments.length === 0) return "";
  const showAsComplete = props.isComplete || lastOf(props.segments)?.type === "straight";
  let sw = (STROKE_SIZES[props.size] + 1) * props.scale;
  const forceSolid = zoom < 0.5 && zoom < 1.5 / sw;
  const dotAdjustment = zoom < 0.2 ? 0 : 0.1;
  if (!forceSolid && !props.isPen && props.dash === "draw" && allPointsFromSegments.length === 1) {
    sw += rng(shape.id)() * (sw / 6);
  }
  const options = getFreehandOptions(props, sw, showAsComplete, forceSolid);
  const solid = colorValue(props.color, "solid");
  if (!forceSolid && props.dash === "draw") {
    let out = "";
    if (props.isClosed && props.fill && allPointsFromSegments.length > 1) {
      out += shapeFill(getSvgPathFromStrokePoints(getStrokePoints(allPointsFromSegments, options), props.isClosed), props.color, props.isClosed ? props.fill : "none");
    }
    out += `<path d="${svgInk(allPointsFromSegments, options)}" stroke-linecap="round" fill="${solid}"/>`;
    return out;
  }
  const strokePoints = getStrokePoints(allPointsFromSegments, options);
  const isDot = strokePoints.length < 2;
  const d = isDot ? getDot(allPointsFromSegments[0], 0) : getSvgPathFromStrokePoints(strokePoints, props.isClosed);
  const dash = isDot ? "none" : getDrawShapeStrokeDashArray(shape, sw, dotAdjustment);
  return (
    shapeFill(d, props.color, isDot || props.isClosed ? props.fill : "none") +
    `<path d="${d}" stroke-linecap="round" fill="${isDot ? solid : "none"}" stroke="${solid}" stroke-width="${sw}"${dash === "none" ? "" : ` stroke-dasharray="${dash}" stroke-dashoffset="0"`}/>`
  );
}

/** HighlightShapeUtil.mjs HighlightRenderer, as toSvg / toBackgroundSvg export it */
function highlightSvg(shape, opacity) {
  const { props } = shape;
  const strokeWidth = FONT_SIZES[props.size] * 1.12 * props.scale;
  const forceSolid = strokeWidth < 1.5;
  const allPointsFromSegments = getPointsFromSegments(props.segments);
  if (allPointsFromSegments.length === 0) return "";
  let sw = strokeWidth;
  if (!forceSolid && !props.isPen && allPointsFromSegments.length === 1) sw += rng(shape.id)() * (sw / 6);
  const options = getHighlightFreehandSettings({ strokeWidth: sw, showAsComplete: props.isComplete || lastOf(props.segments)?.type === "straight" });
  const strokePoints = getStrokePoints(allPointsFromSegments, options);
  const p0 = props.segments[0].points[0];
  const d = strokePoints.length > 1 ? getSvgPathFromStrokePoints(strokePoints, false) : `M ${p0.x} ${p0.y} m -0.1, 0 a 0.1,0.1 0 1,0 0.2,0 a 0.1,0.1 0 1,0 -0.2,0`;
  return `<path d="${d}" stroke-linecap="round" fill="none" stroke="${colorValue(props.color, "highlightSrgb")}" stroke-width="${sw}" opacity="${opacity}"/>`;
}

const MATH_FONT_PX = { s: 18, m: 24, l: 32 };
const MATH_TONES = { muted: "#6b7280", normal: "#111827", accent: "#3b82f6" };
const STATUS = { ok: "#16a34a", warn: "#d97706", solved: "#16a34a", unknown: "#9ca3af", pending: "#9ca3af" };
const FONT = "Helvetica, Arial, sans-serif";

function plainText(rt) {
  if (!rt || !Array.isArray(rt.content)) return [];
  const walk = (n) => (n.type === "text" ? n.text ?? "" : (n.content ?? []).map(walk).join(""));
  return rt.content.map(walk);
}

/** A tiny evaluator for the graph shape's own fixtures: digits, x, + - * / ^ ( ) only. */
function sampler(expr) {
  if (!/^[0-9x+\-*/^(). ]+$/.test(expr)) return null;
  const js = expr.replace(/\^/g, "**").replace(/(\d)x/g, "$1*x").replace(/\)\(/g, ")*(");
  try {
    return new Function("x", `return (${js});`);
  } catch {
    return null;
  }
}

/** Not tldraw's rendering: simple drawings so these shapes show in the reference. */
function simpleSvg(shape) {
  const { props } = shape;
  const sw = (STROKE_SIZES[props.size] ?? 2) * (props.scale ?? 1);
  const solid = colorValue(props.color ?? "black", "solid");
  switch (shape.type) {
    case "geo": {
      const h = props.h + (props.growY ?? 0);
      if (props.geo === "ellipse" || props.geo === "oval") return `<ellipse cx="${props.w / 2}" cy="${h / 2}" rx="${props.w / 2}" ry="${h / 2}" fill="none" stroke="${solid}" stroke-width="${sw}"/>`;
      return `<rect x="0" y="0" width="${props.w}" height="${h}" fill="none" stroke="${solid}" stroke-width="${sw}" stroke-linejoin="round"/>`;
    }
    case "line": {
      const pts = Object.values(props.points).sort((a, b) => (a.index < b.index ? -1 : a.index > b.index ? 1 : 0));
      return `<polyline points="${pts.map((p) => `${p.x},${p.y}`).join(" ")}" fill="none" stroke="${solid}" stroke-width="${sw}" stroke-linecap="round" stroke-linejoin="round"/>`;
    }
    case "arrow": {
      const a = props.start;
      const b = props.end;
      const len = Math.hypot(b.x - a.x, b.y - a.y) || 1;
      const ux = (b.x - a.x) / len;
      const uy = (b.y - a.y) / len;
      let d = `M${a.x},${a.y}`;
      if (props.bend) {
        const mx = (a.x + b.x) / 2 - uy * props.bend * 2;
        const my = (a.y + b.y) / 2 + ux * props.bend * 2;
        d += `Q${mx},${my} ${b.x},${b.y}`;
      } else d += `L${b.x},${b.y}`;
      const head = (tip, dx, dy) => {
        const l = Math.min(len / 3, 8 + sw * 3);
        const c = Math.cos(Math.PI / 6);
        const s = Math.sin(Math.PI / 6);
        return `M${tip.x - l * (dx * c - dy * s)},${tip.y - l * (dy * c + dx * s)}L${tip.x},${tip.y}L${tip.x - l * (dx * c + dy * s)},${tip.y - l * (dy * c - dx * s)}`;
      };
      if (props.arrowheadEnd && props.arrowheadEnd !== "none") d += head(b, ux, uy);
      if (props.arrowheadStart && props.arrowheadStart !== "none") d += head(a, -ux, -uy);
      return `<path d="${d}" fill="none" stroke="${solid}" stroke-width="${sw}" stroke-linecap="round" stroke-linejoin="round"/>`;
    }
    case "text": {
      const fs_ = (FONT_SIZES[props.size] ?? 24) * (props.scale ?? 1);
      return plainText(props.richText)
        .map((line, i) => `<text x="0" y="${num((i + 0.5) * fs_ * 1.35 + fs_ * 0.35)}" font-family="${FONT}" font-size="${fs_}" fill="${solid}">${esc(line)}</text>`)
        .join("");
    }
    case "image":
    case "video":
      return `<rect x="0" y="0" width="${props.w}" height="${props.h}" fill="#d9dce1" stroke="#9ca3af" stroke-width="1"/><path d="M0,0L${props.w},${props.h}M${props.w},0L0,${props.h}" stroke="#b6bcc6" stroke-width="1"/>`;
    case "math": {
      const px = MATH_FONT_PX[props.size] ?? 24;
      const bar = STATUS[props.status] ? `<rect x="0" y="6" width="3" height="${Math.max(0, props.h - 12)}" fill="${STATUS[props.status]}"/>` : "";
      return (
        `<rect x="0" y="0" width="${props.w}" height="${props.h}" rx="6" fill="none" stroke="#d1d5db" stroke-width="1"/>` +
        bar +
        `<text x="10" y="${num(props.h / 2 + px * 0.35)}" font-family="${FONT}" font-size="${px}" fill="${MATH_TONES[props.tone] ?? MATH_TONES.normal}">${esc(props.latex)}</text>`
      );
    }
    case "graph": {
      const head = 22;
      const W = props.w;
      const H = props.h - head;
      const X = (x) => ((x - props.xMin) / (props.xMax - props.xMin)) * W;
      const Y = (y) => head + H - ((y - props.yMin) / (props.yMax - props.yMin)) * H;
      let out = `<rect x="0" y="0" width="${W}" height="${props.h}" fill="#ffffff" stroke="#d1d5db" stroke-width="1"/>`;
      if (props.title) out += `<text x="6" y="16" font-family="${FONT}" font-size="13" fill="#374151">${esc(props.title)}</text>`;
      if (props.grid) {
        let g = "";
        for (let x = Math.ceil(props.xMin); x <= props.xMax; x++) g += `M${num(X(x))},${head}V${head + H}`;
        for (let y = Math.ceil(props.yMin); y <= props.yMax; y++) g += `M0,${num(Y(y))}H${W}`;
        out += `<path d="${g}" stroke="#eef0f3" stroke-width="1"/>`;
      }
      out += `<path d="M${num(X(0))},${head}V${head + H}M0,${num(Y(0))}H${W}" stroke="#9ca3af" stroke-width="1"/>`;
      for (const fn of props.fns ?? []) {
        const fx = sampler(fn.expr);
        if (!fx) continue;
        let d = "";
        let pen = false;
        for (let i = 0; i <= 200; i++) {
          const x = props.xMin + ((props.xMax - props.xMin) * i) / 200;
          const y = fx(x);
          if (!Number.isFinite(y) || y < props.yMin - 50 || y > props.yMax + 50) {
            pen = false;
            continue;
          }
          d += `${pen ? "L" : "M"}${num(X(x))},${num(Y(y))}`;
          pen = true;
        }
        out += `<g><clipPath id="c_${esc(shape.id).replace(/[^A-Za-z0-9_-]/g, "_")}"><rect x="0" y="${head}" width="${W}" height="${H}"/></clipPath><path clip-path="url(#c_${esc(shape.id).replace(/[^A-Za-z0-9_-]/g, "_")})" d="${d}" fill="none" stroke="${colorValue(fn.color, "solid")}" stroke-width="2"/></g>`;
      }
      return out;
    }
    default:
      if (props && typeof props.w === "number" && typeof props.h === "number") {
        return `<rect x="0" y="0" width="${props.w}" height="${props.h}" fill="none" stroke="#d946ef" stroke-width="1" stroke-dasharray="4 4"/>`;
      }
      return "";
  }
}

// ---------------------------------------------------------------------------------------------
// Geometry bounds (for the screen of a page without one)
// ---------------------------------------------------------------------------------------------

/** Local-space vertices of a shape's geometry, or a circle {c, r}. Draw and highlight: tldraw's own. */
function localGeometry(shape) {
  const { props } = shape;
  switch (shape.type) {
    case "draw": {
      // DrawShapeUtil.getGeometry
      const points = getPointsFromSegments(props.segments);
      const sw = (STROKE_SIZES[props.size] + 1) * props.scale;
      if (points.length === 0) return { pts: [] };
      if (props.segments.length === 1) {
        const xs = points.map((p) => p.x);
        const ys = points.map((p) => p.y);
        if (Math.max(...xs) - Math.min(...xs) < sw * 2 && Math.max(...ys) - Math.min(...ys) < sw * 2) return { circle: { c: { x: 0, y: 0 }, r: sw } };
      }
      const strokePoints = getStrokePoints(points, getFreehandOptions(props, sw, props.isPen, true)).map((p) => p.point);
      if (strokePoints.length === 1) return { circle: { c: { x: 0, y: 0 }, r: sw } };
      return { pts: strokePoints };
    }
    case "highlight": {
      // HighlightShapeUtil.getGeometry
      const strokeWidth = FONT_SIZES[props.size] * 1.12 * props.scale;
      if (props.segments.length === 1 && props.segments[0].points.length < 2) return { circle: { c: { x: 0, y: 0 }, r: strokeWidth / 2 } };
      const points = getPointsFromSegments(props.segments);
      const showAsComplete = props.isComplete || lastOf(props.segments)?.type === "straight";
      const strokePoints = getStrokePoints(points, getHighlightFreehandSettings({ strokeWidth, showAsComplete }));
      const opts = getHighlightFreehandSettings({ strokeWidth, showAsComplete: true });
      setStrokePointRadii(strokePoints, opts);
      return { pts: getStrokeOutlinePoints(strokePoints, opts) };
    }
    case "line":
      return { pts: Object.values(props.points) };
    case "arrow": {
      const a = props.start;
      const b = props.end;
      return { pts: [a, b] };
    }
    case "geo": {
      const h = props.h + (props.growY ?? 0);
      if (props.geo === "ellipse" || props.geo === "oval") {
        const pts = [];
        for (let i = 0; i < 64; i++) pts.push({ x: props.w / 2 + (props.w / 2) * Math.cos((i / 64) * Math.PI * 2), y: h / 2 + (h / 2) * Math.sin((i / 64) * Math.PI * 2) });
        return { pts };
      }
      return { pts: [{ x: 0, y: 0 }, { x: props.w, y: 0 }, { x: props.w, y: h }, { x: 0, y: h }] };
    }
    case "text": {
      // ESTIMATED: tldraw measures the text in the DOM
      const fs_ = (FONT_SIZES[props.size] ?? 24) * (props.scale ?? 1);
      const lines = plainText(props.richText);
      const h = Math.max(1, lines.length) * fs_ * 1.35;
      return { pts: [{ x: 0, y: 0 }, { x: props.w, y: 0 }, { x: props.w, y: h }, { x: 0, y: h }] };
    }
    case "group":
      return { pts: [] };
    default:
      if (props && typeof props.w === "number" && typeof props.h === "number") {
        const h = props.h + (props.growY ?? 0);
        return { pts: [{ x: 0, y: 0 }, { x: props.w, y: 0 }, { x: props.w, y: h }, { x: 0, y: h }] };
      }
      return { pts: [{ x: 0, y: 0 }] };
  }
}

/** src/lib/screens/screens.ts screenForContent */
function screenForContent(content) {
  const DEFAULT = { x: 0, y: 0, w: 1600, h: 900 };
  const PAD = 40;
  if (!content || content.w <= 0 || content.h <= 0) return { ...DEFAULT };
  const x0 = Math.min(DEFAULT.x, content.x - PAD);
  const y0 = Math.min(DEFAULT.y, content.y - PAD);
  const x1 = Math.max(DEFAULT.x + DEFAULT.w, content.x + content.w + PAD);
  const y1 = Math.max(DEFAULT.y + DEFAULT.h, content.y + content.h + PAD);
  let w = x1 - x0;
  let h = y1 - y0;
  if (w / h > DEFAULT.w / DEFAULT.h) h = w / (DEFAULT.w / DEFAULT.h);
  else w = h * (DEFAULT.w / DEFAULT.h);
  return { x: Math.floor(x0), y: Math.floor(y0), w: Math.ceil(w), h: Math.ceil(h) };
}

/** src/lib/screens/screens.ts readScreenMeta */
function readScreenMeta(meta) {
  const s = meta && typeof meta === "object" ? meta.screen : null;
  if (!s || typeof s !== "object") return null;
  const ok = (n) => typeof n === "number" && Number.isFinite(n);
  if (!ok(s.x) || !ok(s.y) || !ok(s.w) || !ok(s.h) || s.w <= 0 || s.h <= 0) return null;
  return { x: s.x, y: s.y, w: s.w, h: s.h };
}

// ---------------------------------------------------------------------------------------------
// Pages
// ---------------------------------------------------------------------------------------------

const byIndex = (a, b) => (a.index < b.index ? -1 : a.index > b.index ? 1 : 0);

function renderPage(store, page) {
  const children = new Map();
  for (const r of Object.values(store)) {
    if (r.typeName !== "shape") continue;
    if (!children.has(r.parentId)) children.set(r.parentId, []);
    children.get(r.parentId).push(r);
  }
  for (const list of children.values()) list.sort(byIndex);

  const background = [];
  const foreground = [];
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  let shapeCount = 0;
  const grow = (p) => {
    minX = Math.min(minX, p.x);
    minY = Math.min(minY, p.y);
    maxX = Math.max(maxX, p.x);
    maxY = Math.max(maxY, p.y);
  };
  const walk = (parentId, parentMatrix, parentOpacity) => {
    for (const shape of children.get(parentId) ?? []) {
      const m = mul(parentMatrix, local(shape));
      const opacity = parentOpacity * (shape.opacity ?? 1);
      shapeCount++;
      const g = localGeometry(shape);
      if (g.circle) {
        const c = apply(m, g.circle.c);
        grow({ x: c.x - g.circle.r, y: c.y - g.circle.r });
        grow({ x: c.x + g.circle.r, y: c.y + g.circle.r });
      } else for (const p of g.pts) grow(apply(m, p));
      if (shape.type === "group") {
        walk(shape.id, m, opacity);
        continue;
      }
      const wrap = (body) => (body ? `<g transform="${matrixAttr(m)}"${opacity !== 1 ? ` opacity="${opacity}"` : ""}>${body}</g>` : "");
      if (shape.type === "draw") foreground.push(wrap(drawSvg(shape)));
      else if (shape.type === "highlight") {
        background.push(wrap(highlightSvg(shape, 0.82)));
        foreground.push(wrap(highlightSvg(shape, 0.35)));
      } else foreground.push(wrap(simpleSvg(shape)));
      walk(shape.id, m, opacity); // a frame's children
    }
  };
  walk(page.id, I, 1);

  const stored = readScreenMeta(page.meta);
  const content = Number.isFinite(minX) ? { x: minX, y: minY, w: maxX - minX, h: maxY - minY } : null;
  const view = stored ?? screenForContent(content);
  const W = Math.round(view.w * scale);
  const H = Math.round(view.h * scale);
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="${view.x} ${view.y} ${view.w} ${view.h}">` +
    `<rect x="${view.x}" y="${view.y}" width="${view.w}" height="${view.h}" fill="#ffffff"/>` +
    background.join("") +
    foreground.join("") +
    `</svg>\n`;
  return { svg, view, from: stored ? "meta.screen" : "screenForContent", W, H, shapeCount, content };
}

const manifest = { tldraw: TLDRAW_VERSION, scale, theme: "light", images: [] };
for (const { file, pages: limit } of files) {
  const json = JSON.parse(fs.readFileSync(file, "utf8"));
  const store = json.document?.store ?? json.store;
  if (!store) throw new Error(`${file}: no store`);
  const base = path.basename(file).replace(/\.tldraw\.json$|\.json$/, "");
  const pages = Object.values(store).filter((r) => r.typeName === "page").sort(byIndex);
  for (let i = 0; i < Math.min(pages.length, limit); i++) {
    const r = renderPage(store, pages[i]);
    const name = `${base}-p${i + 1}`;
    const png = path.join(outDir, `${name}.png`);
    const res = spawnSync("rsvg-convert", ["-f", "png", "-o", png], { input: r.svg, maxBuffer: 1 << 30 });
    if (res.status !== 0) throw new Error(`rsvg-convert failed for ${name}: ${res.stderr}`);
    if (writeSvg) fs.writeFileSync(path.join(outDir, `${name}.svg`), r.svg);
    manifest.images.push({
      file: `${name}.png`,
      fixture: path.basename(file),
      page: pages[i].id,
      pageNumber: i + 1,
      viewport: r.view,
      viewportFrom: r.from,
      ...(r.from === "screenForContent" ? { contentBounds: Object.fromEntries(Object.entries(r.content).map(([k, v]) => [k, num(v)])) } : {}),
      pixels: { w: r.W, h: r.H },
      shapes: r.shapeCount,
    });
    console.log(`${path.relative(ROOT, png)}  ${r.W}x${r.H}  viewport ${JSON.stringify(r.view)} (${r.from})  ${r.shapeCount} shapes`);
  }
}
fs.writeFileSync(path.join(outDir, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n");
