#!/usr/bin/env node
/**
 * make-fixtures.mjs — writes the tldraw-format board fixtures the Swift importer and renderer are
 * tested against (Tests/AgathonBoardTests/Fixtures/*.tldraw.json). Every board here is SYNTHETIC:
 * no student's work, no production data, so all of it can be committed.
 *
 * Run from the worktree root (deterministic: the same files byte for byte on every run):
 *
 *   TLDRAW_NODE_MODULES=/Users/rushilchopra/whiteboardstaging/whiteboardstaging/node_modules \
 *     timeout 120 node ios/Packages/AgathonBoard/Tools/fixtures/make-fixtures.mjs
 *
 * then render the references with tldraw-reference.mjs (see its header).
 *
 * TLDRAW_NODE_MODULES is another checkout's node_modules (the web app's, tldraw 4.2.0), used
 * READ-ONLY and only by this tool, never by the app:
 *  - jiti: loads the web app's own pure TypeScript from src/ (the hand engine `src/lib/hand`,
 *    `src/lib/live/{handwriting,marks,placement,inkCompact,strokeClusters}.ts`,
 *    `src/lib/replay/synthetic.ts`), so the tutor's ink is exactly what the web board writes.
 *    handwriting.ts imports `createShapeId` from "tldraw"; that import is aliased to
 *    @tldraw/tlschema (which exports it) because the tldraw package root does not load in Node.
 *  - jittered-fractional-indexing: the index keys tldraw 4.2 really writes ("a1swBWOV"), seeded.
 *  - @tldraw/tlschema + @tldraw/validate: every record is validated with tldraw 4.2's own
 *    validators, and loading each snapshot through tldraw's migrations is checked to be a no-op.
 * No tldraw code is copied into the app or into the fixtures.
 *
 * What it writes (see the reply / docs for counts):
 *  - kid-algebra.tldraw.json      wrapped {document:{store, schema}, session}; 2 screens
 *  - legacy-noscreen.tldraw.json  bare {store, schema}; one page with no meta.screen, ink past 1600x900
 *  - synthetic-2000.tldraw.json   syntheticBoard({ strokes: 2000 }) exactly as it returns it
 *  - legacy-small.tldraw.json     a byte copy of src/shapes/__tests__/fixtures/legacy-board-snapshot.json
 *  - all-shapes.tldraw.json       wrapped; every shape kind the web ever saved (every geo kind, note, text,
 *                                 frame, group, bound / bent / elbow arrows, a cubic line, highlight, inline
 *                                 and cropped images, the retired pipeline's AI overlays, video, embed,
 *                                 bookmark, echo / ai / student math, a graph in hex colours, the tutor's
 *                                 hand and marks with the chat's and the proof's meta keys) on a screen,
 *                                 and a page from before screens (the full converter's fixture, 2026-10-17)
 */

import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { isDeepStrictEqual } from "node:util";
import zlib from "node:zlib";

const NM = process.env.TLDRAW_NODE_MODULES;
if (!NM || !fs.existsSync(path.join(NM, "tldraw/package.json"))) {
  console.error("Set TLDRAW_NODE_MODULES to a node_modules directory with tldraw 4.2 installed (see the header).");
  process.exit(2);
}
const ROOT = process.cwd();
if (!fs.existsSync(path.join(ROOT, "src/lib/hand/index.ts"))) {
  console.error("Run this from the worktree root (the directory with src/lib/hand).");
  process.exit(2);
}
const PKG = path.join(ROOT, "ios/Packages/AgathonBoard");
const OUT = path.join(PKG, "Tests/AgathonBoardTests/Fixtures");
fs.mkdirSync(OUT, { recursive: true });

const fileUrl = (...p) => pathToFileURL(path.join(...p)).href;

// ---------------------------------------------------------------------------------------------
// The web app's pure modules, through jiti
// ---------------------------------------------------------------------------------------------

const { createJiti } = await import(fileUrl(NM, "jiti/lib/jiti.mjs"));
const jiti = createJiti(import.meta.url, {
  alias: { "@": path.join(ROOT, "src"), tldraw: path.join(NM, "@tldraw/tlschema/dist-esm/index.mjs") },
  fsCache: false,
  moduleCache: true,
});
const src = (rel) => jiti.import(path.join(ROOT, rel));

const hand = await src("src/lib/hand/index.ts");
const marks = await src("src/lib/live/marks.ts");
const hw = await src("src/lib/live/handwriting.ts");
const placement = await src("src/lib/live/placement.ts");
const inkCompact = await src("src/lib/live/inkCompact.ts");
const clusters = await src("src/lib/live/strokeClusters.ts");
const synthetic = await src("src/lib/replay/synthetic.ts");

const { generateNKeysBetween } = await import(fileUrl(NM, "jittered-fractional-indexing/dist/index.js"));
const tlschema = await import(fileUrl(NM, "@tldraw/tlschema/dist-esm/index.mjs"));
const { T } = await import(fileUrl(NM, "@tldraw/validate/dist-esm/index.mjs"));

// ---------------------------------------------------------------------------------------------
// Determinism: one seeded generator for ids, index jitter and the kid's hand
// ---------------------------------------------------------------------------------------------

/** mulberry32 */
function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** nanoid's url alphabet, which tldraw's `uniqueId()` (createShapeId, PageRecordType.createId) draws from */
const URL_ALPHABET = "useandom-26T198340PX75pxJACKVERYMINDBUSHWOLF_GQZbfghjklqvwyzrict";

function makeIds(seed) {
  const r = rng(seed);
  const used = new Set();
  return (prefix) => {
    for (;;) {
      let s = "";
      for (let i = 0; i < 21; i++) s += URL_ALPHABET[Math.floor(r() * 64)];
      const id = `${prefix}:${s}`;
      if (!used.has(id)) {
        used.add(id);
        return id;
      }
    }
  };
}

/**
 * Index keys the way tldraw 4.2 writes them: each new shape takes `getIndexAbove(the highest
 * sibling)`, which is a jittered fractional key ("a1swBWOV", "a2n2OVQV", …); the first child of
 * an empty parent is `getIndexAbove("a0")`. `jitter: false` gives the plain keys older boards
 * carry ("a1", "a2", …).
 */
function makeIndexer(seed, jitter = true) {
  const r = rng(seed);
  const getRandomBit = () => r() < 0.5;
  const last = new Map();
  return (parentId) => {
    const below = last.get(parentId) ?? "a0";
    const [key] = jitter ? generateNKeysBetween(below, null, 1, { getRandomBit }) : generateNKeysBetween(below, null, 1, { jitterBits: 0 });
    last.set(parentId, key);
    return key;
  };
}

/** tldraw's toFixed (points are stored to 1/100 px) */
const toFixed = (v) => Math.round(v * 100) / 100;
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

// ---------------------------------------------------------------------------------------------
// Records
// ---------------------------------------------------------------------------------------------

/** STROKE_SIZES from tldraw/dist-esm/lib/shapes/shared/default-shape-constants.mjs */
const STROKE_SIZES = { s: 2, m: 3.5, l: 5, xl: 10 };

function shapeRecord({ id, type, x, y, rotation = 0, index, parentId, isLocked = false, opacity = 1, props, meta = {} }) {
  return { id, typeName: "shape", type, x, y, rotation, index, parentId, isLocked, opacity, props, meta };
}

function pageRecord(id, name, index, meta) {
  return { meta, id, name, index, typeName: "page" };
}

const documentRecord = () => ({ gridSize: 10, name: "", meta: {}, id: "document:document", typeName: "document" });

function richText(text) {
  const paragraphs = text.split("\n");
  return {
    type: "doc",
    content: paragraphs.map((p) => (p ? { type: "paragraph", content: [{ type: "text", text: p }] } : { type: "paragraph" })),
  };
}

function sessionFor(pageIds, currentPageId, camera) {
  return {
    version: 0,
    currentPageId,
    exportBackground: true,
    isFocusMode: false,
    isDebugMode: false,
    isToolLocked: false,
    isGridMode: false,
    pageStates: pageIds.map((pageId) => ({ pageId, camera: { ...camera }, selectedShapeIds: [], focusedGroupId: null })),
  };
}

// ---------------------------------------------------------------------------------------------
// The kid's hand: a polyline in page space -> what tldraw's Drawing state records for it
// ---------------------------------------------------------------------------------------------

/** The board's fit zoom on an iPad in landscape (a 1600 x 900 screen in ~1180 x 760 of board). */
const IPAD_ZOOM = 0.72;

