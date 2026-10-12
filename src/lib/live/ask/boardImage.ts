/**
 * The current screen as a picture for Ask (docs/ASK-V2.md, part "vision"): what the read LaTeX
 * cannot say. That covers a drawing, a photo, a PDF page, and a line of handwriting the reader got
 * wrong. Loaded on first use (`LiveLoop.chatImage`), never with the board.
 *
 * What is in it: the current screen's shapes as the student sees them, cropped to what is on the
 * screen (one line in a corner is not a speck in a 16:9 picture), at most 1024 px on its long side
 * and never blown up more than 2×, on white. Left out: stickers (decoration, kept from the tutor as
 * in every capture, see `StickerLibrary`), shapes hidden on the board ("Hide AI shapes" turns their
 * opacity to 0) and anything off the screen. A readback shown only on hover draws nothing in an
 * export (`MathShapeUtil.toSvg`). The board's UI, the hint cards and the screen's frame are not
 * shapes, so no export has them.
 *
 * How, in order (the iPad lessons of `inkCrop.ts`: an SVG that will not decode, a canvas refused
 * for memory, a toBlob that answers null, and failures that hang rather than throw):
 *  1. tldraw's SVG of the shapes, drawn by us on a white canvas. tldraw's own `toImage` would fill
 *     with its theme's off-white, encode twice to get there, and wait 250 ms on every Safari export;
 *     that wait is needed only when the SVG holds a picture or a font, which WebKit draws late.
 *  2. When that fails or hangs, or the screen holds big pictures (`heavyPictures`: the SVG would
 *     carry them whole, twice over in base64): the shapes drawn on a canvas of our own. Ink comes
 *     out in its colours, with photos and PDF pages under it and typed maths as text (arrows and
 *     text boxes are left out).
 * Each is encoded as JPEG (WebP where the browser really makes it and it comes out smaller), with
 * the quality stepped down, then the size, until the data URL fits `ASK_LIMITS.imageChars`. Never
 * throws; null when the screen is empty, nothing came in `timeoutMs`, or nothing worked. Past the
 * deadline nothing more is encoded, decoded or painted (an export that answers late is dropped).
 */
import { Box, getDefaultColorTheme, STROKE_SIZES, tlenv, type Editor, type TLAssetId, type TLDefaultColorStyle, type TLDefaultSizeStyle, type TLShape, type TLShapeId } from "tldraw";
import { latexToPlainText } from "@/lib/boards/boardTitle";
import { clientMetric } from "@/lib/logger";
import { readScreenMeta } from "@/lib/screens/screens";
import { CHAT_PROBLEM_META } from "../chat/cells";
import { CHAT_BLOCK_META } from "../chat/desk";
import type { Rect } from "../contracts";
import { HAND_LINE_META, HAND_PART_META } from "../handwriting";
import { withDeadline } from "../inkCrop";
import { LECTURE_BLOCK_META } from "../lecture/meta";
import { PROOF_FIGURE_META, PROOF_TABLE_META } from "../proof/tutorFigure";
import { ASK_LIMITS, AskImageSchema } from "./contracts";

export const ASK_IMAGE = {
  /** the picture's long side, in px: a child's handwriting still reads at about a model's own tile size */
  longSide: 1024,
  /** never blown up more than this: one short line is not drawn ten times its size */
  maxScale: 2,
  /** page units of white around what is on the screen */
  pad: 16,
  /** the whole capture: an ask never waits longer for its picture */
  timeoutMs: 1200,
  /** kept back from the export for the drawn fallback, when the export hangs */
  fallbackMs: 300,
  /**
   * Pictures on the screen (photos, PDF pages) past which tldraw's SVG is not made: the SVG carries
   * each one whole as base64 (a phone photo, a PDF page rendered for print), and its own data URL
   * encodes all of that again — tens of MB per ask on an iPad. Past either, the screen is drawn by
   * hand, each picture decoded from its URL and drawn at the picture's size.
   */
  exportPicturePixels: 4_000_000,
  exportPictureBytes: 1_500_000,
} as const;

