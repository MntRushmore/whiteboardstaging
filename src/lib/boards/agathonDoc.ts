/**
 * The iPad app's board document ("agathon.board", docs/BOARD-FORMAT.md) for the web's readers.
 *
 * Since 2026-10-17 a board the iPad app has saved keeps its document in `whiteboards.doc`, beside the
 * tldraw `data` it was converted from (which the app never changes; supabase/migrations/
 * 20261017000000_agathon_doc.sql). Every server and client reader of a board goes through
 * `loadBoardSnapshot(row)`: the iPad's document when it is current (`doc_version = version`), turned
 * back into a tldraw snapshot in memory, else `data` as stored. The replay, the weekly report, the
 * admin viewer and the web board's read-only view of an iPad board then work unchanged.
 *
 *   decodePoints(b64)        the compact points ("p1"): BOARD-FORMAT.md's reference decoder
 *   agathonDocToTldraw(doc)  a document → `{ document: { store, schema } }` that tldraw 4.2 loads
 *   docIsCurrent(row)        is `doc` the board? (the iPad wrote it after the last `data` write)
 *   loadBoardSnapshot(row)   the snapshot to read, whichever column holds the board
 *
 * The trip back uses each record's own fields first and `meta.tldraw` (what the converter kept of the
 * original: a label's rich text, an arrow's bend, a crop…) for the rest; a record made on the iPad has
 * no `meta.tldraw` and gets tldraw's defaults. Strokes get `meta.t` / `t1` back for the replay.
 *
 * Pure: no tldraw runtime import, no DOM, no I/O (server routes import it).
 */

export const AGATHON_FORMAT = "agathon.board";
/** The newest schema this reader knows (BoardDocument.currentSchema in the app). */
export const AGATHON_SCHEMA = 1;

/** One point of a stroke, relative to the stroke's origin. `t`: ms after the stroke's `start`. */
export interface AgathonPoint {
  x: number;
  y: number;
  pressure: number;
  t: number;
  altitude?: number;
  azimuth?: number;
}

export type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
export type JsonObject = { [key: string]: Json };

/** A record of the document: `id`, `type`, its fields, optional `meta`. */
export interface AgathonRecord {
  id: string;
  type: string;
  meta?: JsonObject;
  [field: string]: unknown;
}

export interface AgathonDoc {
  format: typeof AGATHON_FORMAT;
  schema: number;
  records: Record<string, AgathonRecord>;
  meta?: JsonObject;
}

export class AgathonDocError extends Error {
  constructor(
    message: string,
    readonly code: "not_a_board" | "newer_schema" | "bad_points",
  ) {
    super(message);
    this.name = "AgathonDocError";
  }
}

// ------------------------------------------------------------------ points

function base64Bytes(b64: string): Uint8Array {
  if (typeof Buffer !== "undefined") return new Uint8Array(Buffer.from(b64, "base64"));
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/**
 * The compact points (docs/BOARD-FORMAT.md, "Points"): u8 version 1, u8 flags (1 pressure, 2 tilt,
 * 4 time), varint count, then per point zigzag-varint x and y deltas in 1/16 page unit, u8 pressure,
 * u8 altitude + u8 azimuth, varint ms since the previous point. Throws on a corrupt string.
 */
export function decodePoints(b64: string): AgathonPoint[] {
  const bytes = base64Bytes(b64);
  let i = 0;
  const byte = (): number => {
    const c = bytes[i++];
    if (c === undefined) throw new AgathonDocError("truncated points", "bad_points");
    return c;
  };
  const varint = (): number => {
    let result = 0;
    let mul = 1;
    let c: number;
    do {
      c = byte();
      result += (c & 0x7f) * mul;
      mul *= 128;
    } while (c & 0x80);
    return result;
  };
  const zigzag = (n: number): number => (n % 2 === 0 ? n / 2 : -(n + 1) / 2);
  if (byte() !== 1) throw new AgathonDocError("unknown points version", "bad_points");
  const flags = byte();
  const count = varint();
  if (count > 1_000_000) throw new AgathonDocError("too many points", "bad_points");
  const out: AgathonPoint[] = new Array(count);
  let qx = 0;
  let qy = 0;
  let qt = 0;
  for (let k = 0; k < count; k++) {
    qx += zigzag(varint());
    qy += zigzag(varint());
    const p: AgathonPoint = { x: qx / 16, y: qy / 16, pressure: 0.5, t: 0 };
    if (flags & 1) p.pressure = byte() / 255;
    if (flags & 2) {
      p.altitude = (byte() / 255) * (Math.PI / 2);
      p.azimuth = (byte() / 256) * 2 * Math.PI;
    }
    if (flags & 4) {
      qt += varint();
      p.t = qt;
    }
    out[k] = p;
  }
  return out;
}

// ------------------------------------------------------------------ the document

const isObject = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);