/** Cuts a polyline at its sharp corners, where a real pen slows down to turn. */
function splitAtCorners(pts, minTurnDeg = 55) {
  const pieces = [];
  let cur = [pts[0]];
  for (let i = 1; i < pts.length; i++) {
    cur.push(pts[i]);
    if (i < pts.length - 1) {
      const a = pts[i - 1];
      const b = pts[i];
      const c = pts[i + 1];
      const v1 = { x: b.x - a.x, y: b.y - a.y };
      const v2 = { x: c.x - b.x, y: c.y - b.y };
      const l1 = Math.hypot(v1.x, v1.y);
      const l2 = Math.hypot(v2.x, v2.y);
      if (l1 > 0 && l2 > 0) {
        const cos = (v1.x * v2.x + v1.y * v2.y) / (l1 * l2);
        if (Math.acos(clamp(cos, -1, 1)) * (180 / Math.PI) > minTurnDeg) {
          pieces.push(cur);
          cur = [pts[i]];
        }
      }
    }
  }
  if (cur.length > 1) pieces.push(cur);
  return pieces.length > 0 ? pieces : [pts];
}

function pointAtLength(piece, cum, s) {
  let i = 1;
  while (i < cum.length - 1 && cum[i] < s) i++;
  const span = cum[i] - cum[i - 1];
  const t = span > 0 ? (s - cum[i - 1]) / span : 0;
  return { x: piece[i - 1].x + (piece[i].x - piece[i - 1].x) * t, y: piece[i - 1].y + (piece[i].y - piece[i - 1].y) * t };
}

/** Minimum-jerk position profile: slow off the mark, fast in the middle, slow into the corner. */
const minJerk = (tau) => tau * tau * tau * (10 - 15 * tau + 6 * tau * tau);

/**
 * Samples a hand movement along `pts` the way pointer events arrive: one sample per display frame
 * (`frameMs`), the pen moving at about `speed` px/ms with a minimum-jerk profile on every piece
 * between corners. Returns samples with their arc-length fraction `u`, and the stroke's duration.
 */
function sampleMovement(pts, { frameMs, speed, rand }) {
  const pieces = splitAtCorners(pts);
  const total = pieces.reduce((acc, p) => acc + p.slice(1).reduce((l, q, i) => l + dist(p[i], q), 0), 0) || 1;
  const out = [{ x: pts[0].x, y: pts[0].y, u: 0 }];
  let done = 0;
  let frames = 0;
  for (const piece of pieces) {
    const cum = [0];
    for (let i = 1; i < piece.length; i++) cum.push(cum[i - 1] + dist(piece[i - 1], piece[i]));
    const L = cum[cum.length - 1];
    if (L <= 0) continue;
    const ms = Math.max(frameMs * 2, L / (speed * (0.85 + 0.3 * rand())));
    const n = Math.max(2, Math.round(ms / frameMs));
    for (let k = 1; k <= n; k++) {
      const s = L * minJerk(k / n);
      const p = pointAtLength(piece, cum, s);
      out.push({ ...p, u: (done + s) / total });
    }
    done += L;
    frames += n;
  }
  return { samples: out, durationMs: Math.round(frames * frameMs + 8 + rand() * 10) };
}

/**
 * One stroke as tldraw 4.2's Drawing state stores it (tldraw/dist-esm/lib/shapes/draw/toolStates/Drawing.mjs):
 *  - the shape's x, y is the page point of pen-down, unrounded; the first point is {x: 0, y: 0};
 *  - every other point is `getPointInShapeSpace(...).toFixed()`, i.e. to 1/100 px;
 *  - a pen (Apple Pencil) stores z = +(pressure * 1.25).toFixed(2), and a move of less than
 *    1/zoom px from the last recorded point REPLACES the last point (keeping the higher z);
 *  - a mouse or finger stores z = 0.5 on every point, one point per pointer move;
 *  - isClosed is set when the end comes back within 2 x STROKE_SIZES[size] x scale of the start
 *    on a line longer than 4 x that (getIsClosed).
 */
function recordStroke(polyline, o) {
  const rand = o.rand;
  const pen = o.pen;
  const frameMs = pen ? 1000 / 120 : 1000 / 60;
  const { samples, durationMs } = sampleMovement(polyline, { frameMs, speed: o.speed, rand });
  // pressure: light on touch-down, heavier through the stroke, lifting off at the end
  const base = 0.25 + rand() * 0.06;
  const amp = 0.38 + rand() * 0.1;
  let drift = 0;
  const pressureAt = (u) => {
    drift = clamp(drift + (rand() - 0.5) * 0.03, -0.05, 0.05);
    return base + amp * Math.pow(Math.sin(Math.PI * clamp(u, 0, 1)), 0.6) + drift;
  };
  const zOf = (u) => (pen ? clamp(+(pressureAt(u) * 1.25).toFixed(2), 0.3, 0.9) : 0.5);

  // a mouse / finger position arrives in whole CSS px, i.e. on a 1/zoom grid in page space
  const quant = (p) => (pen ? p : { x: Math.round(p.x * o.zoom) / o.zoom, y: Math.round(p.y * o.zoom) / o.zoom });
  const first = quant(samples[0]);
  const origin = { x: first.x, y: first.y };
  const points = [{ x: 0, y: 0, z: zOf(0) }];
  let lastRecorded = first;
  let prevPage = first;
  let lineLength = 0;
  for (let i = 1; i < samples.length; i++) {
    const page = quant(samples[i]);
    if (!pen && page.x === prevPage.x && page.y === prevPage.y) continue; // no move, no pointermove
    prevPage = page;
    const np = { x: toFixed(page.x - origin.x), y: toFixed(page.y - origin.y), z: zOf(samples[i].u) };
    let merge = false;
    if (pen) {
      if (dist(page, lastRecorded) >= 1 / o.zoom) lastRecorded = page;
      else merge = true;
    }
    const last = points[points.length - 1];
    if (merge && points.length) {
      points[points.length - 1] = { x: np.x, y: np.y, z: last.z ? Math.max(last.z, np.z) : np.z };
    } else {
      lineLength += dist(last, np);
      points.push(np);
    }
  }
  const sw = STROKE_SIZES[o.size] * (o.scale ?? 1);
  const a = points[0];
  const b = points[points.length - 1];
  const isClosed = points.length > 1 && lineLength > sw * 4 && (a.x - b.x) ** 2 + (a.y - b.y) ** 2 < (sw * 2) ** 2;
  return { origin, points, isClosed, durationMs };
}

function drawProps({ color, size, points, isPen, isClosed = false, fill = "none", dash = "draw", scale = 1, segments }) {
  return {
    color,
    fill,
    dash,
    size,
    segments: segments ?? [{ type: "free", points }],
    isComplete: true,
    isClosed,
    isPen,
    scale,
  };
}

/** Page-space bounds of a set of draw records' points (top-level, unrotated shapes). */
function inkBounds(records) {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const r of records) {
    for (const seg of r.props.segments) {
      for (const p of seg.points) {
        minX = Math.min(minX, r.x + p.x);
        minY = Math.min(minY, r.y + p.y);
        maxX = Math.max(maxX, r.x + p.x);
        maxY = Math.max(maxY, r.y + p.y);
      }
    }
  }
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
}

/** A polyline traced by a hand at a fixed density (for shapes the kid draws, not writes). */
function wobbly(points, rand, amount) {
  return points.map((p) => ({ x: p.x + (rand() - 0.5) * amount, y: p.y + (rand() - 0.5) * amount }));
}

function densePath(corners, step) {
  const out = [corners[0]];
  for (let i = 1; i < corners.length; i++) {
    const a = corners[i - 1];
    const b = corners[i];
    const n = Math.max(1, Math.ceil(dist(a, b) / step));
    for (let k = 1; k <= n; k++) out.push({ x: a.x + ((b.x - a.x) * k) / n, y: a.y + ((b.y - a.y) * k) / n });
  }
  return out;
}

function quadPath(p0, p1, p2, n) {
  const out = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const u = 1 - t;
    out.push({ x: u * u * p0.x + 2 * u * t * p1.x + t * t * p2.x, y: u * u * p0.y + 2 * u * t * p1.y + t * t * p2.y });
  }
  return out;
}

function arcPath(cx, cy, rx, ry, a0, a1, n) {
  const out = [];
  for (let i = 0; i <= n; i++) {
    const t = a0 + ((a1 - a0) * i) / n;
    out.push({ x: cx + rx * Math.cos(t), y: cy + ry * Math.sin(t) });
  }
  return out;
}

