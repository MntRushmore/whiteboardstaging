/**
 * "Snap your homework → one problem per page": can Mathpix (SuperNet-201) split a photo of a
 * worksheet into its problems? Five synthetic worksheets, drawn here (printed problems in Helvetica,
 * the kid's answers and working in the tutor's hand, `layoutMath`), two of them made to look like a
 * phone photo (a slight turn, uneven light, grain). Nothing in them is real homework.
 *
 * Each page is read three ways, each call cached and counted on the eval's ledger:
 *  - `v3/text` with `include_line_data` (the regions and their contours);
 *  - `v3/text` with `enable_document_layout` too (full-page layout, as the docs advise for a page);
 *  - `v3/pdf` (the page as a one-page PDF; `.lines.json` holds the regions), deleted once read.
 * All three with `metadata.improve_mathpix: false`.
 *
 * Scored against where each problem really is on the page:
 *  - numbers found: problems whose number starts a region;
 *  - regions inside one problem: no region straddles two problems (a merge would put two problems on a page);
 *  - split right: grouping the regions the obvious way — a region that starts with a number opens a
 *    problem, and every other region belongs to the nearest number above it in its column (the
 *    nearest numbers left of it) — gives each problem a box that overlaps the truth (IoU ≥ 0.5);
 *  - answers attached: the kid's handwriting lands with its own problem.
 */
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { createCanvas, type Canvas, type SKRSContext2D } from "@napi-rs/canvas";
import { getServerEnv } from "@/lib/env";
import { layoutMath, mulberry32 } from "@/lib/hand";
import type { Rect } from "@/lib/live/contracts";
import { MPX_CACHE_DIR, type CallLedger } from "./readers";
import { union } from "./split";

// ---------------------------------------------------------------- drawing a page

const W = 1700;
const H = 2200;
const INK = "#1f2a5a";
const PRINT = "#111111";

export interface Problem {
  n: number;
  /** where the problem (its printed text and the kid's answer) is, on the flat page */
  box: Rect;
  /** where the kid's handwriting for it is */
  hand: Rect[];
}

export interface Worksheet {
  name: string;
  photo: boolean;
  problems: Problem[];
  jpeg: Buffer;
  width: number;
  height: number;
}

class Page {
  readonly c = createCanvas(W, H);
  readonly ctx: SKRSContext2D = this.c.getContext("2d");
  private boxes = new Map<number, Rect[]>();
  private hands = new Map<number, Rect[]>();
  current = 0;
  constructor() {
    this.ctx.fillStyle = "#ffffff";
    this.ctx.fillRect(0, 0, W, H);
  }
  private mark(r: Rect, hand = false) {
    if (this.current <= 0) return;
    const list = this.boxes.get(this.current) ?? [];
    list.push(r);
    this.boxes.set(this.current, list);
    if (hand) this.hands.set(this.current, [...(this.hands.get(this.current) ?? []), r]);
  }
  text(s: string, x: number, y: number, size = 34, weight = "") {
    const ctx = this.ctx;
    ctx.fillStyle = PRINT;
    ctx.font = `${weight} ${size}px Helvetica`.trim();
    ctx.fillText(s, x, y);
    const w = ctx.measureText(s).width;
    this.mark({ x, y: y - size * 0.8, w, h: size });
    return x + w;
  }
  /** a printed fraction, its bar at `y - size * 0.3`; returns the right edge */
  frac(num: string, den: string, x: number, y: number, size = 34) {
    const ctx = this.ctx;
    ctx.font = `${size * 0.8}px Helvetica`;
    const w = Math.max(ctx.measureText(num).width, ctx.measureText(den).width) + 8;
    const bar = y - size * 0.3;
    ctx.fillStyle = PRINT;
    ctx.fillText(num, x + (w - ctx.measureText(num).width) / 2, bar - 6);
    ctx.fillText(den, x + (w - ctx.measureText(den).width) / 2, bar + size * 0.75);
    ctx.fillRect(x, bar, w, 2.5);
    this.mark({ x, y: bar - size * 0.85, w, h: size * 1.75 });
    return x + w;
  }
  rule(x0: number, x1: number, y: number) {
    this.ctx.fillStyle = PRINT;
    this.ctx.fillRect(x0, y, x1 - x0, 3);
    this.mark({ x: x0, y, w: x1 - x0, h: 3 });
  }
  /** the kid's writing: `latex` in the tutor's hand, its top-left at (x, y) */
  hand(latex: string, x: number, y: number, size = 46, seed = 3): Rect {
    const lay = layoutMath(latex, { size, seed });
    const ctx = this.ctx;
    ctx.strokeStyle = INK;
    ctx.lineWidth = 3.2;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    for (const st of lay.strokes) {
      if (st.points.length === 0) continue;
      ctx.beginPath();
      ctx.moveTo(x + st.points[0].x, y + st.points[0].y);
      for (const p of st.points.slice(1)) ctx.lineTo(x + p.x, y + p.y);
      if (st.points.length === 1) ctx.lineTo(x + st.points[0].x + 0.5, y + st.points[0].y);
      ctx.stroke();
    }
    const r = { x, y, w: lay.width, h: lay.height };
    this.mark(r, true);
    return r;
  }
  problems(): Problem[] {
    return [...this.boxes.entries()].map(([n, rs]) => ({ n, box: pad(union(rs), 10), hand: this.hands.get(n) ?? [] }));
  }
}

