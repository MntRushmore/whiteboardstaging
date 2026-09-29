/**
 * The illustrator eval's pictures: a drawing (`SketchDrawing`, the route's output) rendered the way
 * the board inks it — round-capped lines of one pen width in the palette's colours, closed filled
 * shapes tinted pale, labels in the tutor's blue — and a contact sheet of every drawing of one
 * model, turned into a PNG with `rsvg-convert` so it can be LOOKED at (the eval is judged by eye).
 */
import { execFileSync } from "node:child_process";
import { mkdirSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import type { SketchDrawing } from "@/lib/live/lecture/contracts";
import { INK_HEX } from "@/lib/server/sketch/colour";

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** One drawing as SVG elements, fitted (aspect kept, centred) into a w × h box at (x, y); pen `pen` px. */
export function drawingElements(d: SketchDrawing, at: { x: number; y: number; w: number; h: number }, pen = 2.6): string {
  const s = Math.min(at.w / d.w, at.h / d.h);
  const ox = at.x + (at.w - d.w * s) / 2;
  const oy = at.y + (at.h - d.h * s) / 2;
  const out: string[] = [`<g transform="translate(${ox.toFixed(1)} ${oy.toFixed(1)}) scale(${s.toFixed(5)})" stroke-linecap="round" stroke-linejoin="round">`];
  const sw = (pen / s).toFixed(2);
  for (const st of d.strokes) {
    const colour = INK_HEX[st.color ?? "blue"];
    const pts = st.points.map(([x, y]) => `${x},${y}`).join(" ");
    const tag = st.closed ? "polygon" : "polyline";
    const fill = st.fill && st.closed ? `fill="${colour}" fill-opacity="0.2"` : 'fill="none"';
    out.push(`<${tag} points="${pts}" stroke="${colour}" stroke-width="${sw}" ${fill}/>`);
  }
  for (const l of d.labels) {
    const size = Math.max(l.size ?? 32, 22);
    out.push(`<text x="${l.x}" y="${l.y + size * 0.35}" font-size="${size}" text-anchor="middle" font-family="Chalkboard SE, Comic Sans MS, sans-serif" fill="${INK_HEX.blue}">${esc(l.text)}</text>`);
  }
  out.push("</g>");
  return out.join("\n");
}

export interface SheetCell {
  title: string;
  /** a second line: strokes, latency, retries */
  note: string;
  drawing: SketchDrawing | null;
  /** why there is no drawing */
  failure?: string;
}

export interface SheetRow {
  label?: string;
  cells: SheetCell[];
}

/** A contact sheet: a heading, then rows of cells (each a framed drawing and two lines of text). */
export function contactSheetSvg(heading: string[], rows: readonly SheetRow[], opts: { cols?: number; cellW?: number; cellH?: number } = {}): string {
  const cols = opts.cols ?? 4;
  const cellW = opts.cellW ?? 300;
  const cellH = opts.cellH ?? 250;
  const gap = 14;
  const textH = 34;
  const headH = 18 + heading.length * 20;
  const width = gap + cols * (cellW + gap);
  let y = headH;
  const parts: string[] = [];
  heading.forEach((line, i) => parts.push(`<text x="${gap}" y="${22 + i * 20}" font-size="${i === 0 ? 17 : 13}" font-family="Helvetica, Arial, sans-serif" fill="#333" font-weight="${i === 0 ? 700 : 400}">${esc(line)}</text>`));
  for (const row of rows) {
    if (row.label) {
      parts.push(`<text x="${gap}" y="${y + 14}" font-size="12" font-family="Helvetica, Arial, sans-serif" fill="#777">${esc(row.label)}</text>`);
      y += 20;
    }
    row.cells.forEach((c, i) => {
      const x = gap + i * (cellW + gap);
      parts.push(`<rect x="${x}" y="${y}" width="${cellW}" height="${cellH + textH}" rx="8" fill="#fff" stroke="#e2e2e2"/>`);
      parts.push(`<text x="${x + 8}" y="${y + 15}" font-size="11.5" font-family="Helvetica, Arial, sans-serif" fill="#444" font-weight="700">${esc(c.title)}</text>`);
      parts.push(`<text x="${x + 8}" y="${y + 29}" font-size="10" font-family="Helvetica, Arial, sans-serif" fill="#888">${esc(c.note)}</text>`);
      if (c.drawing) parts.push(drawingElements(c.drawing, { x: x + 8, y: y + textH + 2, w: cellW - 16, h: cellH - 10 }));
      else parts.push(`<text x="${x + cellW / 2}" y="${y + textH + cellH / 2}" font-size="13" text-anchor="middle" font-family="Helvetica, Arial, sans-serif" fill="#c33">${esc((c.failure ?? "no drawing").slice(0, 60))}</text>`);
    });
    y += cellH + textH + gap;
  }
  const height = y;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"><rect width="${width}" height="${height}" fill="#f4f3ef"/>${parts.join("\n")}</svg>`;
}

/**
 * Writes the sheet as a PNG with `rsvg-convert` (the SVG is written beside it, then removed), then
 * down to a 64-colour palette with ImageMagick when it is installed: line art on a few inks loses
 * nothing to the eye and the file is a third of the size (the sheets live in docs/).
 */
export function writePng(svg: string, pngPath: string): void {
  mkdirSync(dirname(pngPath), { recursive: true });
  const tmp = pngPath.replace(/\.png$/, ".tmp.svg");
  writeFileSync(tmp, svg);
  try {
    execFileSync("rsvg-convert", ["-f", "png", "-o", pngPath, tmp], { stdio: "pipe" });
  } finally {
    unlinkSync(tmp);
  }
  try {
    execFileSync("magick", [pngPath, "-colors", "64", `PNG8:${pngPath}`], { stdio: "pipe" });
  } catch {
    // no ImageMagick: the full-colour PNG stays
  }
}