export function isAgathonDoc(v: unknown): v is AgathonDoc {
  return isObject(v) && v.format === AGATHON_FORMAT && typeof v.schema === "number" && isObject(v.records);
}

/** The document, or why it cannot be read (not one, or written by a newer app than this reader). */
export function parseAgathonDoc(v: unknown): AgathonDoc {
  const doc = typeof v === "string" ? (JSON.parse(v) as unknown) : v;
  if (!isAgathonDoc(doc)) throw new AgathonDocError("not an agathon.board document", "not_a_board");
  if (doc.schema > AGATHON_SCHEMA) throw new AgathonDocError(`board schema ${doc.schema} is newer than this reader (${AGATHON_SCHEMA})`, "newer_schema");
  return doc;
}

/** A `whiteboards` row as the readers select it (any of these may be missing). */
export interface BoardRowLike {
  data?: unknown;
  doc?: unknown;
  version?: unknown;
  doc_version?: unknown;
}

const asInt = (v: unknown): number | null => {
  const n = typeof v === "string" && /^\d+$/.test(v) ? Number(v) : v;
  return typeof n === "number" && Number.isFinite(n) ? n : null;
};

/**
 * True when the row's board is its `doc`: the iPad app wrote it, and nothing has written `data`
 * since (a `data` write bumps `version` past `doc_version`). A row read without `doc_version`
 * (a database before the migration) has no doc to prefer.
 */
export function docIsCurrent(row: BoardRowLike | null | undefined): boolean {
  if (!row || row.doc === null || row.doc === undefined) return false;
  const v = asInt(row.version);
  const dv = asInt(row.doc_version);
  return v !== null && dv !== null && dv >= v;
}

/** Which column a reader should show: the iPad's `doc`, or the tldraw `data`. */
export function boardSource(row: BoardRowLike | null | undefined): "doc" | "data" {
  return docIsCurrent(row) ? "doc" : "data";
}

/**
 * The board's tldraw snapshot to read: `doc` turned back into tldraw when it is current, else `data`
 * as stored. A doc that cannot be read (written by a newer app, or corrupt) falls back to `data`, the
 * board as it was before the iPad, and `onError` hears why.
 */
export function loadBoardSnapshot(row: BoardRowLike | null | undefined, opts: { onError?: (err: unknown) => void } = {}): unknown {
  if (!row) return null;
  if (docIsCurrent(row)) {
    try {
      return agathonDocToTldraw(parseAgathonDoc(row.doc));
    } catch (err) {
      opts.onError?.(err);
    }
  }
  return row.data ?? null;
}

// ------------------------------------------------------------------ the trip back to tldraw

/**
 * The schema the snapshot declares: tldraw 4.2's with the board's `math` and `graph` shapes, exactly
 * what the web board serializes (pinned against it by agathonDoc.test.ts), so loading it runs no
 * migrations.
 */
export const TLDRAW_BOARD_SCHEMA = {
  schemaVersion: 2,
  sequences: {
    "com.tldraw.store": 5,
    "com.tldraw.asset": 1,
    "com.tldraw.camera": 1,
    "com.tldraw.document": 2,
    "com.tldraw.instance": 25,
    "com.tldraw.instance_page_state": 5,
    "com.tldraw.page": 1,
    "com.tldraw.instance_presence": 6,
    "com.tldraw.pointer": 1,
    "com.tldraw.shape": 4,
    "com.tldraw.asset.bookmark": 2,
    "com.tldraw.asset.image": 5,
    "com.tldraw.asset.video": 5,
    "com.tldraw.shape.arrow": 7,
    "com.tldraw.shape.bookmark": 2,
    "com.tldraw.shape.draw": 2,
    "com.tldraw.shape.embed": 4,
    "com.tldraw.shape.frame": 1,
    "com.tldraw.shape.geo": 10,
    "com.tldraw.shape.group": 0,
    "com.tldraw.shape.highlight": 1,
    "com.tldraw.shape.image": 5,
    "com.tldraw.shape.line": 5,
    "com.tldraw.shape.note": 9,
    "com.tldraw.shape.text": 3,
    "com.tldraw.shape.video": 4,
    "com.tldraw.shape.math": 0,
    "com.tldraw.shape.graph": 0,
    "com.tldraw.binding.arrow": 1,
  },
} as const;

export type TldrawRecord = { id: string; typeName: string } & Record<string, unknown>;

export interface TldrawSnapshot {
  document: { store: Record<string, TldrawRecord>; schema: typeof TLDRAW_BOARD_SCHEMA };
}

/** tldraw's STROKE_SIZES and FONT_SIZES (the board's math sizes are s 18, m 24, l 32). */
const STROKE_SIZES = { s: 2, m: 3.5, l: 5, xl: 10 } as const;
const FONT_SIZES = { s: 18, m: 24, l: 36, xl: 44 } as const;
type Size = keyof typeof STROKE_SIZES;
const SIZES: readonly Size[] = ["s", "m", "l", "xl"];
const NOTE_SIZE = 200;