/** Quality first, then size: a smaller picture of the same screen reads better than a blotchy one. */
export const ASK_IMAGE_LADDER: ReadonlyArray<{ scale: number; quality: number }> = [
  { scale: 1, quality: 0.82 },
  { scale: 1, quality: 0.66 },
  { scale: 1, quality: 0.5 },
  { scale: 0.75, quality: 0.5 },
  { scale: 0.5, quality: 0.5 },
];

export type AskImageType = "image/jpeg" | "image/webp";
export type AskFitStep = (typeof ASK_IMAGE_LADDER)[number];

// ------------------------------------------------------------------ what the LaTeX cannot say

/** What the policy reads of a shape. */
export interface AskShapeInfo {
  type: string;
  meta: unknown;
  opacity?: number;
}

/**
 * - `hidden`: not in the picture (a sticker, a shape hidden on the board);
 * - `said`: the request's LaTeX (`chatScreen`) already says it: the tutor's problems and lines,
 *   a readback, a mark (which sits on student work, and that work counts on its own);
 * - `unsaid`: only a picture says it: the student's ink and shapes, a photo, a PDF page, and the
 *   tutor's graphs, figures and lecture sketches (`ChatDesk.picture` leaves those out too).
 */
export type AskShapeRole = "hidden" | "said" | "unsaid";

/** `graphFor` and `mark` in liveLoop.ts (`GRAPH_META`, `MARK_META`, private there) */
const GRAPH_FOR_META = "graphFor";
const MARK_META = "mark";

export function askShapeRole(shape: AskShapeInfo): AskShapeRole {
  if (shape.opacity !== undefined && !(shape.opacity > 0)) return "hidden";
  const meta = (shape.meta && typeof shape.meta === "object" ? shape.meta : {}) as Record<string, unknown>;
  if (meta.isProtected === true && meta.kind === "sticker") return "hidden";
  // The student's: ink, a typed line, a shape, a photo, a PDF page (`isProtected`, kind "pdf")
  if (meta.live !== true) return "unsaid";
  if (meta.source === "echo" || meta[MARK_META]) return "said";
  const block = meta[CHAT_BLOCK_META];
  if (shape.type === "graph" || meta[GRAPH_FOR_META] || block === "graph" || block === "figure" || meta[LECTURE_BLOCK_META] || meta[PROOF_FIGURE_META] || meta[PROOF_TABLE_META] || meta[HAND_PART_META]) return "unsaid";
  if (meta[CHAT_PROBLEM_META] || typeof meta[HAND_LINE_META] === "string" || shape.type === "math") return "said";
  // Something of the tutor's this list does not know yet: a picture is the safe side of the doubt
  return "unsaid";
}

/**
 * Whether an ask sends a picture of the screen: only when it holds something the LaTeX cannot say.
 * An empty screen, or one with only the tutor's own problems on it, is said in full by the LaTeX;
 * a picture would cost the student half a second and the model its tokens for nothing.
 */
export function askImageWanted(shapes: readonly AskShapeInfo[]): boolean {
  return shapes.some((s) => askShapeRole(s) === "unsaid");
}

// ------------------------------------------------------------------ the screen

/** The slice of tldraw's editor the capture uses (LiveLoop's editor is the real one). */
export type AskImageEditor = Pick<Editor, "getCurrentPage" | "getCurrentPageShapes" | "getShapePageBounds" | "getShapePageTransform" | "getViewportPageBounds"> &
  Partial<Pick<Editor, "getSvgString" | "resolveAssetUrl" | "getAsset">>;

export interface AskScene {
  /** visible and on the screen, in paint order */
  shapes: TLShape[];
  /** page space: what is on the screen, padded, inside the screen */
  bounds: Rect;
}

function intersect(a: Rect, b: Rect): Rect | null {
  const x = Math.max(a.x, b.x);
  const y = Math.max(a.y, b.y);
  const r = Math.min(a.x + a.w, b.x + b.w);
  const bottom = Math.min(a.y + a.h, b.y + b.h);
  // a dot or a straight stroke has no width or no height: touching counts
  return r >= x && bottom >= y ? { x, y, w: r - x, h: bottom - y } : null;
}

function union(a: Rect | null, b: Rect): Rect {
  if (!a) return { ...b };
  const x = Math.min(a.x, b.x);
  const y = Math.min(a.y, b.y);
  return { x, y, w: Math.max(a.x + a.w, b.x + b.w) - x, h: Math.max(a.y + a.h, b.y + b.h) - y };
}