const pad = (r: Rect, p: number): Rect => ({ x: r.x - p, y: r.y - p, w: r.w + 2 * p, h: r.h + 2 * p });

function header(p: Page, title: string, name: string) {
  p.current = 0;
  p.text(title, 120, 170, 52, "bold");
  p.text("Name:", 120, 260, 32);
  p.hand(name, 230, 222, 44, 5);
  p.text("Date: ____________", 1100, 260, 32);
  p.ctx.fillStyle = "#999";
  p.ctx.fillRect(120, 300, W - 240, 2);
}

/** Fractions: 6 problems in two columns, answers by hand. */
function fractions(): Page {
  const p = new Page();
  header(p, "Unit 4 Homework: Fractions", "Maya");
  p.text("Work out each one. Write your answer in its simplest form.", 120, 370, 30);
  const cell = (n: number, col: number, row: number, draw: (x: number, y: number) => number, answer: string) => {
    p.current = n;
    const x = 140 + col * 760;
    const y = 520 + row * 420;
    const after = p.text(`${n}.`, x, y, 36, "bold");
    const end = draw(after + 24, y);
    p.hand(answer, end + 30, y - 70, 52, n + 2);
  };
  cell(1, 0, 0, (x, y) => p.text("=", p.frac("1", "8", p.text("+", p.frac("3", "4", x, y) + 14, y) + 14, y) + 14, y), "\\frac{7}{8}");
  cell(2, 1, 0, (x, y) => p.text("=", p.frac("3", "5", p.text("×", p.frac("2", "3", x, y) + 14, y) + 14, y) + 14, y), "\\frac{2}{5}");
  cell(3, 0, 1, (x, y) => p.text("=", p.frac("1", "3", p.text("−", p.frac("5", "6", x, y) + 14, y) + 14, y) + 14, y), "\\frac{1}{2}");
  cell(4, 1, 1, (x, y) => p.frac("12", "18", p.text("Simplify", x, y) + 18, y), "\\frac{2}{3}");
  cell(5, 0, 2, (x, y) => p.text("=", p.frac("3", "4", p.text("+ 2", p.frac("1", "2", p.text("1", x, y) + 4, y) + 14, y) + 4, y) + 14, y), "4\\frac{1}{4}");
  cell(6, 1, 2, (x, y) => p.text("bigger?", p.frac("5", "8", p.text("or", p.frac("3", "5", p.text("Which is", x, y) + 14, y) + 14, y) + 14, y) + 14, y), "\\frac{5}{8}");
  return p;
}

/** Equations: 5 problems in one column, two lines of working each. */
function equations(): Page {
  const p = new Page();
  header(p, "Solving Equations: Practice", "Leo");
  p.text("Solve for x. Show your work.", 120, 370, 30);
  const work: Array<[string, string[]]> = [
    ["Solve:  2x + 3 = 11", ["2x = 8", "x = 4"]],
    ["Solve:  5x − 7 = 18", ["5x = 25", "x = 5"]],
    ["Solve:  3(x + 2) = 21", ["x + 2 = 7", "x = 5"]],
    ["Solve:  x ÷ 4 + 1 = 3", ["\\frac{x}{4} = 2", "x = 8"]],
    ["Solve:  4x + 1 = 2x + 9", ["2x = 8", "x = 4"]],
  ];
  work.forEach(([q, lines], i) => {
    p.current = i + 1;
    const y = 480 + i * 340;
    p.text(`${i + 1}. ${q}`, 140, y, 36);
    lines.forEach((l, k) => p.hand(l, 260, y + 30 + k * 105, 50, 11 + i * 3 + k));
  });
  return p;
}