const TLDRAW_COLORS = new Set(["black", "grey", "light-violet", "violet", "blue", "light-blue", "yellow", "orange", "green", "light-green", "light-red", "red", "white"]);
const TLDRAW_GEO = new Set(["cloud", "rectangle", "ellipse", "triangle", "diamond", "pentagon", "hexagon", "octagon", "star", "rhombus", "rhombus-2", "oval", "trapezoid", "arrow-right", "arrow-left", "arrow-up", "arrow-down", "x-box", "check-box", "heart"]);
const TLDRAW_DASH = new Set(["draw", "solid", "dashed", "dotted"]);
/** shape types tldraw (and the board's two own shapes) can load */
const TLDRAW_SHAPE_TYPES = new Set(["draw", "highlight", "geo", "line", "arrow", "note", "frame", "text", "image", "video", "embed", "bookmark", "group", "math", "graph"]);

/** Every prop of each shape type (tldraw validates objects strictly: an unknown key fails the load). */
const PROPS: Record<string, readonly string[]> = {
  geo: ["geo", "dash", "url", "w", "h", "growY", "scale", "labelColor", "color", "fill", "size", "font", "align", "verticalAlign", "richText"],
  note: ["color", "labelColor", "size", "font", "fontSizeAdjustment", "align", "verticalAlign", "growY", "url", "richText", "scale"],
  text: ["color", "size", "font", "textAlign", "w", "richText", "scale", "autoSize"],
  frame: ["w", "h", "name", "color"],
  arrow: ["kind", "labelColor", "color", "fill", "dash", "size", "arrowheadStart", "arrowheadEnd", "font", "start", "end", "bend", "richText", "labelPosition", "scale", "elbowMidPoint"],
  line: ["color", "dash", "size", "spline", "points", "scale"],
  image: ["w", "h", "playing", "url", "assetId", "crop", "flipX", "flipY", "altText"],
  video: ["w", "h", "time", "playing", "autoplay", "url", "assetId", "altText"],
  embed: ["w", "h", "url"],
  bookmark: ["w", "h", "assetId", "url"],
  math: ["w", "h", "latex", "source", "status", "resultLatex", "note", "anchorIds", "lineId", "size", "tone"],
};

/** Meta keys the converter adds (docs/BOARD-FORMAT.md); not the board's own, so not given back. */
const CONVERTER_META = new Set(["opacity", "locked", "parent", "dash", "label", "rotation", "tldraw", "highlight", "geo", "spline", "note", "frame", "attach", "text", "link", "title", "video", "fnColors"]);

const keyOf = (id: string): string => {
  const i = id.indexOf(":");
  return i >= 0 ? id.slice(i + 1) : id;
};
const shapeIdOf = (recordId: string): string => `shape:${keyOf(recordId)}`;
const pageIdOf = (screenId: string): string => `page:${keyOf(screenId)}`;
const num = (v: unknown, fallback: number): number => (typeof v === "number" && Number.isFinite(v) ? v : fallback);
const str = (v: unknown, fallback: string): string => (typeof v === "string" ? v : fallback);
const round2 = (v: number): number => Math.round(v * 100) / 100;

function pick(from: unknown, keys: readonly string[]): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (!isObject(from)) return out;
  for (const k of keys) if (k in from && from[k] !== undefined) out[k] = from[k];
  return out;
}

/** A palette token → tldraw's colour name (the tutor's ink is tldraw `blue`). */
function tlColor(token: unknown): string {
  if (token === "tutor") return "blue";
  return typeof token === "string" && TLDRAW_COLORS.has(token) ? token : "black";
}

/** Our fill → tldraw's (their names mean other things: their `semi` is our `paper`…). */
function tlFill(fill: unknown): string {
  switch (fill) {
    case "paper":
      return "semi";
    case "solid":
      return "fill";
    case "semi":
      return "solid";
    default:
      return "none";
  }
}

/** tldraw's fill → ours (the converter's FillStyle.fromTldraw). */
function ourFill(tl: unknown): string {
  switch (tl) {
    case "none":
      return "none";
    case "semi":
      return "paper";
    case "fill":
      return "solid";
    default:
      return "semi";
  }
}

/** The original tldraw fill when it still says the same (its pattern and lined-fill are both our semi). */
function tlFillKept(fill: unknown, original: unknown): string {
  if (typeof original === "string" && ourFill(original) === (fill ?? "none")) return original;
  return tlFill(fill);
}