// ---------------------------------------------------------------------------------------------
// The tutor's hand: exactly what LiveLoop + HandWriter write (src/lib/live/{liveLoop,handwriting}.ts)
// ---------------------------------------------------------------------------------------------

/** liveLoop.ts `makeMeta` */
const makeMeta = (source, lineId, now, extra) => ({ live: true, source, lineId, createdAt: now, ...extra });

function makeTutor(newId) {
  let blockSeq = 0;
  /**
   * HandWriter.start + finish("finishAll"): the plan at ink precision, the block key, and one
   * `handStrokeShape` per stroke with `meta.handLine` (and `meta.handPart` for a sketch's part).
   */
  function write(plan, { meta, extraMeta, parentId, now }) {
    const precision = hw.HAND_WRITE.inkPrecision;
    const blockMeta = { ...meta, ...extraMeta, [hw.HAND_BLOCK_META]: `hb_${++blockSeq}_${now.toString(36)}` };
    const shapes = [];
    for (const line0 of plan.lines) {
      const line = {
        ...line0,
        x: inkCompact.roundInk(line0.x, precision),
        y: inkCompact.roundInk(line0.y, precision),
        strokes: line0.strokes.map((st) => ({ ...st, points: inkCompact.roundInkPoints(st.points, precision) })),
      };
      for (const stroke of line.strokes) {
        const closed = line.style?.closed === true;
        const fill = closed ? (line.style?.fill ?? "none") : "none";
        const partial = hw.handStrokeShape(newId("shape"), line, stroke.points.map((p) => ({ ...p })), {
          color: line.style?.color ?? hw.HAND_WRITE.color,
          fill,
          complete: true,
          closed,
          weight: stroke.weight,
          meta: { ...blockMeta, [hw.HAND_LINE_META]: line.latex, ...(line.part ? { [hw.HAND_PART_META]: line.part } : {}) },
        });
        // the index is taken when the shape is put on the page (`add`), in creation order
        shapes.push(shapeRecord({ ...partial, index: null, parentId }));
      }
    }
    return shapes;
  }

  /** liveLoop.ts `syncMark`: a tick / ring / question mark for a line with these page bounds */
  function mark(kind, at, { lineId, parentId, now }) {
    const want = marks.markKey(kind, at);
    const plan = hw.planFromStrokes(kind, marks.markStrokes(kind, at, hw.handSeedFor(`${lineId}:${want}`)), hw.HAND_WRITE.minSize);
    return write(plan, { meta: makeMeta("ai", lineId, now), extraMeta: { mark: want }, parentId, now });
  }

  return { write, mark };
}

// ---------------------------------------------------------------------------------------------
// tldraw 4.2's schema (+ the board's two custom shapes) for validation
// ---------------------------------------------------------------------------------------------

/** MathShapeUtil.tsx `mathShapeProps` (enums from src/lib/live/contracts.ts) */
const mathProps = {
  w: T.number,
  h: T.number,
  latex: T.string,
  source: T.literalEnum("echo", "ai", "student"),
  status: T.literalEnum("none", "pending", "ok", "warn", "unknown", "solved"),
  resultLatex: T.string,
  note: T.string,
  anchorIds: T.arrayOf(T.string),
  lineId: T.string,
  size: T.literalEnum("s", "m", "l"),
  tone: T.literalEnum("muted", "normal", "accent"),
};
/** GraphShapeUtil.tsx `graphShapeProps` */
const graphProps = {
  w: T.number,
  h: T.number,
  fns: T.arrayOf(T.object({ id: T.string, expr: T.string, latex: T.string, color: T.string })),
  points: T.arrayOf(T.object({ x: T.number, y: T.number, label: T.string })),
  xMin: T.number,
  xMax: T.number,
  yMin: T.number,
  yMax: T.number,
  autoY: T.boolean,
  grid: T.boolean,
  title: T.string,
  lineId: T.string,
};
const boardSchema = tlschema.createTLSchema({
  shapes: {
    ...tlschema.defaultShapeSchemas,
    math: { props: mathProps, migrations: tlschema.createShapePropsMigrationSequence({ sequence: [] }) },
    graph: { props: graphProps, migrations: tlschema.createShapePropsMigrationSequence({ sequence: [] }) },
  },
  bindings: tlschema.defaultBindingSchemas,
});

const legacyFixturePath = path.join(ROOT, "src/shapes/__tests__/fixtures/legacy-board-snapshot.json");
const legacyFixture = JSON.parse(fs.readFileSync(legacyFixturePath, "utf8"));
/** the legacy fixture's schema (a real tldraw 4.2 snapshot) plus the board's math and graph sequences */
const SCHEMA = boardSchema.serialize();
{
  const legacy = legacyFixture.document.schema;
  const extra = Object.keys(SCHEMA.sequences).filter((k) => !(k in legacy.sequences));
  const mismatched = Object.entries(legacy.sequences).filter(([k, v]) => SCHEMA.sequences[k] !== v);
  if (mismatched.length > 0 || extra.join() !== "com.tldraw.shape.math,com.tldraw.shape.graph") {
    throw new Error(`schema drift from the legacy fixture: ${JSON.stringify({ mismatched, extra })}`);
  }
}

/** Every record through tldraw's validators; with a schema, migrating the snapshot must change nothing. */
function check(name, store, schema) {
  for (const rec of Object.values(store)) {
    try {
      boardSchema.validateRecord(null, rec, "initialize", null);
    } catch (e) {
      throw new Error(`${name}: ${rec.id} does not validate: ${e.message}`);
    }
  }
  if (schema) {
    const res = boardSchema.migrateStoreSnapshot({ store: structuredClone(store), schema });
    if (res.type !== "success") throw new Error(`${name}: migration failed: ${res.reason}`);
    if (!isDeepStrictEqual(res.value, store)) throw new Error(`${name}: loading through tldraw's migrations changes records`);
  }
}

// ---------------------------------------------------------------------------------------------
// JSON layout: records pretty, a point list on one line (readable diffs, modest size)
// ---------------------------------------------------------------------------------------------

const isPoint = (v) => v && typeof v === "object" && !Array.isArray(v) && Object.keys(v).every((k) => k === "x" || k === "y" || k === "z");

function fmt(v, indent = "") {
  if (v === null || typeof v !== "object") return JSON.stringify(v);
  const inner = indent + "  ";
  if (Array.isArray(v)) {
    if (v.length === 0) return "[]";
    if (v.every(isPoint) || v.every((x) => x === null || typeof x !== "object")) return JSON.stringify(v);
    return `[\n${v.map((x) => inner + fmt(x, inner)).join(",\n")}\n${indent}]`;
  }
  const keys = Object.keys(v);
  if (keys.length === 0) return "{}";
  const flat = JSON.stringify(v);
  if (flat.length <= 96 && !keys.some((k) => Array.isArray(v[k]) && v[k].length > 0 && typeof v[k][0] === "object")) return flat;
  return `{\n${keys.map((k) => `${inner}${JSON.stringify(k)}: ${fmt(v[k], inner)}`).join(",\n")}\n${indent}}`;
}

/** `compact`: one line, as the board saves itself (the 2,000-stroke board would be ~3.3 MB laid out) */
function writeJson(name, value, compact = false) {
  const file = path.join(OUT, name);
  fs.writeFileSync(file, (compact ? JSON.stringify(value) : fmt(value)) + "\n");
  return file;
}

// ---------------------------------------------------------------------------------------------
// a. kid-algebra.tldraw.json
// ---------------------------------------------------------------------------------------------