/** The current screen's visible shapes and the page rect the picture shows, or null when it shows nothing. */
export function askScene(editor: AskImageEditor): AskScene | null {
  const vb = editor.getViewportPageBounds();
  const screen: Rect = readScreenMeta(editor.getCurrentPage().meta) ?? { x: vb.x, y: vb.y, w: vb.w, h: vb.h };
  const shapes: TLShape[] = [];
  let box: Rect | null = null;
  for (const shape of editor.getCurrentPageShapes()) {
    if (askShapeRole(shape) === "hidden") continue;
    const b = editor.getShapePageBounds(shape);
    const on = b ? intersect({ x: b.x, y: b.y, w: b.w, h: b.h }, screen) : null;
    if (!on) continue;
    shapes.push(shape);
    box = union(box, on);
  }
  if (!box) return null;
  const { pad } = ASK_IMAGE;
  const bounds = intersect({ x: box.x - pad, y: box.y - pad, w: box.w + pad * 2, h: box.h + pad * 2 }, screen);
  if (!bounds || !(bounds.w > 0) || !(bounds.h > 0)) return null;
  shapes.sort((a, b) => (a.index < b.index ? -1 : a.index > b.index ? 1 : 0));
  return { shapes, bounds };
}

/**
 * The screen's pictures weigh too much for tldraw's SVG (`ASK_IMAGE.exportPicturePixels`, `…Bytes`):
 * their sizes as the assets record them, an inline one (a data URL in the board) by its length. A
 * picture whose asset cannot be read counts for nothing.
 */
export function heavyPictures(editor: AskImageEditor, scene: AskScene): boolean {
  let pixels = 0;
  let bytes = 0;
  for (const shape of scene.shapes) {
    if (shape.type !== "image") continue;
    const assetId = (shape.props as { assetId?: unknown }).assetId;
    if (typeof assetId !== "string" || !assetId) continue;
    let props: { w?: unknown; h?: unknown; fileSize?: unknown; src?: unknown } | undefined;
    try {
      props = editor.getAsset?.(assetId as TLAssetId)?.props as typeof props;
    } catch {
      props = undefined;
    }
    if (!props) continue;
    pixels += num(props.w) * num(props.h);
    const src = typeof props.src === "string" ? props.src : "";
    bytes += num(props.fileSize, src.startsWith("data:") ? Math.round(src.length * 0.75) : 0);
  }
  return pixels > ASK_IMAGE.exportPicturePixels || bytes > ASK_IMAGE.exportPictureBytes;
}

/** The picture's size for `bounds`: its long side at most `longSide`, blown up at most `maxScale`. */
export function askImageSize(bounds: Rect): { scale: number; w: number; h: number } {
  const scale = Math.min(ASK_IMAGE.maxScale, ASK_IMAGE.longSide / Math.max(bounds.w, bounds.h));
  return { scale, w: Math.max(1, Math.round(bounds.w * scale)), h: Math.max(1, Math.round(bounds.h * scale)) };
}

// ------------------------------------------------------------------ fitting it in the request

/** The length of `bytes` of `type` as a base64 data URL. */
export function dataUrlChars(type: string, bytes: number): number {
  return `data:${type};base64,`.length + 4 * Math.ceil(bytes / 3);
}

/**
 * The first encoding down `ASK_IMAGE_LADDER` whose data URL fits `maxChars`, or null (the canvas
 * answered nothing, or not even the smallest fits). With `webp`, the first step is also made as
 * WebP and kept when it really is WebP (Safari answers a WebP request with a PNG) and smaller; the
 * rest of the ladder is then WebP too.
 */
export async function fitAskImage(
  encode: (step: AskFitStep, type: AskImageType) => Promise<Blob | null>,
  opts: { maxChars?: number; webp?: boolean } = {},
): Promise<Blob | null> {
  const maxChars = opts.maxChars ?? ASK_LIMITS.imageChars;
  let type: AskImageType = "image/jpeg";
  for (let i = 0; i < ASK_IMAGE_LADDER.length; i++) {
    const step = ASK_IMAGE_LADDER[i];
    let blob = await encode(step, type);
    if (i === 0 && opts.webp) {
      const webp = await encode(step, "image/webp").catch(() => null);
      if (webp && webp.type === "image/webp" && webp.size > 0 && (!blob || webp.size < blob.size)) {
        blob = webp;
        type = "image/webp";
      }
    }
    // iOS answers a canvas it will not encode with null: the next step would only answer the same
    if (!blob || blob.size === 0) return null;
    if (dataUrlChars(type, blob.size) <= maxChars) return blob;
  }
  return null;
}