/** A width back to tldraw's size and scale: an exact size at scale 1, else `fallback` scaled. */
function sizeFor(width: number, base: Record<Size, number>, add: number, mult: number, fallback: Size): { size: Size; scale: number } {
  for (const size of SIZES) if (Math.abs((base[size] + add) * mult - width) < 1e-6) return { size, scale: 1 };
  const unit = (base[fallback] + add) * mult;
  return { size: fallback, scale: width > 0 && unit > 0 ? width / unit : 1 };
}

/** Plain text as tldraw rich text (tldraw's own `toRichText`). */
export function toRichText(text: string): Json {
  return {
    type: "doc",
    content: text.split("\n").map((line) => (line ? { type: "paragraph", content: [{ type: "text", text: line }] } : { type: "paragraph" })),
  };
}

/** Rich text as plain text (paragraphs, list items and hard breaks on their own lines). */
export function richTextPlain(value: unknown): string {
  if (typeof value === "string") return value;
  const lines: string[] = [];
  let current = "";
  let open = false;
  const flush = () => {
    if (open) lines.push(current);
    current = "";
    open = false;
  };
  const walk = (node: unknown): void => {
    if (!isObject(node)) return;
    const type = String(node.type ?? "");
    const kids = Array.isArray(node.content) ? node.content : [];
    if (type === "text") {
      current += String(node.text ?? "");
      open = true;
    } else if (type === "hardBreak") {
      current += "\n";
      open = true;
    } else if (["doc", "bulletList", "orderedList", "listItem", "blockquote"].includes(type)) {
      kids.forEach(walk);
    } else {
      flush();
      open = true;
      kids.forEach(walk);
      flush();
    }
  };
  walk(value);
  flush();
  while (lines.length && lines[lines.length - 1] === "") lines.pop();
  return lines.join("\n");
}

/** The label's rich text: the original when its text is unchanged, else the new text. */
function richTextFor(label: unknown, original: unknown): Json {
  const text = typeof label === "string" ? label : "";
  if (isObject(original) && richTextPlain(original) === text) return original as Json;
  return toRichText(text);
}

/** The board's own meta: the tldraw meta it came with (or the iPad's), without the converter's keys. */
function ownMeta(meta: unknown): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (!isObject(meta)) return out;
  for (const [k, v] of Object.entries(meta)) if (!CONVERTER_META.has(k)) out[k] = v;
  return out;
}

interface Placed {
  parentId: string;
  index: string;
  x: number;
  y: number;
  rotation: number;
  isLocked: boolean;
  opacity: number;
}

/** A converted record's tldraw `{type, props, asset, assetId}`, when the converter kept it. */
function tldrawOf(meta: unknown): { type?: string; props: Record<string, unknown>; asset?: Record<string, unknown>; assetId?: string } {
  const tl = isObject(meta) ? meta.tldraw : undefined;
  if (!isObject(tl)) return { props: {} };
  return {
    type: typeof tl.type === "string" ? tl.type : undefined,
    props: isObject(tl.props) ? tl.props : {},
    asset: isObject(tl.asset) ? tl.asset : undefined,
    assetId: typeof tl.assetId === "string" ? tl.assetId : undefined,
  };
}

/**
 * An Agathon document as a tldraw snapshot (`{ document: { store, schema } }`), for reading only: the
 * screens become pages (`meta.screen` = the screen's rect), drawn records shapes in their z-order,
 * `meta.attach` arrow bindings, and the records kept whole from the original come back as they were.
 * `mark`, `line` and `problem` records are not shapes: a mark's ink is ordinary tutor strokes (they
 * carry `meta.mark`), a line's reading is on its echo.
 */