/** Word problems: 4 paragraphs, one with a printed table. */
function wordProblems(): Page {
  const p = new Page();
  header(p, "Word Problems", "Ava");
  const para = (n: number, y: number, lines: string[]) => {
    p.current = n;
    p.text(`${n}.`, 140, y, 34, "bold");
    lines.forEach((l, k) => p.text(l, 200, y + k * 46, 32));
    return y + lines.length * 46;
  };
  let y = para(1, 440, ["Sam has 24 stickers. He gives 1/3 of them to his sister.", "How many stickers does Sam have left?"]);
  p.hand("24 - 8 = 16", 240, y + 10, 52, 21);
  y = para(2, 760, ["A rectangle is 7 cm long and 4 cm wide.", "What is its area?"]);
  p.hand("7 \\times 4 = 28", 240, y + 10, 52, 22);
  y = para(3, 1060, ["The table shows the hours Kim worked and her pay."]);
  // the table
  const tx = 220;
  const ty = y + 20;
  const cols = ["Hours", "1", "2", "3", "4"];
  const pay = ["Pay ($)", "12", "24", "36", "?"];
  const cw = [170, 110, 110, 110, 110];
  let cx = tx;
  p.ctx.strokeStyle = PRINT;
  p.ctx.lineWidth = 2;
  for (let i = 0; i < cols.length; i++) {
    p.ctx.strokeRect(cx, ty, cw[i], 60);
    p.ctx.strokeRect(cx, ty + 60, cw[i], 60);
    p.text(cols[i], cx + 14, ty + 42, 30);
    p.text(pay[i], cx + 14, ty + 102, 30);
    cx += cw[i];
  }
  y = para(3, ty + 175, ["What is Kim's pay for 4 hours?"]);
  p.hand("48", 240, y + 10, 52, 23);
  y = para(4, 1640, ["A train travels 180 km in 3 hours.", "What is its average speed?"]);
  p.hand("180 \\div 3 = 60", 240, y + 10, 52, 24);
  return p;
}

/** Arithmetic: a 3 × 3 grid of column sums, long division and facts. */
function arithmetic(): Page {
  const p = new Page();
  header(p, "Arithmetic Practice", "Noah");
  const cellX = (col: number) => 150 + col * 520;
  const cellY = (row: number) => 470 + row * 560;
  const stack = (n: number, col: number, row: number, rows: string[], answer: string) => {
    p.current = n;
    const x = cellX(col);
    const y = cellY(row);
    p.text(`${n}.`, x, y, 34, "bold");
    const right = x + 300;
    p.ctx.font = "44px Helvetica";
    rows.forEach((r, k) => {
      const w = p.ctx.measureText(r).width;
      p.text(r, right - w, y + 60 + k * 62, 44);
    });
    const ruleY = y + 60 + (rows.length - 1) * 62 + 22;
    p.rule(right - 190, right + 10, ruleY);
    const lay = layoutMath(answer, { size: 54, seed: n });
    p.hand(answer, right - lay.width, ruleY + 14, 54, n);
  };
  const longDiv = (n: number, col: number, row: number, divisor: string, dividend: string, quotient: string) => {
    p.current = n;
    const x = cellX(col);
    const y = cellY(row);
    p.text(`${n}.`, x, y, 34, "bold");
    const left = x + 90;
    const end = p.text(divisor, left, y + 130, 44);
    p.text(")", end + 4, y + 130, 50);
    const startD = end + 26;
    const endD = p.text(dividend, startD + 4, y + 130, 44);
    p.rule(startD - 4, endD + 12, y + 78);
    p.hand(quotient, startD + 30, y + 6, 52, n + 30);
  };
  const fact = (n: number, col: number, row: number, q: string, answer: string) => {
    p.current = n;
    const x = cellX(col);
    const y = cellY(row);
    const end = p.text(`${n}.  ${q}`, x, y + 60, 40);
    p.hand(answer, end + 24, y + 12, 54, n + 40);
  };
  stack(1, 0, 0, ["347", "+ 285"], "632");
  stack(2, 1, 0, ["503", "− 168"], "335");
  stack(3, 2, 0, ["64", "× 3"], "192");
  longDiv(4, 0, 1, "6", "252", "42");
  longDiv(5, 1, 1, "9", "144", "16");
  fact(6, 2, 1, "48 + 37 =", "85");
  stack(7, 0, 2, ["125", "48", "+ 302"], "475");
  fact(8, 1, 2, "7 × 8 =", "56");
  fact(9, 2, 2, "81 ÷ 9 =", "9");
  return p;
}