// ------------------------------------------------------------------ the canvas

/** The 2D context calls the capture makes (a real one, or a test's fake). */
export type AskContext = Pick<
  CanvasRenderingContext2D,
  | "fillStyle"
  | "strokeStyle"
  | "lineWidth"
  | "lineCap"
  | "lineJoin"
  | "globalAlpha"
  | "font"
  | "textBaseline"
  | "fillRect"
  | "strokeRect"
  | "beginPath"
  | "closePath"
  | "moveTo"
  | "lineTo"
  | "arc"
  | "ellipse"
  | "fill"
  | "stroke"
  | "fillText"
  | "drawImage"
  | "setTransform"
>;

export interface AskCanvas {
  width: number;
  height: number;
  getContext(kind: "2d"): AskContext | null;
  toBlob(cb: (blob: Blob | null) => void, type: string, quality: number): void;
}

/** What the capture needs of the browser (a test's fakes in node). */
export interface AskImageDeps {
  now(): number;
  createCanvas(): AskCanvas | null;
  /** an <img> of `src`, decoded, or null when it would not load */
  loadImage(src: string): Promise<CanvasImageSource | null>;
  /** WebKit, which paints an SVG's embedded pictures and fonts after it says it has loaded */
  isSafari(): boolean;
  /** try WebP beside JPEG (`fitAskImage`) */
  webp: boolean;
}

function loadImage(src: string): Promise<HTMLImageElement | null> {
  if (typeof Image === "undefined") return Promise.resolve(null);
  return new Promise((resolve) => {
    const img = new Image();
    // a photo or a PDF page from Storage: without it, the canvas is tainted and will not encode
    img.crossOrigin = "anonymous";
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = src;
  });
}

export const BROWSER_DEPS: AskImageDeps = {
  now: () => (typeof performance !== "undefined" ? performance.now() : Date.now()),
  createCanvas: () => (typeof document === "undefined" ? null : (document.createElement("canvas") as unknown as AskCanvas)),
  loadImage,
  isSafari: () => tlenv.isSafari,
  webp: true,
};

/** iOS frees a canvas's memory only when it is collected: give it back now. */
function release(canvas: AskCanvas | null | undefined): void {
  if (!canvas) return;
  canvas.width = 0;
  canvas.height = 0;
}

/** A white `w` × `h` canvas with `draw` on it, or null when the browser will not make one. */
function paint(deps: AskImageDeps, w: number, h: number, draw: (ctx: AskContext) => void): AskCanvas | null {
  const canvas = deps.createCanvas();
  if (!canvas) return null;
  try {
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("no 2d context");
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, w, h);
    draw(ctx);
    return canvas;
  } catch (err) {
    release(canvas);
    throw err;
  }
}

function toBlob(canvas: AskCanvas, type: string, quality: number): Promise<Blob | null> {
  // a tainted canvas throws here (SecurityError): the promise rejects
  return new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, type, quality));
}

/** `fitAskImage` over a painted canvas: the full size from it, smaller ones drawn from it (none past the deadline). */
function fitCanvas(source: AskCanvas, deps: AskImageDeps, alive: () => boolean): Promise<Blob | null> {
  return fitAskImage(
    async (step, type) => {
      if (!alive()) return null;
      if (step.scale === 1) return toBlob(source, type, step.quality);
      const w = Math.max(1, Math.round(source.width * step.scale));
      const h = Math.max(1, Math.round(source.height * step.scale));
      const small = paint(deps, w, h, (ctx) => ctx.drawImage(source as unknown as CanvasImageSource, 0, 0, w, h));
      if (!small) return null;
      try {
        return await toBlob(small, type, step.quality);
      } finally {
        release(small);
      }
    },
    { webp: deps.webp },
  );
}