export function agathonDocToTldraw(doc: AgathonDoc): TldrawSnapshot {
  const store: Record<string, TldrawRecord> = {};
  const records = Object.values(doc.records).filter((r): r is AgathonRecord => isObject(r) && typeof r.id === "string" && typeof r.type === "string");
  const byId = new Map(records.map((r) => [r.id, r]));
  const from = isObject(doc.meta?.convertedFrom) ? (doc.meta!.convertedFrom as Record<string, unknown>) : {};
  const docRecord = isObject(from.document) ? from.document : {};

  store["document:document"] = {
    id: "document:document",
    typeName: "document",
    gridSize: num(docRecord.gridSize, 10),
    name: str(docRecord.name, ""),
    meta: isObject(docRecord.meta) ? docRecord.meta : {},
  };

  // screens → pages, in their order
  const screens = records
    .filter((r) => r.type === "screen")
    .sort((a, b) => (String(a.order) < String(b.order) ? -1 : String(a.order) > String(b.order) ? 1 : a.id < b.id ? -1 : 1));
  const pageIds = new Set<string>();
  for (const s of screens) {
    const id = pageIdOf(s.id);
    pageIds.add(s.id);
    const rect = isObject(s.rect) ? s.rect : { x: 0, y: 0, w: 1600, h: 900 };
    store[id] = { id, typeName: "page", name: str(s.name, `Screen ${screens.indexOf(s) + 1}`), index: String(s.order ?? "a1"), meta: { ...ownMeta(s.meta), screen: { x: num(rect.x, 0), y: num(rect.y, 0), w: num(rect.w, 1600), h: num(rect.h, 900) } } };
  }

  // lines, for the echoes they read back
  const lines = new Map(records.filter((r) => r.type === "line").map((l) => [l.id, l]));

  const drawable = records
    .filter((r) => ["stroke", "shape", "image", "math", "graph"].includes(r.type) && pageIds.has(String(r.screen)))
    .sort((a, b) => (String(a.order) < String(b.order) ? -1 : String(a.order) > String(b.order) ? 1 : a.id < b.id ? -1 : a.id > b.id ? 1 : 0));

  const lastIndex = new Map<string, string>();
  for (const r of drawable) {
    const meta = isObject(r.meta) ? r.meta : {};
    const placed: Placed = {
      parentId: pageIdOf(String(r.screen)),
      index: String(r.order),
      x: num(r.x, 0),
      y: num(r.y, 0),
      rotation: num(r.rotation, num(meta.rotation, 0)),
      isLocked: meta.locked === true,
      opacity: num(meta.opacity, 1),
    };
    lastIndex.set(placed.parentId, placed.index);
    let made: TldrawRecord[] = [];
    switch (r.type) {
      case "stroke":
        made = [strokeShape(r, placed)];
        break;
      case "shape":
        made = shapeShapes(r, placed, byId);
        break;
      case "image":
        made = imageShapes(r, placed);
        break;
      case "math":
        made = [mathShape(r, placed, lines)];
        break;
      case "graph":
        made = [graphShape(r, placed)];
        break;
    }
    for (const m of made) {
      // two images sharing an asset: one asset record
      if (m.typeName === "asset" && store[m.id]) continue;
      store[m.id] = m;
    }
  }

  // records kept whole from the original: shapes tldraw can load, assets, bindings between shapes
  // that are still there (anything else, e.g. a record type of a newer app, is not tldraw's)
  for (const r of records) {
    if (r.type === "tldraw.shape" && isObject(r.shape) && TLDRAW_SHAPE_TYPES.has(String(r.shape.type)) && r.shape.type !== "group" && pageIds.has(String(r.screen))) {
      const parentId = pageIdOf(String(r.screen));
      const index = indexAbove(lastIndex.get(parentId));
      lastIndex.set(parentId, index);
      const id = String(r.shape.id ?? `shape:${keyOf(r.id)}`);
      store[id] = { ...(r.shape as TldrawRecord), id, parentId, index, x: num(r.x, 0), y: num(r.y, 0), rotation: num(r.rotation, 0) };
    } else if (r.type === "tldraw.record" && isObject(r.record)) {
      const rec = r.record as TldrawRecord;
      if (rec.typeName === "asset" && !store[rec.id]) store[rec.id] = rec;
      if (rec.typeName === "binding" && store[String(rec.fromId)] && store[String(rec.toId)]) store[rec.id] = rec;
    }
  }
  // an arrow binding to a shape that is gone (erased on the iPad) is dropped with it
  for (const [id, rec] of Object.entries(store)) {
    if (rec.typeName === "binding" && (!store[String(rec.fromId)] || !store[String(rec.toId)])) delete store[id];
  }
  return { document: { store, schema: TLDRAW_BOARD_SCHEMA } };
}

/** A key above `below` in the same fractional scheme (for records kept whole, put on top). */
function indexAbove(below: string | undefined): string {
  // appending a mid digit keeps it above `below` and below anything that starts with a higher key
  return below ? `${below}V` : "a1";
}

function base(r: AgathonRecord, p: Placed, type: string, props: Record<string, unknown>, meta: Record<string, unknown>): TldrawRecord {
  return {
    id: shapeIdOf(r.id),
    typeName: "shape",
    type,
    x: p.x,
    y: p.y,
    rotation: p.rotation,
    index: p.index,
    parentId: p.parentId,
    isLocked: p.isLocked,
    opacity: p.opacity,
    props,
    meta,
  };
}

