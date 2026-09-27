import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { polylineToSvgD } from "@/lib/hand";
import type { LiveEngine } from "../../contracts";
import { planGraph } from "../plan";

/**
 * A contact sheet of the tutor's graphs: each column of work below is graphed by the real engine
 * (`graphFor`) and sketched by `planGraph`, stroke for stroke, exactly as the HandWriter would put
 * it on the board. It exists to be LOOKED AT — a label on top of a curve, a crowded axis or a
 * hatch through a number is obvious in a picture and invisible to a bounding-box assertion.
 *
 *   GRAPH_GALLERY=1 npx vitest run src/lib/live/graphing/__tests__/gallery.test.ts
 *
 * writes docs/graph/gallery.png (via `rsvg-convert`); every ordinary test run builds the same
 * sheet in memory (`gallery.test.ts`), so a graph that stops drawing fails there too.
 */
export const GRAPH_GALLERY: ReadonlyArray<{ title: string; lines: string[] }> = [
  { title: "y = 2x + 1", lines: ["y = 2x + 1"] },
  { title: "2x + 3y = 6", lines: ["2x + 3y = 6"] },
  { title: "f(x) = x^2 - 2x - 3", lines: ["f(x) = x^{2} - 2x - 3"] },
  { title: "y = |x - 2| + 1", lines: ["y = |x - 2| + 1"] },
  { title: "y = \\sqrt{x + 4}", lines: ["y = \\sqrt{x + 4}"] },
  { title: "y = 2^x + 1", lines: ["y = 2^{x} + 1"] },
  { title: "y = \\log_2(x)", lines: ["y = \\log_{2}(x)"] },
  { title: "y = (2x + 1)/(x - 1)", lines: ["y = \\frac{2x + 1}{x - 1}"] },
  { title: "y = x^3 - 3x", lines: ["y = x^{3} - 3x"] },
  { title: "x + y = 6,  x - y = 2", lines: ["x + y = 6", "x - y = 2"] },
  { title: "y = 2x - 1,  y = -x + 5", lines: ["y = 2x - 1", "y = -x + 5"] },
  { title: "y < 2x + 1", lines: ["y < 2x + 1"] },
  { title: "2x + 3y \\ge 6", lines: ["2x + 3y \\ge 6"] },
  { title: "(x - 1)^2 + (y + 2)^2 = 9", lines: ["(x - 1)^{2} + (y + 2)^{2} = 9"] },
  { title: "x^2 + y^2 = 25,  y = x + 1", lines: ["x^{2} + y^{2} = 25", "y = x + 1"] },
  { title: "2x + 3 > 11  ->  x > 4", lines: ["2x + 3 > 11", "2x > 8", "x > 4"] },
  { title: "-2 \\le x < 3", lines: ["-2 \\le x < 3"] },
  { title: "x < 2, x \\ge 3", lines: ["x < 2, \\ x \\ge 3"] },
];

const PAD = 28;
const CELL = { w: 440, h: 400 };
const COLS = 3;

export interface GalleryCell {
  title: string;
  kind: "plane" | "numberLine" | null;
  strokes: number;
  wallMs: number;
  paths: string[];
  bounds: { x: number; y: number; w: number; h: number } | null;
}

export function buildGallery(engine: LiveEngine): { svg: string; cells: GalleryCell[] } {
  const cells: GalleryCell[] = [];
  const parts: string[] = [];
  GRAPH_GALLERY.forEach((item, i) => {
    const col = i % COLS;
    const row = Math.floor(i / COLS);
    const ox = PAD + col * (CELL.w + PAD);
    const oy = PAD + row * (CELL.h + PAD);
    const intent = engine.graphFor?.(item.lines) ?? null;
    const planned = intent ? planGraph(intent, { seed: 7 + i * 101 }) : null;
    const cell: GalleryCell = { title: item.title, kind: intent?.kind ?? null, strokes: 0, wallMs: 0, paths: [], bounds: null };
    parts.push(`<rect x="${ox}" y="${oy}" width="${CELL.w}" height="${CELL.h}" rx="10" fill="#ffffff" stroke="#e4e4de"/>`);
    parts.push(`<text x="${ox + 14}" y="${oy + 22}" fill="#8a9099">${esc(item.title)}${planned ? "" : "  [nothing drawn]"}</text>`);
    if (planned) {
      const plan = planned.plan;
      // centre the sketch's ink in the cell, under the title
      const dx = ox + (CELL.w - plan.bounds.w) / 2 - plan.bounds.x;
      const dy = oy + 36 + (CELL.h - 36 - plan.bounds.h) / 2 - plan.bounds.y;
      for (const line of plan.lines) {
        for (const s of line.strokes) {
          const d = polylineToSvgD(s.points.map((p) => ({ x: +(p.x + line.x + dx).toFixed(2), y: +(p.y + line.y + dy).toFixed(2) })));
          cell.paths.push(d);
        }
      }
      cell.strokes = cell.paths.length;
      cell.wallMs = plan.totalMs / (plan.pace ?? 1);
      cell.bounds = plan.bounds;
      parts.push(`<g fill="none" stroke="#3558d6" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${cell.paths.map((d) => `<path d="${d}"/>`).join("")}</g>`);
      parts.push(
        `<text x="${ox + CELL.w - 14}" y="${oy + CELL.h - 10}" text-anchor="end" fill="#b0b4ba">${cell.strokes} strokes · ${(cell.wallMs / 1000).toFixed(1)} s</text>`,
      );
    }
    cells.push(cell);
  });
  const rows = Math.ceil(GRAPH_GALLERY.length / COLS);
  const width = PAD + COLS * (CELL.w + PAD);
  const height = PAD + rows * (CELL.h + PAD);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
<rect width="100%" height="100%" fill="#f4f4ef"/>
<g font-family="Menlo, monospace" font-size="12" stroke="none">
</g>
${parts.join("\n")}
</svg>`.replace(/<text /g, '<text font-family="Menlo, monospace" font-size="12" ');
  return { svg, cells };
}

function esc(t: string): string {
  return t.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** Writes `docs/graph/gallery.png` through `rsvg-convert` (or the SVG when it is missing); returns the path. */
export function writeGallery(root: string, svg: string): string {
  const dir = join(root, "docs", "graph");
  mkdirSync(dir, { recursive: true });
  const tmp = join(tmpdir(), `graph-gallery-${process.pid}.svg`);
  writeFileSync(tmp, svg);
  for (const bin of ["rsvg-convert", "/opt/homebrew/bin/rsvg-convert"]) {
    try {
      execFileSync(bin, ["-o", join(dir, "gallery.png"), tmp]);
      return join(dir, "gallery.png");
    } catch {
      // try the next location
    }
  }
  writeFileSync(join(dir, "gallery.svg"), svg);
  return join(dir, "gallery.svg");
}