/** Algebra review: 10 short problems in two columns, close together. */
function algebra(): Page {
  const p = new Page();
  header(p, "Algebra Review", "Zoe");
  const items: Array<[string, string]> = [
    ["Expand  3(x + 4)", "3x + 12"],
    ["Factor  x² + 5x + 6", "(x+2)(x+3)"],
    ["Simplify  x³ · x²", "x^{5}"],
    ["Evaluate  2³ + 4²", "8 + 16 = 24"],
    ["Solve  x² = 49", "x = \\pm 7"],
    ["Simplify  √50", "5\\sqrt{2}"],
    ["Solve  2x − 5 > 7", "x > 6"],
    ["Find the slope through (1, 2) and (3, 8)", "m = 3"],
    ["Evaluate  5a − b  for a = 2, b = 3", "7"],
    ["Write 0.0042 in scientific notation", "4.2 \\times 10^{-3}"],
  ];
  items.forEach(([q, a], i) => {
    p.current = i + 1;
    const col = i < 5 ? 0 : 1;
    const row = i % 5;
    const x = 130 + col * 780;
    const y = 450 + row * 340;
    p.text(`${i + 1}. ${q}`, x, y, col === 1 && i === 7 ? 28 : 32);
    p.hand(a, x + 60, y + 40, 50, 50 + i);
  });
  return p;
}

/** Turns the flat page into a phone photo: a slight turn, uneven light, a little grain. */
function photograph(p: Page, deg: number, seed: number): { canvas: Canvas; map: (r: Rect) => Rect } {
  const out = createCanvas(W, H);
  const ctx = out.getContext("2d");
  ctx.fillStyle = "#d8d4cc";
  ctx.fillRect(0, 0, W, H);
  const a = (deg * Math.PI) / 180;
  ctx.save();
  ctx.translate(W / 2, H / 2);
  ctx.rotate(a);
  ctx.scale(0.94, 0.94);
  ctx.drawImage(p.c, -W / 2, -H / 2);
  ctx.restore();
  // uneven light: darker towards one corner (a shadow over the page), then grain
  const img = ctx.getImageData(0, 0, W, H);
  const rand = mulberry32(seed);
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      const i = (y * W + x) * 4;
      const shade = 0.78 + 0.22 * (1 - (x / W) * 0.6 - (y / H) * 0.4);
      const n = (rand() - 0.5) * 18;
      for (let k = 0; k < 3; k++) img.data[i + k] = Math.max(0, Math.min(255, img.data[i + k] * shade + n));
    }
  ctx.putImageData(img, 0, 0);
  const cos = Math.cos(a) * 0.94;
  const sin = Math.sin(a) * 0.94;
  const at = (x: number, y: number) => ({ x: W / 2 + (x - W / 2) * cos - (y - H / 2) * sin, y: H / 2 + (x - W / 2) * sin + (y - H / 2) * cos });
  return {
    canvas: out,
    map: (r) => {
      const pts = [at(r.x, r.y), at(r.x + r.w, r.y), at(r.x, r.y + r.h), at(r.x + r.w, r.y + r.h)];
      return union(pts.map((q) => ({ x: q.x, y: q.y, w: 0, h: 0 })));
    },
  };
}

/** The five pages (deterministic). */
export function buildWorksheets(): Worksheet[] {
  const pages: Array<[string, () => Page, number | null]> = [
    ["fractions (2 columns, 6 problems)", fractions, null],
    ["equations (1 column, working under each; photo)", equations, 1.6],
    ["word problems (paragraphs and a table)", wordProblems, null],
    ["arithmetic grid (column sums, long division; photo)", arithmetic, -2.2],
    ["algebra review (2 columns, 10 problems)", algebra, null],
  ];
  return pages.map(([name, make, deg], i) => {
    const p = make();
    if (deg === null) return { name, photo: false, problems: p.problems(), jpeg: p.c.toBuffer("image/jpeg", 85), width: W, height: H };
    const photo = photograph(p, deg, 77 + i);
    const problems = p.problems().map((q) => ({ ...q, box: photo.map(q.box), hand: q.hand.map(photo.map) }));
    return { name, photo: true, problems, jpeg: photo.canvas.toBuffer("image/jpeg", 82), width: W, height: H };
  });
}