function strokeShape(r: AgathonRecord, p: Placed): TldrawRecord {
  const meta = isObject(r.meta) ? r.meta : {};
  let points: AgathonPoint[] = [];
  try {
    points = typeof r.points === "string" ? decodePoints(r.points) : [];
  } catch {
    points = [];
  }
  if (points.length === 0) points = [{ x: 0, y: 0, pressure: 0.5, t: 0 }];
  const tutor = r.author === "tutor";
  const width = num(r.width, 4.5);
  const highlight = meta.highlight === true;
  const out = ownMeta(meta);
  const start = typeof r.start === "number" ? r.start : null;
  if (start !== null) {
    if (tutor) {
      if (typeof out.createdAt !== "number") out.createdAt = start;
    } else {
      out.t = start;
      out.t1 = start + (points[points.length - 1]?.t ?? 0);
    }
  }
  const segments = [{ type: "free", points: points.map((q) => ({ x: round2(q.x), y: round2(q.y), z: Math.round(q.pressure * 1000) / 1000 })) }];
  const color = tlColor(r.color);
  if (highlight) {
    const { size, scale } = sizeFor(width, FONT_SIZES, 0, 1.12, "m");
    return base(r, p, "highlight", { color, size, segments, isComplete: true, isPen: r.pressure === "real", scale }, out);
  }
  const { size, scale } = sizeFor(width, STROKE_SIZES, 1, 1, tutor ? "s" : "m");
  return base(
    r,
    p,
    "draw",
    {
      color,
      fill: r.closed === true ? tlFill(r.fill) : "none",
      dash: TLDRAW_DASH.has(String(meta.dash)) ? meta.dash : "draw",
      size,
      segments,
      isComplete: true,
      isClosed: r.closed === true,
      isPen: r.pressure === "real",
      scale,
    },
    out,
  );
}

type Vec = { x: number; y: number };
const vecs = (v: unknown): Vec[] => (Array.isArray(v) ? v.filter(isObject).map((q) => ({ x: num(q.x, 0), y: num(q.y, 0) })) : []);

function shapeShapes(r: AgathonRecord, p: Placed, byId: Map<string, AgathonRecord>): TldrawRecord[] {
  const meta = isObject(r.meta) ? r.meta : {};
  const tl = tldrawOf(meta);
  const out = ownMeta(meta);
  const kind = String(r.kind);
  const w = num(r.w, 0);
  const h = num(r.h, 0);
  const width = num(r.width, 3.5);
  const color = tlColor(r.color);
  const dash = TLDRAW_DASH.has(String(meta.dash)) ? meta.dash : "draw";
  const points = vecs(r.points);

  if (meta.note === true || tl.type === "note") {
    const scale = w > 0 ? w / NOTE_SIZE : 1;
    const props = {
      color, labelColor: "black", size: "m", font: "draw", fontSizeAdjustment: 0, align: "middle", verticalAlign: "middle", growY: 0, url: "", richText: toRichText(""), scale: 1,
      ...pick(tl.props, PROPS.note),
    };
    return [base(r, p, "note", { ...props, color, scale, growY: Math.max(0, h / scale - NOTE_SIZE), richText: richTextFor(meta.label ?? "", tl.props.richText) }, out)];
  }
  if (meta.frame === true || tl.type === "frame") {
    return [base(r, p, "frame", { w: Math.max(1, w), h: Math.max(1, h), name: str(meta.label, str(tl.props.name, "")), color }, out)];
  }
  if (kind === "arrow") return arrowShapes(r, p, byId, { meta, tl, out, color, dash, width, points });
  if (kind === "line" && typeof meta.geo !== "string") {
    const { size, scale } = sizeFor(width, STROKE_SIZES, 0, 1, "m");
    const handles: Record<string, { id: string; index: string; x: number; y: number }> = {};
    const original = isObject(tl.props.points) ? Object.values(tl.props.points).filter(isObject) : [];
    const sameHandles =
      original.length === points.length &&
      original
        .slice()
        .sort((a, b) => (String(a.index) < String(b.index) ? -1 : 1))
        .every((q, i) => Math.abs(num(q.x, NaN) - points[i].x) < 1e-6 && Math.abs(num(q.y, NaN) - points[i].y) < 1e-6);
    if (sameHandles) {
      for (const q of original) handles[String(q.id)] = { id: String(q.id), index: String(q.index), x: num(q.x, 0), y: num(q.y, 0) };
    } else {
      points.forEach((q, i) => {
        const id = `a${i + 1}`;
        handles[id] = { id, index: id, x: q.x, y: q.y };
      });
    }
    const spline = meta.spline === "cubic" ? "cubic" : "line";
    return [base(r, p, "line", { color, dash, size, spline, points: handles, scale }, out)];
  }
  // a geo shape: a box, an ellipse, or a closed outline of another kind
  const geo = typeof meta.geo === "string" && TLDRAW_GEO.has(meta.geo) ? meta.geo : kind === "ellipse" ? "ellipse" : "rectangle";
  let gw = w;
  let gh = h;
  if (!(gw > 0 && gh > 0) && points.length > 0) {
    gw = Math.max(...points.map((q) => q.x)) - Math.min(...points.map((q) => q.x));
    gh = Math.max(...points.map((q) => q.y)) - Math.min(...points.map((q) => q.y));
  }
  const { size, scale } = sizeFor(width, STROKE_SIZES, 0, 1, "m");
  const props = {
    geo: "rectangle", dash: "draw", url: "", w: 100, h: 100, growY: 0, scale: 1, labelColor: "black", color: "black", fill: "none", size: "m", font: "draw", align: "middle", verticalAlign: "middle", richText: toRichText(""),
    ...pick(tl.props, PROPS.geo),
  };
  return [
    base(
      r,
      p,
      "geo",
      { ...props, geo, w: Math.max(1, gw), h: Math.max(1, gh), growY: 0, color, fill: tlFillKept(r.fill, tl.props.fill), size, scale, dash, richText: richTextFor(meta.label ?? "", tl.props.richText) },
      out,
    ),
  ];
}