async function blobToDataUrl(blob: Blob): Promise<string> {
  if (typeof FileReader !== "undefined") {
    return new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => (typeof reader.result === "string" ? resolve(reader.result) : reject(new Error("no data URL")));
      reader.onerror = () => reject(reader.error ?? new Error("could not read the picture"));
      reader.readAsDataURL(blob);
    });
  }
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return `data:${blob.type};base64,${btoa(bin)}`;
}

/** The picture as the request's data URL (its type named, whatever the reader wrote), or null when the contract would refuse it. */
async function asDataUrl(blob: Blob): Promise<string | null> {
  const type: AskImageType = blob.type === "image/webp" ? "image/webp" : "image/jpeg";
  const url = await blobToDataUrl(blob);
  const out = `data:${type};base64,${url.slice(url.indexOf(",") + 1)}`;
  return AskImageSchema.safeParse(out).success ? out : null;
}

// ------------------------------------------------------------------ 1. tldraw's SVG on white

/** An SVG's parts WebKit paints only after it reports the image loaded. */
const LATE_SVG_PARTS = /<image\b|@font-face|<foreignObject\b/;

async function exportCanvas(editor: AskImageEditor, scene: AskScene, deps: AskImageDeps, alive: () => boolean): Promise<AskCanvas | null> {
  if (typeof editor.getSvgString !== "function") throw new Error("no export");
  const { scale, w, h } = askImageSize(scene.bounds);
  const ids = scene.shapes.map((s) => s.id);
  const { x, y, w: bw, h: bh } = scene.bounds;
  const svg = await editor.getSvgString(ids, { bounds: new Box(x, y, bw, bh), scale, padding: 0, background: false, darkMode: false, pixelRatio: 1 });
  if (!svg) throw new Error("no svg");
  // an export that answers past its deadline is neither encoded again nor decoded: nobody waits for it
  if (!alive()) return null;
  const url = await blobToDataUrl(new Blob([svg.svg], { type: "image/svg+xml" }));
  if (!alive()) return null;
  const img = await deps.loadImage(url);
  if (!img) throw new Error("svg would not decode");
  if (deps.isSafari() && LATE_SVG_PARTS.test(svg.svg)) await new Promise((r) => setTimeout(r, 250));
  // past the deadline: nobody would release the canvas
  if (!alive()) return null;
  return paint(deps, w, h, (ctx) => ctx.drawImage(img, 0, 0, w, h));
}

// ------------------------------------------------------------------ 2. drawn by hand

type Theme = ReturnType<typeof getDefaultColorTheme>;

function num(v: unknown, fallback = 0): number {
  return typeof v === "number" && Number.isFinite(v) ? v : fallback;
}

function colorOf(theme: Theme, color: unknown): string {
  const c = theme[(typeof color === "string" ? color : "black") as TLDefaultColorStyle];
  return c && typeof c === "object" && "solid" in c ? c.solid : "#1d1d1d";
}

function strokeWidthOf(size: unknown, scale: unknown): number {
  return (STROKE_SIZES[size as TLDefaultSizeStyle] ?? STROKE_SIZES.m) * num(scale, 1);
}

/** A pen stroke's width as tldraw draws it (`DrawShapeUtil`: the size plus one), a little over for its pressure swell. */
function inkWidthOf(size: unknown, scale: unknown): number {
  return ((STROKE_SIZES[size as TLDefaultSizeStyle] ?? STROKE_SIZES.m) + 1) * num(scale, 1) * 1.25;
}