function kidAlgebra() {
  const newId = makeIds(20261014);
  const nextIndex = makeIndexer(42);
  const rand = rng(7);
  const tutor = makeTutor(newId);
  const SCREEN = { x: 0, y: 0, w: 1600, h: 900 };

  const store = {};
  const put = (r) => {
    if (r.typeName === "shape" && r.index == null) r.index = nextIndex(r.parentId);
    store[r.id] = r;
    return r;
  };
  put(documentRecord());
  const page1 = "page:page";
  const page2 = newId("page");
  put(pageRecord(page1, "Page 1", "a1", { screen: { ...SCREEN } }));
  put(pageRecord(page2, "Screen 2", "a2", { screen: { ...SCREEN } }));

  // Tue 2026-10-14, 16:05:12 in New York: after school
  let clock = Date.UTC(2026, 9, 14, 20, 5, 12, 340);
  const lineId = () => `ln_${Math.floor(rand() * 0xffffffff).toString(16).padStart(8, "0")}`;

  // ---- the kid writes four lines with the Pencil (layoutMath = the same hand engine as the tutor's)
  const steps = [
    { latex: "2x + 3 = 11", read: "2x+3=11", size: 122, seed: 101, right: true },
    { latex: "2x = 8", read: "2x=8", size: 128, seed: 202, right: true },
    { latex: "x = 5", read: "x=5", size: 131, seed: 303, right: false },
    { latex: "x = 4", read: "x=4", size: 126, seed: 404, right: true },
  ];
  const lines = [];
  const kidShapes = [];
  steps.forEach((step, i) => {
    const lay = hand.layoutMath(step.latex, { size: step.size, seed: step.seed });
    if (lay.unsupported.length) throw new Error(`hand engine cannot write ${step.latex}`);
    const left = 148 + (rand() - 0.5) * 18 + (i === 3 ? 6 : 0);
    const baseline = 168 + i * 168 + (rand() - 0.5) * 10;
    const slant = (rand() - 0.5) * 0.04; // a line that climbs or droops a little
    const ids = [];
    const strokes = [];
    for (const st of lay.strokes) {
      const shift = { x: (rand() - 0.5) * 3, y: (rand() - 0.5) * 3 };
      const poly = st.points.map((p) => {
        const dx = p.x;
        const dy = p.y - lay.baseline;
        return { x: left + shift.x + dx * Math.cos(slant) - dy * Math.sin(slant), y: baseline + shift.y + dx * Math.sin(slant) + dy * Math.cos(slant) };
      });
      const rec = recordStroke(poly, { pen: true, zoom: IPAD_ZOOM, size: "l", speed: 0.26 + rand() * 0.12, rand });
      const t = Math.round(clock);
      const t1 = t + rec.durationMs;
      clock = t1 + 130 + rand() * 330;
      const id = newId("shape");
      ids.push(id);
      const shape = shapeRecord({
        id,
        type: "draw",
        x: rec.origin.x,
        y: rec.origin.y,
        index: nextIndex(page1),
        parentId: page1,
        props: drawProps({ color: "black", size: "l", points: rec.points, isPen: true, isClosed: rec.isClosed }),
        meta: { t, t1 },
      });
      put(shape);
      strokes.push(shape);
      kidShapes.push(shape);
    }
    const bounds = inkBounds(strokes);
    const line = { ...step, id: lineId(), ids, bounds, penUp: strokes[strokes.length - 1].meta.t1 };
    lines.push(line);

    // ---- the tutor reads the line: its echo (math shape), then its mark
    const readAt = Math.round(line.penUp + 1100 + rand() * 600);
    const markAt = readAt + 180 + Math.round(rand() * 220);
    const kind = step.right ? "check" : "circle";
    const markShapes = tutor.mark(kind, bounds, { lineId: line.id, parentId: page1, now: markAt });
    const markRect = inkBounds(markShapes);
    const others = lines.slice(0, -1).map((l) => l.bounds);
    const cand = placement.placeEcho(bounds, step.read, "m", SCREEN);
    const slot = placement.findFreeSlot(cand, [markRect, ...others, ...lines.slice(0, -1).flatMap((l) => l.avoid)], bounds);
    put(
      shapeRecord({
        id: newId("shape"),
        type: "math",
        x: slot.x,
        y: slot.y,
        index: null,
        parentId: page1,
        props: {
          w: slot.w,
          h: slot.h,
          latex: step.read,
          source: "echo",
          status: step.right ? "ok" : "warn",
          resultLatex: "",
          note: "",
          anchorIds: ids,
          lineId: line.id,
          size: "m",
          tone: "muted",
        },
        meta: makeMeta("echo", line.id, readAt, { edited: false }),
      }),
    );
    for (const s of markShapes) put(s);
    line.avoid = [slot, markRect];
    clock = markAt + 900;

    // ---- Suggest: beside the ring, the step that should have been there (liveLoop.suggestNextStep)
    if (!step.right) {
      const at = clock + 600;
      const { plan, unsupported } = hw.planHandwriting(["x = 4"], { size: hw.handSizeFor(bounds.h, IPAD_ZOOM), seed: hw.handSeedFor(`${line.id}:suggest`) });
      if (!plan || unsupported.length) throw new Error("tutor cannot write x = 4");
      const k = clusters.inkScale(IPAD_ZOOM);
      const candidate = {
        x: placement.rectMaxX(marks.ringRect(bounds)) + (placement.PLACEMENT.sideGap * k) / 2,
        y: bounds.y + bounds.h / 2 - plan.bounds.h / 2,
        w: plan.bounds.w,
        h: plan.bounds.h,
      };
      const where = placement.findFreeSlot(candidate, [slot, ...others], bounds, "right", k);
      const shapes = tutor.write(hw.placeHandPlan(plan, { x: where.x, y: where.y }), {
        meta: makeMeta("ai", line.id, at),
        extraMeta: { suggestFor: step.read },
        parentId: page1,
        now: at,
      });
      for (const s of shapes) put(s);
      line.avoid.push(inkBounds(shapes));
      clock = at + 2500;
    }
    clock += 2200 + rand() * 2600; // the kid looks at it, then writes the next line
  });

  // ---- a graph the tutor drew on the side (GraphShapeUtil props)
  const graphLine = lineId();
  const graphAt = lines[0].penUp + 4200;
  put(
    shapeRecord({
      id: newId("shape"),
      type: "graph",
      x: 1130,
      y: 96,
      index: nextIndex(page1),
      parentId: page1,
      props: {
        w: 320,
        h: 270,
        fns: [{ id: `f_${graphLine}_0`, expr: "x^2-4", latex: "x^{2}-4", color: "blue" }],
        points: [],
        xMin: -5,
        xMax: 5,
        yMin: -5,
        yMax: 5,
        autoY: false,
        grid: true,
        title: "",
        lineId: graphLine,
      },
      meta: makeMeta("ai", graphLine, graphAt, { graphFor: "x^{2}-4" }),
    }),
  );

  // ---------------------------------------------------------------- page 2: a finger drawing
  clock += 3 * 60_000;
  const finger = (poly, color, size = "m") => {
    const rec = recordStroke(poly, { pen: false, zoom: IPAD_ZOOM, size, speed: 0.55 + rand() * 0.3, rand });
    const t = Math.round(clock);
    const t1 = t + rec.durationMs;
    clock = t1 + 250 + rand() * 600;
    const shape = shapeRecord({
      id: newId("shape"),
      type: "draw",
      x: rec.origin.x,
      y: rec.origin.y,
      index: nextIndex(page2),
      parentId: page2,
      props: drawProps({ color, size, points: rec.points, isPen: false, isClosed: rec.isClosed }),
      meta: { t, t1 },
    });
    put(shape);
    return shape;
  };
  /** a tap: one point, z 0.5 (the dot case) */
  const tap = (p, color, size = "m") => {
    const t = Math.round(clock);
    clock = t + 90 + rand() * 40 + 300 + rand() * 300;
    const q = { x: Math.round(p.x * IPAD_ZOOM) / IPAD_ZOOM, y: Math.round(p.y * IPAD_ZOOM) / IPAD_ZOOM };
    const shape = shapeRecord({
      id: newId("shape"),
      type: "draw",
      x: q.x,
      y: q.y,
      index: nextIndex(page2),
      parentId: page2,
      props: drawProps({ color, size, points: [{ x: 0, y: 0, z: 0.5 }], isPen: false }),
      meta: { t, t1: t + 90 + Math.round(rand() * 40) },
    });
    put(shape);
    return shape;
  };

  // a triangle in one stroke, back to where it started (so tldraw marks it closed)
  const A = { x: 210, y: 640 };
  const B = { x: 640, y: 660 };
  const C = { x: 420, y: 250 };
  const tri = wobbly(densePath([A, B, C, { x: A.x + 3, y: A.y - 2 }], 14), rand, 3);
  finger(tri, "red");
  // labels A, B, C written with a finger (the hand engine's letters, finger-sampled)
  const label = (ch, at, size) => {
    const lay = hand.layoutMath(ch, { size, seed: ch.charCodeAt(0) });
    if (lay.unsupported.length) throw new Error(`hand engine cannot write ${ch}`);
    for (const st of lay.strokes) finger(st.points.map((p) => ({ x: at.x + p.x, y: at.y + p.y })), "green");
  };
  label("A", { x: A.x - 82, y: A.y - 24 }, 80);
  label("B", { x: B.x + 22, y: B.y - 22 }, 80);
  label("C", { x: C.x - 26, y: C.y - 104 }, 80);
  // a smiley: face (closed), two eyes (taps), a smile
  const face = arcPath(1000, 470, 130, 124, -Math.PI / 2, (3 * Math.PI) / 2 - 0.04, 40);
  finger(wobbly(face, rand, 3), "violet");
  tap({ x: 955, y: 425 }, "violet");
  tap({ x: 1046, y: 423 }, "violet");
  finger(wobbly(arcPath(1000, 478, 70, 52, 0.25, Math.PI - 0.25, 14), rand, 2), "violet");

  // tldraw's own shapes: a rectangle, an ellipse, an arrow between them, a line
  const rectId = newId("shape");
  put(
    shapeRecord({
      id: rectId,
      type: "geo",
      x: 1180,
      y: 110,
      index: nextIndex(page2),
      parentId: page2,
      props: {
        w: 300,
        h: 180,
        geo: "rectangle",
        dash: "draw",
        growY: 0,
        url: "",
        scale: 1,
        color: "blue",
        labelColor: "black",
        fill: "none",
        size: "m",
        font: "draw",
        align: "middle",
        verticalAlign: "middle",
        richText: richText(""),
      },
      meta: { t: Math.round((clock += 2000)) },
    }),
  );
  put(
    shapeRecord({
      id: newId("shape"),
      type: "geo",
      x: 1210,
      y: 600,
      index: nextIndex(page2),
      parentId: page2,
      props: {
        w: 260,
        h: 160,
        geo: "ellipse",
        dash: "solid",
        growY: 0,
        url: "",
        scale: 1,
        color: "green",
        labelColor: "black",
        fill: "none",
        size: "m",
        font: "draw",
        align: "middle",
        verticalAlign: "middle",
        richText: richText(""),
      },
      meta: { t: Math.round((clock += 2400)) },
    }),
  );
  put(
    shapeRecord({
      id: newId("shape"),
      type: "arrow",
      x: 1330,
      y: 312,
      index: nextIndex(page2),
      parentId: page2,
      props: {
        kind: "arc",
        elbowMidPoint: 0.5,
        dash: "draw",
        size: "m",
        fill: "none",
        color: "black",
        labelColor: "black",
        bend: 0,
        start: { x: 0, y: 0 },
        end: { x: 12, y: 266 },
        arrowheadStart: "none",
        arrowheadEnd: "arrow",
        richText: richText(""),
        labelPosition: 0.5,
        font: "draw",
        scale: 1,
      },
      meta: { t: Math.round((clock += 2100)) },
    }),
  );
  {
    const [i0, i1, i2] = ["a1", "a2", "a3"];
    put(
      shapeRecord({
        id: newId("shape"),
        type: "line",
        x: 140,
        y: 780,
        index: nextIndex(page2),
        parentId: page2,
        props: {
          dash: "draw",
          size: "m",
          color: "grey",
          spline: "line",
          points: {
            [i0]: { id: i0, index: i0, x: 0, y: 0 },
            [i1]: { id: i1, index: i1, x: 360, y: -24 },
            [i2]: { id: i2, index: i2, x: 680, y: 18 },
          },
          scale: 1,
        },
        meta: { t: Math.round((clock += 1800)) },
      }),
    );
  }

  // the tutor's closed, filled sketches (handStrokeShape with closed + fill, as lecture sketches draw them)
  const sketchLine = lineId();
  const box = (x0, y0, w, h, seed) => {
    const r = rng(seed);
    const c = [
      { x: x0, y: y0 },
      { x: x0 + w, y: y0 + 1.5 },
      { x: x0 + w - 1, y: y0 + h },
      { x: x0 + 1, y: y0 + h - 1 },
      { x: x0, y: y0 },
    ];
    const pts = densePath(c, 6).map((p, i) => ({ x: p.x + (r() - 0.5) * 1.6, y: p.y + (r() - 0.5) * 1.6, z: +(0.5 + 0.08 * Math.sin(i / 4)).toFixed(3) }));
    pts[pts.length - 1] = { ...pts[0] };
    return [{ points: pts, order: 0, kind: "box" }];
  };
  const sketchAt = Math.round((clock += 4000));
  for (const [i, spec] of [
    // over the rectangle's lower-right corner: the "semi" fill (theme.solid, near-white) hides it
    { strokes: box(1400, 236, 170, 120, 11), style: { color: "blue", fill: "semi", closed: true }, part: "box:0" },
    // a bar as lecture charts fill them ("solid" = the colour's light tint)
    { strokes: box(760, 700, 90, 150, 12), style: { color: "light-blue", fill: "solid", closed: true }, part: "bar:0" },
  ].entries()) {
    const plan = hw.planFromStrokes("sketch", spec.strokes, hw.HAND_WRITE.minSize);
    plan.lines[0].style = spec.style;
    plan.lines[0].part = spec.part;
    const shapes = tutor.write(plan, { meta: makeMeta("ai", sketchLine, sketchAt + i * 1200), parentId: page2, now: sketchAt + i * 1200 });
    for (const s of shapes) put(s);
  }

  const schema = SCHEMA;
  check("kid-algebra", store, schema);
  return {
    file: { document: { store, schema }, session: sessionFor([page1, page2], page1, { x: 38.89, y: 48.61, z: IPAD_ZOOM }) },
    lines,
  };
}