function arrowShapes(
  r: AgathonRecord,
  p: Placed,
  byId: Map<string, AgathonRecord>,
  c: { meta: Record<string, unknown>; tl: ReturnType<typeof tldrawOf>; out: Record<string, unknown>; color: string; dash: unknown; width: number; points: Vec[] },
): TldrawRecord[] {
  const pts = c.points.length >= 2 ? c.points : [{ x: 0, y: 0 }, { x: 100, y: 0 }];
  const { size, scale } = sizeFor(c.width, STROKE_SIZES, 0, 1, "m");
  const props = {
    kind: "arc", labelColor: "black", color: "black", fill: "none", dash: "draw", size: "m", arrowheadStart: "none", arrowheadEnd: "arrow", font: "draw",
    start: { x: 0, y: 0 }, end: { x: 100, y: 0 }, bend: 0, richText: toRichText(""), labelPosition: 0.5, scale: 1, elbowMidPoint: 0.5,
    ...pick(c.tl.props, PROPS.arrow),
  };
  const id = shapeIdOf(r.id);
  const shape = base(
    r,
    p,
    "arrow",
    {
      ...props,
      start: pts[0],
      end: pts[pts.length - 1],
      // a bend is drawn as its sampled arc; an arrow redrawn on the iPad is straight
      bend: pts.length > 2 ? num(c.tl.props.bend, 0) : 0,
      color: c.color,
      fill: tlFillKept(r.fill, c.tl.props.fill),
      dash: c.dash,
      size,
      scale,
      richText: richTextFor(c.meta.label ?? "", c.tl.props.richText),
    },
    c.out,
  );
  const made: TldrawRecord[] = [shape];
  const attach = isObject(c.meta.attach) ? c.meta.attach : {};
  for (const terminal of ["start", "end"] as const) {
    const a = attach[terminal];
    if (!isObject(a) || typeof a.to !== "string" || !byId.has(a.to)) continue;
    const anchor = isObject(a.anchor) ? { x: num(a.anchor.x, 0.5), y: num(a.anchor.y, 0.5) } : { x: 0.5, y: 0.5 };
    made.push({
      id: typeof a.binding === "string" && a.binding.startsWith("binding:") ? a.binding : `binding:${keyOf(r.id)}_${terminal}`,
      typeName: "binding",
      type: "arrow",
      fromId: id,
      toId: shapeIdOf(a.to),
      props: { terminal, normalizedAnchor: anchor, isExact: a.exact === true, isPrecise: a.precise === true, snap: ["center", "edge-point", "edge", "none"].includes(String(a.snap)) ? a.snap : "none" },
      meta: {},
    });
  }
  return made;
}

function imageShapes(r: AgathonRecord, p: Placed): TldrawRecord[] {
  const meta = isObject(r.meta) ? r.meta : {};
  const tl = tldrawOf(meta);
  const out = ownMeta(meta);
  const asset = isObject(r.asset) ? r.asset : {};
  const src = str(asset.src, "");
  const w = Math.max(1, num(r.w, 100));
  const h = Math.max(1, num(r.h, 100));
  const type = tl.type === "video" || meta.video === true ? "video" : tl.type === "embed" ? "embed" : tl.type === "bookmark" ? "bookmark" : "image";
  const kept = tl.asset ?? {};
  const keptProps = isObject(kept.props) ? kept.props : {};
  const assetId = tl.assetId ?? (typeof kept.id === "string" ? kept.id : `asset:${keyOf(r.id)}`);

  if (type === "embed") {
    return [base(r, p, "embed", { w, h, url: str(meta.link, str(tl.props.url, "")) }, out)];
  }
  if (type === "bookmark") {
    const made: TldrawRecord[] = [base(r, p, "bookmark", { w, h, assetId, url: str(meta.link, str(tl.props.url, "")) }, out)];
    made.push({
      id: assetId,
      typeName: "asset",
      type: "bookmark",
      props: { title: str(meta.title, str(keptProps.title, "")), description: str(keptProps.description, ""), image: src, favicon: str(keptProps.favicon, ""), src: str(keptProps.src, str(meta.link, "")) || null },
      meta: isObject(kept.meta) ? kept.meta : {},
    });
    return made;
  }
  const assetRecord: TldrawRecord = {
    id: assetId,
    typeName: "asset",
    type,
    props: {
      name: str(keptProps.name, ""),
      src: src || null,
      w: num(asset.w, w),
      h: num(asset.h, h),
      mimeType: typeof asset.mime === "string" ? asset.mime : null,
      isAnimated: keptProps.isAnimated === true,
      ...(typeof keptProps.fileSize === "number" && keptProps.fileSize > 0 ? { fileSize: keptProps.fileSize } : {}),
    },
    meta: isObject(kept.meta) ? kept.meta : {},
  };
  if (type === "video") {
    const props = { time: 0, playing: false, autoplay: false, url: "", altText: "", ...pick(tl.props, PROPS.video) };
    return [base(r, p, "video", { ...props, w, h, assetId }, out), assetRecord];
  }
  const props = { playing: true, url: "", crop: null, flipX: false, flipY: false, altText: "", ...pick(tl.props, PROPS.image) };
  return [base(r, p, "image", { ...props, w, h, assetId }, out), assetRecord];
}