/** One shape in its own coordinates (the context already maps them onto the picture). */
function drawShape(ctx: AskContext, shape: TLShape, theme: Theme, pictures: ReadonlyMap<TLShapeId, CanvasImageSource>): void {
  const props = shape.props as Record<string, unknown>;
  switch (shape.type) {
    case "image": {
      const img = pictures.get(shape.id);
      if (img) ctx.drawImage(img, 0, 0, num(props.w), num(props.h));
      return;
    }
    case "draw":
    case "highlight": {
      const segments = Array.isArray(props.segments) ? (props.segments as Array<{ points?: Array<{ x: number; y: number }> }>) : [];
      const highlight = shape.type === "highlight";
      const color = highlight ? (theme[(props.color as TLDefaultColorStyle) ?? "yellow"]?.highlightSrgb ?? "#fddd00") : colorOf(theme, props.color);
      const width = highlight ? strokeWidthOf(props.size, props.scale) * 4 : inkWidthOf(props.size, props.scale);
      ctx.strokeStyle = color;
      ctx.fillStyle = color;
      ctx.lineWidth = width;
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      if (highlight) ctx.globalAlpha = 0.5 * (shape.opacity ?? 1);
      ctx.beginPath();
      for (const seg of segments) {
        const pts = seg.points ?? [];
        if (pts.length === 0) continue;
        if (pts.length === 1) {
          // a dot: the tick of an `=`, a decimal point
          ctx.moveTo(pts[0].x + width / 2, pts[0].y);
          ctx.arc(pts[0].x, pts[0].y, width / 2, 0, Math.PI * 2);
          continue;
        }
        ctx.moveTo(pts[0].x, pts[0].y);
        for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
      }
      if (props.isClosed === true && props.fill !== "none" && props.fill !== undefined) {
        ctx.fillStyle = theme[(props.color as TLDefaultColorStyle) ?? "black"]?.semi ?? "#f0f0f0";
        ctx.fill();
      }
      ctx.stroke();
      ctx.globalAlpha = shape.opacity ?? 1;
      return;
    }
    case "geo": {
      const w = num(props.w);
      const h = num(props.h);
      ctx.strokeStyle = colorOf(theme, props.color);
      ctx.lineWidth = strokeWidthOf(props.size, props.scale);
      if (props.geo === "ellipse" || props.geo === "oval") {
        ctx.beginPath();
        ctx.ellipse(w / 2, h / 2, w / 2, h / 2, 0, 0, Math.PI * 2);
        ctx.stroke();
      } else ctx.strokeRect(0, 0, w, h);
      return;
    }
    case "math": {
      // a readback is hidden on the board but on hover: left out here (the export asks the shape)
      if (props.source === "echo") return;
      const text = latexToPlainText(String(props.latex ?? "").replace(/^\$+|\$+$/g, ""));
      if (!text) return;
      const h = num(props.h, 40);
      ctx.fillStyle = "#111827";
      ctx.font = `${Math.max(10, Math.round(h * 0.55))}px ui-monospace, Menlo, monospace`;
      ctx.textBaseline = "middle";
      ctx.fillText(text, 8, h / 2);
      return;
    }
    default:
      // arrows, text boxes, notes, frames: not drawn by hand (the export draws them)
      return;
  }
}

/** The pictures on the screen (photos, PDF pages), loaded in at most `ms`; one that is not there in time is left out. */
async function loadPictures(editor: AskImageEditor, scene: AskScene, deps: AskImageDeps, ms: number): Promise<Map<TLShapeId, CanvasImageSource>> {
  const out = new Map<TLShapeId, CanvasImageSource>();
  await Promise.all(
    scene.shapes.map(async (shape) => {
      const assetId = shape.type === "image" ? (shape.props as { assetId?: unknown }).assetId : null;
      if (typeof assetId !== "string" || !assetId) return;
      try {
        const id = assetId as Parameters<Editor["resolveAssetUrl"]>[0] & string;
        const src = (await editor.resolveAssetUrl?.(id, { shouldResolveToOriginal: true })) ?? (editor.getAsset?.(id)?.props as { src?: string | null } | undefined)?.src;
        if (!src) return;
        const img = await withDeadline(deps.loadImage(src), ms);
        if (img) out.set(shape.id, img);
      } catch {
        // left out of the picture
      }
    }),
  );
  return out;
}

function drawnCanvas(editor: AskImageEditor, scene: AskScene, deps: AskImageDeps, pictures: ReadonlyMap<TLShapeId, CanvasImageSource>): AskCanvas | null {
  const { scale, w, h } = askImageSize(scene.bounds);
  const theme = getDefaultColorTheme({ isDarkMode: false });
  return paint(deps, w, h, (ctx) => {
    for (const shape of scene.shapes) {
      const m = editor.getShapePageTransform(shape);
      ctx.setTransform(scale * m.a, scale * m.b, scale * m.c, scale * m.d, scale * (m.e - scene.bounds.x), scale * (m.f - scene.bounds.y));
      ctx.globalAlpha = shape.opacity ?? 1;
      try {
        drawShape(ctx, shape, theme, pictures);
      } catch {
        // one odd shape never costs the picture
      }
    }
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = 1;
  });
}