// ---------------------------------------------------------------------------------------------
// b. legacy-noscreen.tldraw.json
// ---------------------------------------------------------------------------------------------

function legacyNoScreen() {
  const newId = makeIds(20240611);
  const nextIndex = makeIndexer(5, false);
  const rand = rng(99);
  const store = {};
  const put = (r) => (store[r.id] = r);
  put(documentRecord());
  const page = "page:page";
  put(pageRecord(page, "Page 1", "a1", {}));
  const DESKTOP_ZOOM = 1;
  const mouse = (poly, size, scale = 1) => recordStroke(poly, { pen: false, zoom: DESKTOP_ZOOM, size, scale, speed: 0.6 + rand() * 0.3, rand });
  const pencil = (poly, size) => recordStroke(poly, { pen: true, zoom: DESKTOP_ZOOM, size, speed: 0.3, rand });

  // 1. a cursive scribble, rotated 0.4 rad (the kid rotated it with the handles)
  {
    const pts = [];
    for (let i = 0; i <= 60; i++) {
      const t = i / 60;
      pts.push({ x: 300 + t * 360 + 26 * Math.sin(t * Math.PI * 8), y: 150 + 40 * Math.sin(t * Math.PI * 2) - 30 * Math.cos(t * Math.PI * 8) });
    }
    const r = mouse(pts, "m");
    put(shapeRecord({ id: newId("shape"), type: "draw", x: r.origin.x, y: r.origin.y, rotation: 0.4, index: nextIndex(page), parentId: page, props: drawProps({ color: "black", size: "m", points: r.points, isPen: false, isClosed: r.isClosed }) }));
  }
  // 2. a big swoosh at size xl with props.scale 2 (drawn zoomed out with dynamic size): it reaches ~(2300, 1200)
  {
    const pts = quadPath({ x: 1480, y: 760 }, { x: 1820, y: 1380 }, { x: 2290, y: 1080 }, 48);
    const r = mouse(pts, "xl", 2);
    put(shapeRecord({ id: newId("shape"), type: "draw", x: r.origin.x, y: r.origin.y, index: nextIndex(page), parentId: page, props: drawProps({ color: "red", size: "xl", points: r.points, isPen: false, isClosed: r.isClosed, scale: 2 }) }));
  }
  // 3. a group (moved and rotated) holding two pen strokes; children are in the group's space
  {
    const groupId = newId("shape");
    put(shapeRecord({ id: groupId, type: "group", x: 760, y: 470, rotation: -0.35, index: nextIndex(page), parentId: page, props: {} }));
    const star = [];
    for (let i = 0; i <= 10; i++) {
      const r = i % 2 === 0 ? 90 : 38;
      const a = -Math.PI / 2 + (i * Math.PI) / 5;
      star.push({ x: 100 + r * Math.cos(a), y: 100 + r * Math.sin(a) });
    }
    const s1 = pencil(densePath(star, 10), "m");
    put(shapeRecord({ id: newId("shape"), type: "draw", x: s1.origin.x, y: s1.origin.y, index: nextIndex(groupId), parentId: groupId, props: drawProps({ color: "blue", size: "m", points: s1.points, isPen: true, isClosed: s1.isClosed }) }));
    const spiral = [];
    for (let i = 0; i <= 80; i++) {
      const t = (i / 80) * Math.PI * 5;
      spiral.push({ x: 300 + 6 * t * Math.cos(t), y: 110 + 6 * t * Math.sin(t) });
    }
    const s2 = pencil(spiral, "m");
    put(shapeRecord({ id: newId("shape"), type: "draw", x: s2.origin.x, y: s2.origin.y, index: nextIndex(groupId), parentId: groupId, props: drawProps({ color: "violet", size: "m", points: s2.points, isPen: true, isClosed: s2.isClosed }) }));
  }
  // 4. two segments in one shape: free, then shift-click straight (Drawing's "straight" segment)
  {
    const free = [];
    for (let i = 0; i <= 30; i++) free.push({ x: 1150 + i * 6, y: 300 + 18 * Math.sin(i / 3) });
    const r = mouse(free, "m");
    const lastFree = r.points[r.points.length - 1];
    const straight = { type: "straight", points: [{ x: lastFree.x, y: lastFree.y, z: 0.5 }, { x: toFixed(lastFree.x + 220), y: toFixed(lastFree.y + 140), z: 0.5 }] };
    put(
      shapeRecord({
        id: newId("shape"),
        type: "draw",
        x: r.origin.x,
        y: r.origin.y,
        index: nextIndex(page),
        parentId: page,
        props: drawProps({ color: "green", size: "m", isPen: false, segments: [{ type: "free", points: r.points }, straight] }),
      }),
    );
  }
  // 5. a dot: one click, one point
  put(shapeRecord({ id: newId("shape"), type: "draw", x: 1712.5, y: 210, index: nextIndex(page), parentId: page, props: drawProps({ color: "black", size: "l", points: [{ x: 0, y: 0, z: 0.5 }], isPen: false }) }));
  // 6. a text shape, and 7. a highlight across it
  put(
    shapeRecord({
      id: newId("shape"),
      type: "text",
      x: 300,
      y: 690,
      index: nextIndex(page),
      parentId: page,
      props: { color: "black", size: "m", w: 290, font: "draw", textAlign: "start", autoSize: true, scale: 1, richText: richText("Old board, no screens") },
    }),
  );
  {
    const pts = densePath([{ x: 292, y: 718 }, { x: 470, y: 714 }, { x: 600, y: 719 }], 9);
    const r = mouse(pts, "l");
    put(shapeRecord({ id: newId("shape"), type: "highlight", x: r.origin.x, y: r.origin.y, index: nextIndex(page), parentId: page, props: { color: "yellow", size: "l", segments: [{ type: "free", points: r.points }], isComplete: true, isPen: false, scale: 1 } }));
  }
  // 8. an image (a worksheet page) with its asset record; locked
  {
    const assetId = newId("asset");
    put({ id: assetId, typeName: "asset", type: "image", props: { name: "worksheet-page-1.png", src: "https://example.com/agathon-fixtures/worksheet-page-1.png", w: 1240, h: 1754, mimeType: "image/png", isAnimated: false, fileSize: 183422 }, meta: {} });
    put(
      shapeRecord({
        id: newId("shape"),
        type: "image",
        x: 1880,
        y: 120,
        index: nextIndex(page),
        parentId: page,
        isLocked: true,
        props: { w: 310, h: 438.5, assetId, playing: true, url: "", crop: null, flipX: false, flipY: false, altText: "" },
      }),
    );
  }
  // 9. the solid paths: a dashed stroke (opacity 0.5) and a closed, filled one
  {
    const pts = densePath([{ x: 300, y: 900 }, { x: 520, y: 860 }, { x: 760, y: 930 }], 10);
    const r = mouse(pts, "m");
    put(shapeRecord({ id: newId("shape"), type: "draw", x: r.origin.x, y: r.origin.y, index: nextIndex(page), parentId: page, opacity: 0.5, props: drawProps({ color: "violet", size: "m", dash: "dashed", points: r.points, isPen: false, isClosed: r.isClosed }) }));
  }
  {
    const loop = wobbly(arcPath(1050, 900, 110, 70, -Math.PI / 2, (3 * Math.PI) / 2 - 0.02, 36), rand, 2);
    const r = mouse(loop, "m");
    if (!r.isClosed) throw new Error("legacy loop should close");
    put(shapeRecord({ id: newId("shape"), type: "draw", x: r.origin.x, y: r.origin.y, index: nextIndex(page), parentId: page, props: drawProps({ color: "light-red", size: "m", fill: "solid", points: r.points, isPen: false, isClosed: true }) }));
  }

  const schema = legacyFixture.document.schema;
  check("legacy-noscreen", store, schema);
  return { store, schema };
}

