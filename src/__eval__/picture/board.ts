/**
 * A PICTURE BENCH board: the case's work in a synthetic kid's hand (the tutor's hand engine,
 * `layoutMath`, bent the way src/__eval__/handwriting.ts bends it: slant, wobble, uneven sizes, a
 * wandering baseline), the problem printed above it, laid out in the case's frame and corner, as the
 * PNG the iPad would send. Never a real child's ink.
 */
import sharp from "sharp";
import { layoutMath, mulberry32 } from "@/lib/hand";
import { FRAMES, type BenchCase, type Hand } from "./cases";

type Pt = { x: number; y: number };
type Ink = { paths: Pt[][]; w: number; h: number; baseline: number };

const HANDS: Record<Exclude<Hand, "font">, { slant: number; rotateDeg: number; jitter: number; sizeDrift: number; wander: number }> = {
  clean: { slant: 0, rotateDeg: 0, jitter: 0, sizeDrift: 0, wander: 0 },
  slanted: { slant: 0.14, rotateDeg: -1.5, jitter: 0.035, sizeDrift: 0, wander: 0 },
  messy: { slant: 0.1, rotateDeg: 1, jitter: 0.05, sizeDrift: 0.2, wander: 0.12 },
};

const SIZE = 44;
/** layoutMath's height for one plain line at SIZE, so `lineHeight` sets the written size */
const LINE_UNITS = 30;

/** One line in the hand, scaled so a plain line is `lh` tall; its box from (0, 0). */
function handLine(latex: string, hand: Exclude<Hand, "font">, lh: number, seed: number): Ink {
  const v = HANDS[hand];
  const layout = layoutMath(latex, { size: SIZE, seed });
  if (layout.unsupported.length > 0) throw new Error(`hand can't write ${latex}: ${layout.unsupported.join(", ")}`);
  const rand = mulberry32(seed * 7919 + latex.length);
  const warpRand = mulberry32(seed * 104729 + latex.length);
  const phi = warpRand() * 2 * Math.PI;
  const psi = warpRand() * 2 * Math.PI;
  const k = (2 * Math.PI) / (4 * SIZE);
  const a = (v.rotateDeg * Math.PI) / 180;
  const cx = layout.width / 2;
  const cy = layout.height / 2;
  const s = lh / LINE_UNITS;
  const paths = layout.strokes.map((st) => {
    const dx = (rand() - 0.5) * 2 * v.jitter * SIZE;
    const dy = (rand() - 0.5) * 2 * v.jitter * SIZE;
    return st.points.map((raw) => {
      const scale = 1 + v.sizeDrift * Math.sin(k * raw.x + phi);
      const wx = v.sizeDrift === 0 ? raw.x : raw.x - (v.sizeDrift / k) * (Math.cos(k * raw.x + phi) - Math.cos(phi));
      const wy = layout.baseline + (raw.y - layout.baseline) * scale + v.wander * SIZE * Math.sin(((2 * Math.PI) / (7 * SIZE)) * raw.x + psi);
      const x0 = wx + v.slant * (layout.baseline - wy) - cx;
      const y0 = wy - cy;
      return { x: (cx + x0 * Math.cos(a) - y0 * Math.sin(a) + dx) * s, y: (cy + x0 * Math.sin(a) + y0 * Math.cos(a) + dy) * s };
    });
  });
  const xs = paths.flat().map((p) => p.x);
  const ys = paths.flat().map((p) => p.y);
  const x0 = Math.min(...xs);
  const y0 = Math.min(...ys);
  return { paths: paths.map((p) => p.map((q) => ({ x: q.x - x0, y: q.y - y0 }))), w: Math.max(...xs) - x0, h: Math.max(...ys) - y0, baseline: layout.baseline * s - y0 };
}