// ---------------------------------------------------------------- reading a page

export type PageReader = "v3/text" | "v3/text + document layout" | "v3/pdf";
export const PAGE_READERS: readonly PageReader[] = ["v3/text", "v3/text + document layout", "v3/pdf"];

export interface Region {
  text: string;
  type?: string;
  box: Rect;
  handwritten?: boolean;
  confidence?: number | null;
  textConfidence?: number | null;
  layoutConfidence?: number | null;
}

export interface PageRead {
  ok: boolean;
  reader: PageReader;
  regions: Region[];
  /** the page size Mathpix's coordinates are in */
  width: number;
  height: number;
  pageConfidence?: unknown;
  version?: string;
  ms: number;
  error?: string;
}

function boxOfCnt(cnt: number[][] | undefined): Rect | null {
  if (!cnt || cnt.length === 0) return null;
  const xs = cnt.map((p) => p[0]);
  const ys = cnt.map((p) => p[1]);
  return { x: Math.min(...xs), y: Math.min(...ys), w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys) };
}

type RawLine = { text?: string; type?: string; cnt?: number[][]; region?: { top_left_x: number; top_left_y: number; width: number; height: number }; is_handwritten?: boolean; conversion_output?: boolean; included?: boolean; confidence?: number | null; text_confidence?: number | null; layout_confidence?: number | null };

function regionsOf(lines: readonly RawLine[]): Region[] {
  return lines
    .filter((l) => (l.conversion_output ?? l.included) !== false)
    .map((l): Region | null => {
      const box = l.region ? { x: l.region.top_left_x, y: l.region.top_left_y, w: l.region.width, h: l.region.height } : boxOfCnt(l.cnt);
      return box ? { text: l.text ?? "", type: l.type, box, handwritten: l.is_handwritten, confidence: l.confidence, textConfidence: l.text_confidence, layoutConfidence: l.layout_confidence } : null;
    })
    .filter((r): r is Region => r !== null);
}