// ---------------------------------------------------------------------------------------------
// c. all-shapes.tldraw.json: every shape kind the web ever saved (the full converter's fixture)
// ---------------------------------------------------------------------------------------------

/** A tiny PNG (w x h of one colour), deterministic: a picture saved inline before the asset store. */
function tinyPng(w, h, [r, g, b]) {
  const crcTable = Array.from({ length: 256 }, (_, n) => {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
  });
  const crc = (buf) => {
    let c = 0xffffffff;
    for (const x of buf) c = crcTable[(c ^ x) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };
  const chunk = (type, data) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type, "ascii"), data]);
    const c = Buffer.alloc(4);
    c.writeUInt32BE(crc(td));
    return Buffer.concat([len, td, c]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // RGB
  const rows = [];
  for (let y = 0; y < h; y++) rows.push(Buffer.from([0, ...Array.from({ length: w }, () => [r, g, b]).flat()]));
  const png = Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", zlib.deflateSync(Buffer.concat(rows), { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
  return `data:image/png;base64,${png.toString("base64")}`;
}

const GEO_KINDS = [
  "rectangle", "ellipse", "triangle", "diamond", "pentagon", "hexagon", "octagon", "star", "rhombus", "rhombus-2",
  "oval", "trapezoid", "arrow-right", "arrow-left", "arrow-up", "arrow-down", "x-box", "check-box", "heart", "cloud",
];

function geoProps(over = {}) {
  return {
    w: 100, h: 80, geo: "rectangle", dash: "draw", growY: 0, url: "", scale: 1, color: "black", labelColor: "black",
    fill: "none", size: "m", font: "draw", align: "middle", verticalAlign: "middle", richText: richText(""), ...over,
  };
}

