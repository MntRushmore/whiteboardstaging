/**
 * A figure as the board's crop looks: `LiveLoop.captureCrop` asks tldraw for the drawing's strokes
 * and its labels on a white background, 8 px of padding inside a box grown by 8 px, at scale
 * min(1, 768 / width) (`FIGURE_CROP_WIDTH`), as a JPEG. Here: the same strokes as an SVG — black
 * round-capped polylines 3.5 px wide (tldraw's "m" draw size), a 16 px white margin, the same scale —
 * turned into a PNG by `rsvg-convert` (no npm dependency; the eval is skipped where it is missing).
 */
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import type { InkStroke } from "@/lib/live/contracts";

const CANDIDATES = ["/opt/homebrew/bin/rsvg-convert", "/usr/local/bin/rsvg-convert", "/usr/bin/rsvg-convert"];

/** The rsvg-convert binary, or null when this machine has none. */
export function rsvgPath(): string | null {
  for (const p of CANDIDATES) if (existsSync(p)) return p;
  try {
    const found = execFileSync("which", ["rsvg-convert"], { encoding: "utf8" }).trim();
    return found && existsSync(found) ? found : null;
  } catch {
    return null;
  }
}

/** The crop's width cap for a figure (`FIGURE_CROP_WIDTH` in liveLoop.ts). */
export const FIGURE_CROP_WIDTH = 768;
const MARGIN = 16;
const STROKE = 3.5;

export function figureSvg(strokes: readonly InkStroke[]): { svg: string; width: number; height: number } {
  const pts = strokes.flatMap((s) => s.segments.flat());
  const minX = Math.min(...pts.map((p) => p.x));
  const minY = Math.min(...pts.map((p) => p.y));
  const w = Math.max(...pts.map((p) => p.x)) - minX + 2 * MARGIN;
  const h = Math.max(...pts.map((p) => p.y)) - minY + 2 * MARGIN;
  const scale = Math.min(1, FIGURE_CROP_WIDTH / w);
  const W = Math.round(w * scale);
  const H = Math.round(h * scale);
  const paths = strokes
    .flatMap((s) => s.segments)
    .filter((seg) => seg.length > 0)
    .map((seg) => {
      const d = seg.map((p, i) => `${i === 0 ? "M" : "L"}${((p.x - minX + MARGIN) * scale).toFixed(1)} ${((p.y - minY + MARGIN) * scale).toFixed(1)}`).join(" ");
      return `<path d="${seg.length === 1 ? `${d} l0.01 0` : d}"/>`;
    })
    .join("");
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}"><rect width="${W}" height="${H}" fill="#ffffff"/><g fill="none" stroke="#1d1d1d" stroke-width="${(STROKE * scale).toFixed(2)}" stroke-linecap="round" stroke-linejoin="round">${paths}</g></svg>`;
  return { svg, width: W, height: H };
}

/** The figure as a PNG data URL (and its size), through rsvg-convert. */
export function figurePng(strokes: readonly InkStroke[], rsvg: string): { dataUrl: string; png: Buffer; width: number; height: number } {
  const { svg, width, height } = figureSvg(strokes);
  const png = execFileSync(rsvg, ["-f", "png"], { input: svg, maxBuffer: 16 * 1024 * 1024 });
  return { dataUrl: `data:image/png;base64,${png.toString("base64")}`, png, width, height };
}