// ------------------------------------------------------------------ the capture

export type AskImageHow = "export" | "drawn" | "drawn-no-pictures";

function why(err: unknown): string {
  return err instanceof Error ? err.message.slice(0, 40) : "failed";
}

/** A data URL of the current screen, or null when it is empty or the picture could not be made in time. Never throws. */
export async function captureAskImage(editor: AskImageEditor, opts: { timeoutMs?: number } = {}, deps: AskImageDeps = BROWSER_DEPS): Promise<string | null> {
  const timeoutMs = opts.timeoutMs ?? ASK_IMAGE.timeoutMs;
  const startedAt = deps.now();
  const deadline = startedAt + timeoutMs;
  const tried: string[] = [];
  let done = false;
  const alive = () => !done;

  const attempt = async (how: AskImageHow, make: () => Promise<AskCanvas | null>): Promise<string | null> => {
    let canvas: AskCanvas | null = null;
    try {
      canvas = await make();
      if (!canvas) {
        tried.push(`${how}:none`);
        return null;
      }
      const blob = await fitCanvas(canvas, deps, alive);
      // past the deadline: nothing more is encoded
      if (!alive()) return null;
      if (!blob) {
        tried.push(`${how}:big`);
        return null;
      }
      const url = await asDataUrl(blob);
      if (url && alive()) clientMetric("ask.image", { how, ms: Math.round(deps.now() - startedAt), chars: url.length, type: blob.type, tried: tried.join(",") });
      return url;
    } catch (err) {
      tried.push(`${how}:${why(err)}`);
      return null;
    } finally {
      release(canvas);
    }
  };

  const work = async (): Promise<string | null> => {
    const scene = askScene(editor);
    if (!scene) return null;
    // 1. tldraw's SVG on white, given all but the fallback's share of the time. An export that
    // answers after its deadline paints nothing (its canvas would never be given back). Not with
    // big pictures on the screen (`heavyPictures`): those are drawn by hand from the start.
    const heavy = heavyPictures(editor, scene);
    if (heavy) tried.push("export:heavy");
    const exportMs = Math.max(0, deadline - ASK_IMAGE.fallbackMs - deps.now());
    let exportLive = true;
    const exported = heavy
      ? null
      : await attempt("export", () =>
          withDeadline(
            exportCanvas(editor, scene, deps, () => exportLive && alive()),
            exportMs,
          ).finally(() => {
            exportLive = false;
          }),
        );
    if (exported || !alive()) return exported;
    // 2. drawn by hand, with whatever pictures load in half the time left
    const pictures = await loadPictures(editor, scene, deps, Math.max(0, (deadline - deps.now()) / 2));
    const drawn = await attempt("drawn", async () => (alive() ? drawnCanvas(editor, scene, deps, pictures) : null));
    if (drawn || !alive() || pictures.size === 0) return drawn;
    // a picture from a server that sent no CORS header taints the canvas: the ink alone, then
    return attempt("drawn-no-pictures", async () => (alive() ? drawnCanvas(editor, scene, deps, new Map()) : null));
  };

  try {
    const url = await withDeadline(work(), timeoutMs);
    if (!url && tried.length > 0) clientMetric("ask.image.failed", { ms: Math.round(deps.now() - startedAt), tried: tried.join(",") });
    return url;
  } catch (err) {
    clientMetric("ask.image.failed", { ms: Math.round(deps.now() - startedAt), tried: [...tried, `all:${why(err)}`].join(",") });
    return null;
  } finally {
    done = true;
  }
}

/**
 * What an ask sends (`LiveLoop.chatImage`, which loads this module on first use): the picture when
 * the screen holds something its LaTeX cannot say (`askImageWanted`), else null. Never throws.
 * `capture` is the tests' way in.
 */
export async function askImage(editor: AskImageEditor, capture: (editor: AskImageEditor) => Promise<string | null> = captureAskImage): Promise<string | null> {
  try {
    if (!askImageWanted(askScene(editor)?.shapes ?? [])) return null;
    return await capture(editor);
  } catch {
    return null;
  }
}