function allShapes() {
  const newId = makeIds(20261017);
  const nextIndex = makeIndexer(17);
  const rand = rng(1017);
  const tutor = makeTutor(newId);
  const store = {};
  const put = (r) => {
    if (r.typeName === "shape" && r.index == null) r.index = nextIndex(r.parentId);
    store[r.id] = r;
    return r;
  };
  put(documentRecord());
  const page1 = newId("page");
  const page2 = newId("page");
  put(pageRecord(page1, "Every shape", "a1", { screen: { x: 0, y: 0, w: 1600, h: 900 } }));
  put(pageRecord(page2, "Old page", "a2", {}));
  let clock = Date.UTC(2026, 9, 15, 21, 0, 0, 0);
  const tick = (ms) => Math.round((clock += ms));
  const shape = (o) => put(shapeRecord({ index: null, ...o }));

  // ---- every geo kind, a row of ten and a row of ten; some filled, dashed, labelled, coloured
  const fills = ["none", "semi", "solid", "fill", "pattern"];
  const dashes = ["draw", "solid", "dashed", "dotted"];
  const colors = ["black", "blue", "green", "red", "violet", "orange", "light-blue", "grey"];
  const geoIds = {};
  GEO_KINDS.forEach((geo, i) => {
    const id = newId("shape");
    geoIds[geo] = id;
    shape({
      id, type: "geo", parentId: page1,
      x: 40 + (i % 10) * 150, y: 40 + Math.floor(i / 10) * 130, rotation: i === 7 ? 0.3 : 0,
      isLocked: i === 3, opacity: i === 4 ? 0.5 : 1,
      props: geoProps({
        geo, fill: fills[i % fills.length], dash: dashes[i % dashes.length], color: colors[i % colors.length],
        size: ["s", "m", "l", "xl"][i % 4], growY: i === 9 ? 24 : 0,
        richText: richText(i === 0 ? "start" : i === 1 ? "end" : i === 19 ? "two\nlines" : ""),
      }),
      meta: { t: tick(900) },
    });
  });

  // ---- a sticky note, and one grown for its text
  shape({ id: newId("shape"), type: "note", parentId: page1, x: 60, y: 320, props: { color: "yellow", labelColor: "black", size: "m", font: "draw", fontSizeAdjustment: 0, align: "middle", verticalAlign: "middle", growY: 0, url: "", richText: richText("Show your work!"), scale: 1 }, meta: { t: tick(4000) } });
  shape({ id: newId("shape"), type: "note", parentId: page1, x: 290, y: 320, rotation: -0.05, props: { color: "light-green", labelColor: "black", size: "s", font: "sans", fontSizeAdjustment: 1, align: "start", verticalAlign: "start", growY: 60, url: "", richText: richText("Steps:\n1. read\n2. write\n3. check"), scale: 0.8 }, meta: { t: tick(4000) } });

  // ---- text: multi-line, LaTeX's special characters, scaled; and an old one with a list
  shape({ id: newId("shape"), type: "text", parentId: page1, x: 520, y: 330, props: { color: "black", size: "m", w: 260, font: "draw", textAlign: "start", autoSize: false, scale: 1, richText: richText("x_1 & y^2 {ok}\n100% $5 #1 ~ \\") }, meta: { t: tick(5000) } });
  shape({
    id: newId("shape"), type: "text", parentId: page1, x: 520, y: 430, rotation: 0.12,
    props: {
      color: "red", size: "l", w: 300, font: "sans", textAlign: "middle", autoSize: true, scale: 1.5,
      richText: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "Today" }, { type: "hardBreak" }, { type: "text", text: "fractions" }] }, { type: "bulletList", content: [{ type: "listItem", content: [{ type: "paragraph", content: [{ type: "text", text: "halves" }] }] }, { type: "listItem", content: [{ type: "paragraph", content: [{ type: "text", text: "quarters" }] }] }] }] },
    },
    meta: { t: tick(5000) },
  });

  // ---- a frame holding a kid's stroke and a box (children in the frame's space)
  const frameId = newId("shape");
  shape({ id: frameId, type: "frame", parentId: page1, x: 860, y: 300, props: { w: 320, h: 220, name: "Warm-up", color: "black" }, meta: { t: tick(3000) } });
  {
    const rec = recordStroke(densePath([{ x: 30, y: 60 }, { x: 140, y: 40 }, { x: 260, y: 90 }], 8), { pen: true, zoom: IPAD_ZOOM, size: "l", speed: 0.3, rand });
    const t = tick(2000);
    shape({ id: newId("shape"), type: "draw", parentId: frameId, x: rec.origin.x, y: rec.origin.y, props: drawProps({ color: "violet", size: "l", points: rec.points, isPen: true, isClosed: rec.isClosed }), meta: { t, t1: t + rec.durationMs } });
    shape({ id: newId("shape"), type: "geo", parentId: frameId, x: 40, y: 120, props: geoProps({ w: 90, h: 60, color: "green" }), meta: { t: tick(2000) } });
  }

  // ---- a group of two boxes, moved and rotated
  {
    const groupId = newId("shape");
    shape({ id: groupId, type: "group", parentId: page1, x: 1240, y: 300, rotation: 0.2, props: {}, meta: {} });
    shape({ id: newId("shape"), type: "geo", parentId: groupId, x: 0, y: 0, props: geoProps({ w: 60, h: 60, color: "orange", fill: "solid" }), meta: { t: tick(1500) } });
    shape({ id: newId("shape"), type: "geo", parentId: groupId, x: 80, y: 20, props: geoProps({ geo: "ellipse", w: 60, h: 60, color: "violet" }), meta: { t: tick(1500) } });
  }

  // ---- arrows: one straight between two boxes (both ends bound), one bent and labelled, one elbow
  {
    const from = geoIds.rectangle;
    const to = geoIds.ellipse;
    const a = shape({
      id: newId("shape"), type: "arrow", parentId: page1, x: 140, y: 80,
      props: { kind: "arc", elbowMidPoint: 0.5, dash: "draw", size: "m", fill: "none", color: "black", labelColor: "black", bend: 0, start: { x: 0, y: 0 }, end: { x: 90, y: 0 }, arrowheadStart: "none", arrowheadEnd: "arrow", richText: richText(""), labelPosition: 0.5, font: "draw", scale: 1 },
      meta: { t: tick(2500) },
    });
    put({ id: newId("binding"), typeName: "binding", type: "arrow", fromId: a.id, toId: from, props: { terminal: "start", normalizedAnchor: { x: 0.5, y: 0.5 }, isExact: false, isPrecise: false, snap: "none" }, meta: {} });
    put({ id: newId("binding"), typeName: "binding", type: "arrow", fromId: a.id, toId: to, props: { terminal: "end", normalizedAnchor: { x: 0.25, y: 0.75 }, isExact: false, isPrecise: true, snap: "none" }, meta: {} });
    shape({
      id: newId("shape"), type: "arrow", parentId: page1, x: 1220, y: 560,
      props: { kind: "arc", elbowMidPoint: 0.5, dash: "dashed", size: "l", fill: "none", color: "red", labelColor: "red", bend: 40, start: { x: 0, y: 0 }, end: { x: 260, y: 40 }, arrowheadStart: "dot", arrowheadEnd: "triangle", richText: richText("look here"), labelPosition: 0.4, font: "sans", scale: 1 },
      meta: { t: tick(2500) },
    });
    shape({
      id: newId("shape"), type: "arrow", parentId: page1, x: 1220, y: 700,
      props: { kind: "elbow", elbowMidPoint: 0.3, dash: "solid", size: "s", fill: "none", color: "blue", labelColor: "black", bend: 0, start: { x: 0, y: 0 }, end: { x: 200, y: 120 }, arrowheadStart: "none", arrowheadEnd: "arrow", richText: richText(""), labelPosition: 0.5, font: "draw", scale: 1 },
      meta: { t: tick(2500) },
    });
  }

  // ---- a cubic line, and a highlighter over the note's text
  {
    const [i0, i1, i2] = ["a1", "a2", "a3"];
    shape({
      id: newId("shape"), type: "line", parentId: page1, x: 60, y: 600,
      props: { dash: "draw", size: "m", color: "light-red", spline: "cubic", scale: 1, points: { [i0]: { id: i0, index: i0, x: 0, y: 0 }, [i1]: { id: i1, index: i1, x: 120, y: -60 }, [i2]: { id: i2, index: i2, x: 260, y: 10 } } },
      meta: { t: tick(2000) },
    });
    const r = recordStroke(densePath([{ x: 80, y: 410 }, { x: 260, y: 412 }], 9), { pen: false, zoom: IPAD_ZOOM, size: "l", speed: 0.7, rand });
    const t = tick(2000);
    shape({ id: newId("shape"), type: "highlight", parentId: page1, x: r.origin.x, y: r.origin.y, props: { color: "yellow", size: "l", segments: [{ type: "free", points: r.points }], isComplete: true, isPen: false, scale: 1 }, meta: { t, t1: t + r.durationMs } });
  }

  // ---- pictures: an inline one (saved before the asset store), a cropped and flipped one, the
  //      retired image pipeline's overlays (one pending: dropped, one accepted and locked, one feedback)
  {
    const inline = newId("asset");
    put({ id: inline, typeName: "asset", type: "image", props: { name: "sticker.png", src: tinyPng(4, 4, [224, 49, 49]), w: 4, h: 4, mimeType: "image/png", isAnimated: false }, meta: { source: "sticker" } });
    shape({ id: newId("shape"), type: "image", parentId: page1, x: 380, y: 560, props: { w: 80, h: 80, assetId: inline, playing: true, url: "", crop: null, flipX: false, flipY: false, altText: "a red square" }, meta: { t: tick(3000) } });
    const photo = newId("asset");
    put({ id: photo, typeName: "asset", type: "image", props: { name: "worksheet.jpg", src: "https://example.com/agathon-fixtures/worksheet.jpg", w: 1200, h: 900, mimeType: "image/jpeg", isAnimated: false, fileSize: 120034 }, meta: {} });
    shape({ id: newId("shape"), type: "image", parentId: page1, x: 500, y: 560, isLocked: true, props: { w: 240, h: 180, assetId: photo, playing: true, url: "", crop: { topLeft: { x: 0.1, y: 0 }, bottomRight: { x: 0.9, y: 1 } }, flipX: true, flipY: false, altText: "" }, meta: { t: tick(3000) } });
    for (const [mode, accepted, locked] of [["suggest", false, false], ["answer", true, true], ["feedback", false, true]]) {
      const asset = newId("asset");
      put({ id: asset, typeName: "asset", type: "image", props: { name: `overlay-${mode}.png`, src: `https://example.com/agathon-fixtures/overlay-${mode}.png`, w: 1600, h: 900, mimeType: "image/png", isAnimated: false }, meta: {} });
      shape({ id: newId("shape"), type: "image", parentId: page1, x: 0, y: 0, isLocked: locked, props: { w: 1600, h: 900, assetId: asset, playing: true, url: "", crop: null, flipX: false, flipY: false, altText: "" }, meta: { aiOverlay: true, mode, ...(accepted ? { accepted: true } : {}) } });
    }
  }

  // ---- a video, an embed and a bookmark (kept as placeholders that keep their link)
  {
    const video = newId("asset");
    put({ id: video, typeName: "asset", type: "video", props: { name: "lesson.mp4", src: "https://example.com/agathon-fixtures/lesson.mp4", w: 640, h: 360, mimeType: "video/mp4", isAnimated: true }, meta: {} });
    shape({ id: newId("shape"), type: "video", parentId: page1, x: 780, y: 560, props: { w: 192, h: 108, time: 12.5, playing: false, autoplay: false, url: "", assetId: video, altText: "" }, meta: { t: tick(3000) } });
    shape({ id: newId("shape"), type: "embed", parentId: page1, x: 1000, y: 560, props: { w: 192, h: 108, url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ" }, meta: { t: tick(3000) } });
    const bm = newId("asset");
    put({ id: bm, typeName: "asset", type: "bookmark", props: { title: "Fractions explained", description: "Halves and quarters", image: "https://example.com/agathon-fixtures/fractions.png", favicon: "https://example.com/favicon.ico", src: "https://example.com/fractions" }, meta: {} });
    shape({ id: newId("shape"), type: "bookmark", parentId: page1, x: 1000, y: 690, props: { w: 300, h: 120, assetId: bm, url: "https://example.com/fractions" }, meta: { t: tick(3000) } });
  }

  // ---- the kid writes a line; the tutor reads it (echo), answers (ai math), plots (hex colours)
  //      and writes in its hand with the chat's and the proof's meta keys
  {
    const ids = [];
    let penUp = 0;
    const lay = hand.layoutMath("y = 2x", { size: 70, seed: 77 });
    for (const st of lay.strokes) {
      const rec = recordStroke(st.points.map((p) => ({ x: 620 + p.x, y: 760 + p.y - lay.baseline })), { pen: true, zoom: IPAD_ZOOM, size: "l", speed: 0.3, rand });
      const t = tick(400);
      clock = t + rec.durationMs;
      penUp = clock;
      const id = newId("shape");
      ids.push(id);
      shape({ id, type: "draw", parentId: page1, x: rec.origin.x, y: rec.origin.y, props: drawProps({ color: "black", size: "l", points: rec.points, isPen: true, isClosed: rec.isClosed }), meta: { t, t1: t + rec.durationMs } });
    }
    const lineId = "ln_allshapes1";
    const readAt = penUp + 1200;
    shape({ id: newId("shape"), type: "math", parentId: page1, x: 620, y: 800, props: { w: 120, h: 40, latex: "y=2x", source: "echo", status: "ok", resultLatex: "", note: "", anchorIds: ids, lineId, size: "m", tone: "muted" }, meta: makeMeta("echo", lineId, readAt, { edited: false }) });
    shape({ id: newId("shape"), type: "math", parentId: page1, x: 800, y: 790, rotation: 0.1, props: { w: 160, h: 44, latex: "x = \\frac{y}{2}", source: "ai", status: "solved", resultLatex: "x=\\frac{y}{2}", note: "solve for x", anchorIds: [], lineId, size: "l", tone: "accent" }, meta: makeMeta("ai", lineId, readAt + 800, { chatModel: "sonnet-5.5", chatProblem: "cp_1", chatBlock: "cb_1" }) });
    shape({ id: newId("shape"), type: "math", parentId: page1, x: 1000, y: 800, props: { w: 100, h: 30, latex: "a+b", source: "student", status: "none", resultLatex: "", note: "", anchorIds: [], lineId: "", size: "s", tone: "normal" }, meta: { t: tick(1000) } });
    shape({
      id: newId("shape"), type: "graph", parentId: page1, x: 1300, y: 40 + 260, rotation: 0,
      props: { w: 260, h: 200, fns: [{ id: "f_1", expr: "2*x", latex: "2x", color: "#2563eb" }, { id: "f_2", expr: "x^2", latex: "x^{2}", color: "#dc2626" }, { id: "f_3", expr: "1", latex: "1", color: "green" }], points: [{ x: 1, y: 2, label: "A" }], xMin: -4, xMax: 4, yMin: -2, yMax: 8, autoY: true, grid: false, title: "y = 2x", lineId },
      meta: makeMeta("ai", lineId, readAt + 1500, { graphFor: "2x", figure: { points: { A: { x: 1, y: 2 } } } }),
    });
    const { plan } = hw.planHandwriting(["x = 3"], { size: 60, seed: 5 });
    const at = readAt + 3000;
    for (const s of tutor.write(hw.placeHandPlan(plan, { x: 1100, y: 820 }), { meta: makeMeta("ai", lineId, at), extraMeta: { proofTable: "pt_1", proofRows: 2, chatProblem: "cp_1", chatBlock: "cb_2" }, parentId: page1, now: at })) put(s);
    for (const s of tutor.mark("check", { x: 600, y: 700, w: 180, h: 80 }, { lineId, parentId: page1, now: at + 400 })) put(s);
  }

  // ---- page 2, from before screens: a rotated text and a note far right grow its screen
  shape({ id: newId("shape"), type: "text", parentId: page2, x: 1700, y: 1000, rotation: -0.2, props: { color: "black", size: "xl", w: 400, font: "serif", textAlign: "end", autoSize: true, scale: 1, richText: richText("Far away") }, meta: {} });
  shape({ id: newId("shape"), type: "note", parentId: page2, x: 100, y: 100, props: { color: "violet", labelColor: "white", size: "l", font: "mono", fontSizeAdjustment: 0, align: "end", verticalAlign: "end", growY: 0, url: "https://example.com", richText: richText(""), scale: 1 }, meta: {} });

  const schema = SCHEMA;
  check("all-shapes", store, schema);
  return { document: { store, schema }, session: sessionFor([page1, page2], page2, { x: 0, y: 0, z: 1 }) };
}

// ---------------------------------------------------------------------------------------------
// main
// ---------------------------------------------------------------------------------------------

const written = [];
const kid = kidAlgebra();
written.push(writeJson("kid-algebra.tldraw.json", kid.file));
written.push(writeJson("legacy-noscreen.tldraw.json", legacyNoScreen()));
written.push(writeJson("all-shapes.tldraw.json", allShapes()));
{
  const board = synthetic.syntheticBoard({ strokes: 2000 });
  check("synthetic-2000", board.document.store, null);
  written.push(writeJson("synthetic-2000.tldraw.json", board, true));
}
{
  const dest = path.join(OUT, "legacy-small.tldraw.json");
  fs.copyFileSync(legacyFixturePath, dest);
  check("legacy-small", legacyFixture.document.store, legacyFixture.document.schema);
  written.push(dest);
}

for (const f of written) {
  const json = JSON.parse(fs.readFileSync(f, "utf8"));
  const store = json.document?.store ?? json.store;
  const recs = Object.values(store);
  const count = (pred) => recs.filter(pred).length;
  const types = {};
  for (const r of recs) if (r.typeName === "shape") types[r.type] = (types[r.type] ?? 0) + 1;
  const ink = recs.filter((r) => r.type === "draw" || r.type === "highlight");
  const pts = ink.reduce((n, r) => n + r.props.segments.reduce((m, s) => m + s.points.length, 0), 0);
  const zs = ink.flatMap((r) => r.props.segments.flatMap((s) => s.points.map((p) => p.z)));
  console.log(
    `${path.relative(ROOT, f)}  ${fs.statSync(f).size} B  pages ${count((r) => r.typeName === "page")}  shapes ${JSON.stringify(types)}  points ${pts}  z ${Math.min(...zs)}..${Math.max(...zs)}`,
  );
}
console.log("kid lines:", kid.lines.map((l) => `${l.latex} ${l.ids.length} strokes, ${Math.round(l.bounds.w)}x${Math.round(l.bounds.h)} px`).join("; "));