function headers(json = true): Record<string, string> {
  const env = getServerEnv();
  return { app_id: env.MATHPIX_APP_ID ?? "", app_key: env.MATHPIX_APP_KEY ?? "", ...(json ? { "Content-Type": "application/json" } : {}) };
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** A one-page PDF around a JPEG (DCTDecode), US letter. */
export function pdfOfJpeg(jpeg: Buffer, width: number, height: number): Buffer {
  const parts: Buffer[] = [];
  const offsets: number[] = [];
  let length = 0;
  const push = (b: Buffer | string) => {
    const buf = typeof b === "string" ? Buffer.from(b, "binary") : b;
    parts.push(buf);
    length += buf.length;
  };
  const obj = (n: number, body: Array<Buffer | string>) => {
    offsets[n] = length;
    push(`${n} 0 obj\n`);
    for (const b of body) push(b);
    push("\nendobj\n");
  };
  push("%PDF-1.4\n%\xE2\xE3\xCF\xD3\n");
  obj(1, ["<< /Type /Catalog /Pages 2 0 R >>"]);
  obj(2, ["<< /Type /Pages /Kids [3 0 R] /Count 1 >>"]);
  obj(3, ["<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /XObject << /Im0 4 0 R >> >> /Contents 5 0 R >>"]);
  obj(4, [`<< /Type /XObject /Subtype /Image /Width ${width} /Height ${height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${jpeg.length} >>\nstream\n`, jpeg, "\nendstream"]);
  const content = "q 612 0 0 792 0 0 cm /Im0 Do Q";
  obj(5, [`<< /Length ${content.length} >>\nstream\n${content}\nendstream`]);
  const xref = length;
  push(`xref\n0 6\n0000000000 65535 f \n${[1, 2, 3, 4, 5].map((n) => `${String(offsets[n]).padStart(10, "0")} 00000 n \n`).join("")}`);
  push(`trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`);
  return Buffer.concat(parts);
}

async function readPageUncached(sheet: Worksheet, reader: PageReader, ledger: CallLedger): Promise<PageRead> {
  const started = performance.now();
  const ms = () => Math.round(performance.now() - started);
  const src = `data:image/jpeg;base64,${sheet.jpeg.toString("base64")}`;
  if (reader !== "v3/pdf") {
    if (!ledger.take("mathpix")) return { ok: false, reader, regions: [], width: sheet.width, height: sheet.height, ms: 0, error: "budget" };
    const body: Record<string, unknown> = { src, formats: ["text"], include_line_data: true, metadata: { improve_mathpix: false } };
    if (reader === "v3/text + document layout") body.enable_document_layout = true;
    const res = await fetch("https://api.mathpix.com/v3/text", { method: "POST", headers: headers(), body: JSON.stringify(body), signal: AbortSignal.timeout(60_000) });
    const data = (await res.json().catch(() => ({}))) as { line_data?: RawLine[]; image_width?: number; image_height?: number; page_confidence?: unknown; version?: string; error?: string; lines_json?: unknown };
    if (!res.ok || data.error) return { ok: false, reader, regions: [], width: sheet.width, height: sheet.height, ms: ms(), error: `${res.status} ${data.error ?? ""}`.trim() };
    return { ok: true, reader, regions: regionsOf(data.line_data ?? []), width: data.image_width ?? sheet.width, height: data.image_height ?? sheet.height, pageConfidence: data.page_confidence, version: data.version, ms: ms() };
  }
  // v3/pdf: upload, wait, read the lines, delete
  if (!ledger.take("mathpix")) return { ok: false, reader, regions: [], width: sheet.width, height: sheet.height, ms: 0, error: "budget" };
  const form = new FormData();
  form.append("file", new Blob([new Uint8Array(pdfOfJpeg(sheet.jpeg, sheet.width, sheet.height))], { type: "application/pdf" }), "worksheet.pdf");
  form.append("options_json", JSON.stringify({ metadata: { improve_mathpix: false } }));
  const up = await fetch("https://api.mathpix.com/v3/pdf", { method: "POST", headers: headers(false), body: form, signal: AbortSignal.timeout(60_000) });
  const upBody = (await up.json().catch(() => ({}))) as { pdf_id?: string; error?: string };
  if (!up.ok || !upBody.pdf_id) return { ok: false, reader, regions: [], width: sheet.width, height: sheet.height, ms: ms(), error: `${up.status} ${upBody.error ?? "no pdf_id"}` };
  ledger.addPdfPages(1);
  const id = upBody.pdf_id;
  try {
    for (let i = 0; i < 90; i++) {
      await sleep(1_000);
      const st = (await (await fetch(`https://api.mathpix.com/v3/pdf/${id}`, { headers: headers(false) })).json().catch(() => ({}))) as { status?: string; error?: string };
      if (st.status === "error") return { ok: false, reader, regions: [], width: sheet.width, height: sheet.height, ms: ms(), error: st.error ?? "error" };
      if (st.status === "completed") break;
    }
    const lines = (await (await fetch(`https://api.mathpix.com/v3/pdf/${id}.lines.json`, { headers: headers(false) })).json().catch(() => ({}))) as { pages?: Array<{ lines?: RawLine[]; page_width?: number; page_height?: number; page_confidence?: unknown }> };
    const page = lines.pages?.[0];
    if (!page) return { ok: false, reader, regions: [], width: sheet.width, height: sheet.height, ms: ms(), error: "no lines.json page" };
    return { ok: true, reader, regions: regionsOf(page.lines ?? []), width: page.page_width ?? sheet.width, height: page.page_height ?? sheet.height, pageConfidence: page.page_confidence, ms: ms() };
  } finally {
    // nothing of it stays at Mathpix: the input and every output, gone
    await fetch(`https://api.mathpix.com/v3/pdf/${id}`, { method: "DELETE", headers: headers(false) }).catch(() => undefined);
  }
}

export async function readPage(sheet: Worksheet, reader: PageReader, ledger: CallLedger): Promise<PageRead & { cached?: boolean }> {
  const key = createHash("sha1").update(reader).update(sheet.jpeg).digest("hex");
  const file = join(MPX_CACHE_DIR, "worksheets", `${key}.json`);
  if (existsSync(file)) return { ...(JSON.parse(readFileSync(file, "utf8")) as PageRead), cached: true };
  const out = await readPageUncached(sheet, reader, ledger);
  if (out.ok) {
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, JSON.stringify(out) + "\n");
  }
  return out;
}
