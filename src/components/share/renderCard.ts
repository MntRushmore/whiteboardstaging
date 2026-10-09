/**
 * The progress card drawn: `layoutShareCard`'s operations onto a 1080 × 1350 canvas, out as a PNG.
 * Runs in the browser only, inside the share sheet's chunk (loaded on the tap), never on first load.
 *
 * FONTS. The card is set in the app's own faces: Geist (next/font, `--font-geist-sans` on the body,
 * `--font-geist` on the platform pages) and Inter (`--font-inter`, the platform pages). A canvas
 * draws with whatever is loaded when it draws, so the faces are asked for first
 * (`document.fonts.load`, a few seconds at most) and the card is measured and drawn after: a face
 * that never comes falls back to the system's sans, and the card still fits (it is measured with the
 * face it is drawn in).
 */
import { CARD_SIZE, layoutShareCard, type CardFace, type CardFont, type CardLayout, type CardOp, type CardOptions, type Point, type ShareCardData } from "@/lib/share/card";

const FALLBACK = "ui-sans-serif, system-ui, -apple-system, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif";
const EMOJI = "'Apple Color Emoji', 'Segoe UI Emoji', 'Noto Color Emoji', sans-serif";
/** how long the faces may take before the card is drawn without them */
const FONT_WAIT_MS = 3_000;

/** A CSS custom property's value on the document or the body ('' when unset). */
function cssVar(name: string): string {
  if (typeof document === "undefined") return "";
  const fromRoot = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return fromRoot || (document.body ? getComputedStyle(document.body).getPropertyValue(name).trim() : "");
}

/** The families the card is set in: next/font's names when the page has them, else the faces' own. */
export function cardFamilies(): Record<CardFace, string> {
  const display = cssVar("--font-geist") || cssVar("--font-geist-sans") || "'Geist'";
  const body = cssVar("--font-inter") || display;
  return { display: `${display}, ${FALLBACK}`, body: `${body}, ${FALLBACK}` };
}

const fontString = (font: CardFont, families: Record<CardFace, string>) => `${font.weight} ${font.size}px ${families[font.face]}`;

/** Every face and weight the card uses, loaded (or given up on after FONT_WAIT_MS). Never throws. */
export async function loadCardFonts(families: Record<CardFace, string> = cardFamilies()): Promise<void> {
  if (typeof document === "undefined" || !document.fonts?.load) return;
  const wanted = [
    { face: "display", weights: [500, 600, 650, 700] },
    { face: "body", weights: [500, 600] },
  ] as const;
  const loads = wanted.flatMap(({ face, weights }) => weights.map((weight) => document.fonts.load(`${weight} 64px ${families[face]}`, "Maya's 0123456789").catch(() => [])));
  await Promise.race([Promise.all(loads), new Promise((resolve) => setTimeout(resolve, FONT_WAIT_MS))]);
}

/** Letter spacing where the canvas has it (Chrome, Firefox, Safari 18); elsewhere the text is a hair wider and still measured right. */
function setFont(ctx: CanvasRenderingContext2D, font: CardFont, families: Record<CardFace, string>): void {
  ctx.font = fontString(font, families);
  if ("letterSpacing" in ctx) (ctx as CanvasRenderingContext2D & { letterSpacing: string }).letterSpacing = `${(font.tracking * font.size).toFixed(2)}px`;
}

/** A smooth line through the tick's points (midpoint curves, as a pen would draw it). The replay's video draws its ticks with it too. */
export function strokeTick(ctx: CanvasRenderingContext2D, points: Point[], lineWidth: number, color: string): void {
  if (points.length < 2) return;
  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineWidth = lineWidth;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.beginPath();
  ctx.moveTo(points[0].x, points[0].y);
  for (let i = 1; i < points.length - 1; i++) {
    const mid = { x: (points[i].x + points[i + 1].x) / 2, y: (points[i].y + points[i + 1].y) / 2 };
    ctx.quadraticCurveTo(points[i].x, points[i].y, mid.x, mid.y);
  }
  const last = points[points.length - 1];
  ctx.lineTo(last.x, last.y);
  ctx.stroke();
  ctx.restore();
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function drawOp(ctx: CanvasRenderingContext2D, op: CardOp, families: Record<CardFace, string>): void {
  const { width, height } = CARD_SIZE;
  switch (op.kind) {
    case "ground":
      ctx.fillStyle = op.color;
      ctx.fillRect(0, 0, width, height);
      return;
    case "board": {
      ctx.save();
      ctx.shadowColor = "rgba(0, 0, 0, 0.08)";
      ctx.shadowBlur = 64;
      ctx.shadowOffsetY = 22;
      roundRect(ctx, op.x, op.y, op.w, op.h, op.radius);
      ctx.fillStyle = op.fill;
      ctx.fill();
      ctx.restore();
      ctx.save();
      roundRect(ctx, op.x + 0.5, op.y + 0.5, op.w - 1, op.h - 1, op.radius);
      ctx.strokeStyle = "rgba(0, 0, 0, 0.06)";
      ctx.lineWidth = 1;
      ctx.stroke();
      ctx.restore();
      return;
    }
    case "disc":
      ctx.beginPath();
      ctx.arc(op.cx, op.cy, op.r, 0, Math.PI * 2);
      ctx.fillStyle = op.color;
      ctx.fill();
      return;
    case "emoji": {
      ctx.save();
      ctx.font = `${op.size}px ${EMOJI}`;
      if ("letterSpacing" in ctx) (ctx as CanvasRenderingContext2D & { letterSpacing: string }).letterSpacing = "0px";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(op.text, op.cx, op.cy);
      ctx.restore();
      return;
    }
    case "text": {
      ctx.save();
      setFont(ctx, op.font, families);
      ctx.fillStyle = op.color;
      ctx.textBaseline = "alphabetic";
      // drawn from its left edge whatever its alignment: the layout measured it, so letter spacing's
      // trailing gap never shifts right-aligned text
      const x = op.align === "left" ? op.x : op.align === "right" ? op.x - op.width : op.x - op.width / 2;
      ctx.textAlign = "left";
      ctx.fillText(op.text, x, op.y);
      ctx.restore();
      return;
    }
    case "tick":
      strokeTick(ctx, op.points, op.lineWidth, op.color);
      return;
    case "rule":
      ctx.fillStyle = op.color;
      ctx.fillRect(op.x, op.y - 1, op.w, 2);
      return;
  }
}

/** A canvas text measurer for the layout, in the faces the card is drawn in. */
export function canvasMeasure(ctx: CanvasRenderingContext2D, families: Record<CardFace, string>) {
  return (text: string, font: CardFont): number => {
    setFont(ctx, font, families);
    return ctx.measureText(text).width;
  };
}

export interface RenderedCard {
  blob: Blob;
  layout: CardLayout;
}

/**
 * The card for `data` as a PNG. Waits for the app's faces (a few seconds at most), lays the card out
 * with the canvas's own measurements, and draws it. Throws only when the browser cannot make a
 * canvas or a PNG (the share sheet says the picture did not draw, with a retry).
 */
export async function renderShareCard(data: ShareCardData, opts: CardOptions = {}): Promise<RenderedCard> {
  const families = cardFamilies();
  await loadCardFonts(families);
  const canvas = document.createElement("canvas");
  canvas.width = CARD_SIZE.width;
  canvas.height = CARD_SIZE.height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("This browser cannot draw the picture.");
  const layout = layoutShareCard(data, canvasMeasure(ctx, families), opts);
  for (const op of layout.ops) drawOp(ctx, op, families);
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
  if (!blob) throw new Error("This browser cannot save the picture.");
  return { blob, layout };
}