const ROLE_SOURCE: Record<string, string> = { readback: "echo", answer: "ai", note: "student" };
const VERDICTS = new Set(["none", "pending", "ok", "warn", "unknown", "solved"]);

function mathShape(r: AgathonRecord, p: Placed, lines: Map<string, AgathonRecord>): TldrawRecord {
  const meta = isObject(r.meta) ? r.meta : {};
  const tl = tldrawOf(meta);
  const out = ownMeta(meta);
  const fontSize = num(r.fontSize, 24);
  if (tl.type === "text") {
    const props = { color: "black", size: "m", font: "draw", textAlign: "start", autoSize: true, scale: 1, richText: toRichText(""), w: 100, ...pick(tl.props, PROPS.text) };
    const sizeKey = (props.size as keyof typeof FONT_SIZES) in FONT_SIZES ? (props.size as keyof typeof FONT_SIZES) : "m";
    const scale = fontSize > 0 ? fontSize / FONT_SIZES[sizeKey] : 1;
    const text = typeof meta.text === "string" ? meta.text : "";
    return base(r, p, "text", { ...props, size: sizeKey, scale, w: Math.max(1, num(r.w, 100) / scale), richText: richTextFor(text, tl.props.richText) }, out);
  }
  const role = String(r.role);
  const line = typeof r.line === "string" ? lines.get(r.line) : undefined;
  const size = fontSize <= 21 ? "s" : fontSize <= 28 ? "m" : "l";
  const status = role === "readback" && line && VERDICTS.has(String(line.verdict)) ? String(line.verdict) : VERDICTS.has(String(tl.props.status)) ? String(tl.props.status) : "none";
  // an echo reads back its line's strokes; another maths keeps what it had
  const anchorIds = role === "readback" && line && Array.isArray(line.strokes) ? line.strokes.filter((s): s is string => typeof s === "string").map(shapeIdOf) : Array.isArray(tl.props.anchorIds) ? tl.props.anchorIds : [];
  const tone = ["muted", "normal", "accent"].includes(String(tl.props.tone)) ? tl.props.tone : role === "readback" ? "muted" : "normal";
  return base(
    r,
    p,
    "math",
    {
      w: num(r.w, 160),
      h: num(r.h, 44),
      latex: str(r.latex, ""),
      source: ROLE_SOURCE[role] ?? "ai",
      status,
      resultLatex: str(tl.props.resultLatex, ""),
      note: str(tl.props.note, ""),
      anchorIds,
      lineId: typeof r.line === "string" ? keyOf(r.line) : str(meta.lineId, ""),
      size,
      tone,
    },
    out,
  );
}

function graphShape(r: AgathonRecord, p: Placed): TldrawRecord {
  const meta = isObject(r.meta) ? r.meta : {};
  const out = ownMeta(meta);
  const hex = isObject(meta.fnColors) ? meta.fnColors : {};
  const win = isObject(r.window) ? r.window : {};
  const fns = Array.isArray(r.functions)
    ? r.functions.filter(isObject).map((f) => ({ id: str(f.id, ""), expr: str(f.expr, ""), latex: str(f.latex, ""), color: typeof hex[str(f.id, "")] === "string" ? String(hex[str(f.id, "")]) : tlColor(f.color) }))
    : [];
  const points = Array.isArray(r.points) ? r.points.filter(isObject).map((q) => ({ x: num(q.x, 0), y: num(q.y, 0), label: str(q.label, "") })) : [];
  return base(
    r,
    p,
    "graph",
    {
      w: num(r.w, 240),
      h: num(r.h, 200),
      fns,
      points,
      xMin: num(win.xMin, -10),
      xMax: num(win.xMax, 10),
      yMin: num(win.yMin, -10),
      yMax: num(win.yMax, 10),
      autoY: win.autoY === true,
      grid: r.grid !== false,
      title: str(r.title, ""),
      lineId: typeof r.line === "string" ? keyOf(r.line) : "",
    },
    out,
  );
}