/** LaTeX as a plain typed line (the "font" hand: a worksheet typed in a handwriting font). */
export function plainText(latex: string): string {
  const sup: Record<string, string> = { "0": "⁰", "1": "¹", "2": "²", "3": "³", "4": "⁴", "5": "⁵", "6": "⁶", "7": "⁷", "8": "⁸", "9": "⁹" };
  return latex
    .replace(/\\frac\{([^{}]*)\}\{([^{}]*)\}/g, "$1/$2")
    .replace(/\^\{(\d+)\}/g, (_, d: string) => [...d].map((c) => sup[c] ?? c).join(""))
    .replace(/\\overline\{\)([^{}]*)\}/g, ")$1")
    .replace(/\\times/g, "×")
    .replace(/\\div/g, "÷")
    .replace(/\\le/g, "≤")
    .replace(/\\ge/g, "≥")
    .replace(/\\[,;! ]/g, " ")
    .replace(/[{}\\]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

const escapeXml = (t: string) => t.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** The case's lines: right work, the planted mistake, or the first `partial` lines. */
export function workLines(c: BenchCase): string[] {
  if (c.work === "right") return c.problem.right;
  if (c.work === "wrong") return c.problem.wrong;
  return c.problem.right.slice(0, c.problem.partial);
}

export type Board = { png: Buffer; width: number; height: number; svg: string };

/** The case's board as the PNG the iPad sends. */
export async function renderBoard(c: BenchCase): Promise<Board> {
  const frame = FRAMES[c.frame];
  const W = frame.w;
  const H = frame.h;
  const lh = frame.lineHeight;
  const pen = Math.max(3, lh / 11);
  const lines = workLines(c);
  const seed = [...c.id].reduce((n, ch) => (n * 31 + ch.charCodeAt(0)) >>> 0, 7);
  const gap = lh * 0.55;

  // the lines, laid out: a column sum right-aligned with its rule under the operator row
  type Placed = { ink?: Ink; text?: string; w: number; h: number };
  const placed: Placed[] = lines.map((l, i) => {
    if (c.hand === "font") {
      const t = plainText(l);
      return { text: t, w: t.length * lh * 0.48, h: lh };
    }
    const ink = handLine(l, c.hand, lh, seed + i * 13);
    return { ink, w: ink.w, h: ink.h };
  });
  const linesW = Math.max(lh * 3, ...placed.map((p) => p.w));
  const opRow = c.problem.column ? lines.findIndex((l) => /^[+\-]|^\\times/.test(l)) : -1;

  // a figure beside (landscape) or under (portrait) the lines
  const fig = c.problem.figure;
  const figSize = fig ? lh * 5 : 0;
  const figBeside = fig && c.frame !== "portrait";
  const linesH = placed.reduce((n, p) => n + p.h + gap, 0) - gap;
  const blockW = figBeside ? linesW + lh + figSize : Math.max(linesW, figSize);
  const blockH = figBeside ? Math.max(linesH, figSize) : linesH + (fig ? lh + figSize : 0);

  const top = c.frame === "zoom" ? lh * 0.9 : H * 0.14;
  let ox: number;
  let oy: number;
  switch (c.placement) {
    case "bottomRight": ox = W * 0.95 - blockW; oy = H * 0.95 - blockH; break;
    case "rightEdge": ox = W - blockW - W * 0.015; oy = Math.max(top, H * 0.25); break;
    case "center": ox = (W - blockW) / 2; oy = Math.max(top, (H - blockH) / 2); break;
    default: ox = W * 0.06; oy = top;
  }
  ox = Math.max(W * 0.02, ox);
  oy = Math.max(top, oy);

  let body = "";
  const pathOf = (pts: Pt[], dx: number, dy: number) =>
    pts.length === 1
      ? `M${(pts[0].x + dx).toFixed(1)} ${(pts[0].y + dy).toFixed(1)} l0.1 0`
      : "M" + pts.map((p) => `${(p.x + dx).toFixed(1)} ${(p.y + dy).toFixed(1)}`).join(" L");
  const stroke = (d: string, w = pen) => `<path d="${d}" stroke="#1d1d1f" stroke-width="${w.toFixed(1)}" fill="none" stroke-linecap="round" stroke-linejoin="round"/>`;
  const wobble = mulberry32(seed + 99);

  // the printed problem (the worksheet's light ink)
  const printedSize = Math.min(lh * 0.62, 30);
  body += `<text x="${(W * 0.05).toFixed(0)}" y="${(Math.max(printedSize * 1.5, top * 0.55)).toFixed(0)}" font-family="Helvetica" font-size="${printedSize.toFixed(0)}" fill="#7a7acc">${escapeXml(c.problem.printed)}</text>`;

  let y = oy;
  placed.forEach((p, i) => {
    const x = c.problem.column ? ox + linesW - p.w : ox;
    if (p.ink) for (const path of p.ink.paths) body += stroke(pathOf(path, x, y));
    else body += `<text x="${x.toFixed(0)}" y="${(y + p.h * 0.8).toFixed(0)}" font-family="Noteworthy, Marker Felt, cursive" font-size="${(lh * 0.85).toFixed(0)}" fill="#1d1d1f">${escapeXml(p.text ?? "")}</text>`;
    y += p.h + gap;
    if (i === opRow) {
      const ry = y - gap * 0.45;
      body += stroke(`M${(ox - lh * 0.2).toFixed(1)} ${ry.toFixed(1)} L${(ox + linesW + lh * 0.1).toFixed(1)} ${(ry + (wobble() - 0.5) * 3).toFixed(1)}`);
    }
  });

  if (fig) {
    const fx = figBeside ? ox + linesW + lh : ox;
    const fy = figBeside ? oy : oy + linesH + lh;
    if (fig.kind === "graph") {
      const s = figSize / 10; // one unit
      const cx = fx + figSize / 2;
      const cy = fy + figSize / 2;
      body += stroke(`M${fx} ${cy} L${fx + figSize} ${cy}`) + stroke(`M${cx} ${fy} L${cx} ${fy + figSize}`);
      for (let t = -4; t <= 4; t++) {
        if (t === 0) continue;
        body += stroke(`M${cx + t * s} ${cy - 5} L${cx + t * s} ${cy + 5}`, pen * 0.6) + stroke(`M${cx - 5} ${cy - t * s} L${cx + 5} ${cy - t * s}`, pen * 0.6);
      }
      if (c.work !== "partial") {
        // the planted mistake: through (0, +3) instead of (0, −3)
        const b = c.work === "wrong" ? -fig.intercept : fig.intercept;
        const pts: Pt[] = [];
        for (let xu = -4; xu <= 4; xu += 0.25) {
          const yu = fig.slope * xu + b;
          if (Math.abs(yu) > 5) continue;
          pts.push({ x: cx + xu * s + (wobble() - 0.5) * 2, y: cy - yu * s + (wobble() - 0.5) * 2 });
        }
        body += stroke(pathOf(pts, 0, 0));
      }
    } else {
      const A = { x: fx, y: fy + figSize };
      const B = { x: fx + figSize, y: fy + figSize };
      const C = { x: fx + figSize * 0.35, y: fy + figSize * 0.1 };
      body += stroke(`M${A.x} ${A.y} L${B.x} ${B.y} L${C.x} ${C.y} Z`);
      const at = [{ x: A.x + lh * 0.6, y: A.y - lh * 0.9 }, { x: B.x - lh * 1.3, y: B.y - lh * 0.9 }, { x: C.x - lh * 0.15, y: C.y + lh * 0.7 }];
      fig.labels.forEach((label, i) => {
        if (c.hand === "font") {
          body += `<text x="${at[i].x.toFixed(0)}" y="${(at[i].y + lh * 0.5).toFixed(0)}" font-family="Noteworthy, Marker Felt, cursive" font-size="${(lh * 0.6).toFixed(0)}" fill="#1d1d1f">${escapeXml(label + (label === "x" ? "" : "°"))}</text>`;
        } else {
          const ink = handLine(label === "x" ? "x" : `${label}^{\\circ}`, c.hand as Exclude<Hand, "font">, lh * 0.7, seed + 300 + i);
          for (const path of ink.paths) body += stroke(pathOf(path, at[i].x, at[i].y), pen * 0.8);
        }
      });
    }
  }

  // crammed: other finished sums all over the rest of the page, so little room is left
  if (c.placement === "crammed" && c.hand !== "font") {
    const fillers = ["12 + 7 = 19", "45 - 18 = 27", "6 \\times 7 = 42", "100 - 37 = 63", "9 + 8 = 17", "56 \\div 8 = 7", "14 + 29 = 43", "70 - 26 = 44"];
    const cellW = lh * 6.2;
    const cellH = lh * 1.7;
    let n = 0;
    for (let fyy = top; fyy + lh < H * 0.97; fyy += cellH) {
      for (let fxx = W * 0.04; fxx + cellW * 0.8 < W * 0.98; fxx += cellW) {
        const clear = fxx + cellW < ox - lh * 0.6 || fxx > ox + blockW + lh * 0.6 || fyy + lh * 1.2 < oy - lh * 0.6 || fyy > oy + blockH + lh * 0.6;
        if (!clear) continue;
        const ink = handLine(fillers[n % fillers.length], "messy", lh * 0.8, seed + 500 + n);
        for (const path of ink.paths) body += stroke(pathOf(path, fxx, fyy), pen * 0.85);
        n++;
      }
    }
  }

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}"><rect width="100%" height="100%" fill="#ffffff"/>${body}</svg>`;
  const png = await sharp(Buffer.from(svg)).png().toBuffer();
  return { png, width: W, height: H, svg };
}
