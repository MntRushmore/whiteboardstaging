import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { polylineToSvgD } from "@/lib/hand";
import type { FigureSpec } from "../contracts";
import { layoutFigure, planFigure } from "../plan";

/**
 * A contact sheet of the tutor's figures: each spec below drawn by `planFigure`, stroke for stroke,
 * exactly as the HandWriter would put it on the board. It exists to be LOOKED AT — a name on top of
 * a side, an arc too small to see or a label on the wrong side is obvious in a picture and easy to
 * miss in an assertion.
 *
 *   FIGURE_GALLERY=1 npx vitest run src/lib/live/figureDraw/__tests__/gallery.test.ts
 *
 * writes docs/figure/gallery.png (via `rsvg-convert`) and docs/figure/gallery.svg; every ordinary
 * test run builds the same sheet in memory (`gallery.test.ts`).
 */

const rad = (d: number) => (d * Math.PI) / 180;
const polar = (r: number, deg: number, c = { x: 0, y: 0 }) => ({ x: +(c.x + r * Math.cos(rad(deg))).toFixed(4), y: +(c.y + r * Math.sin(rad(deg))).toFixed(4) });

/** The transversal of `parallel`: at 70° to the two lines y = 2 and y = 0. */
const E = { x: 0.6, y: 2 };
const F = { x: +(0.6 - 2 / Math.tan(rad(70))).toFixed(4), y: 0 };

/** The triangle of `exterior`: 60° at A, 70° at C, side AB extended to D. */
const extC = (() => {
  const s = 5 / (Math.cos(rad(60)) * (Math.sin(rad(130)) / Math.sin(rad(60))) - Math.cos(rad(130)));
  const t = (s * Math.sin(rad(130))) / Math.sin(rad(60));
  return { x: +(t * Math.cos(rad(60))).toFixed(4), y: +(t * Math.sin(rad(60))).toFixed(4) };
})();

export const FIGURE_GALLERY: ReadonlyArray<{ title: string; spec: FigureSpec }> = [
  {
    title: "right triangle 3, 4, x",
    spec: {
      points: { A: { x: 0, y: 3 }, B: { x: 0, y: 0 }, C: { x: 4, y: 0 } },
      polygons: [{ vertices: ["A", "B", "C"] }],
      segments: [
        { from: "A", to: "B", label: "3" },
        { from: "B", to: "C", label: "4" },
        { from: "C", to: "A", label: "x" },
      ],
      angles: [{ at: "B", from: "A", to: "C", right: true }],
    },
  },
  {
    title: "isosceles: ticks and equal angles",
    spec: {
      points: { A: { x: 0, y: 4 }, B: { x: -2.2, y: 0 }, C: { x: 2.2, y: 0 } },
      polygons: [{ vertices: ["A", "B", "C"] }],
      segments: [
        { from: "A", to: "B", ticks: 1 },
        { from: "A", to: "C", ticks: 1 },
      ],
      angles: [
        { at: "B", from: "C", to: "A", arcs: 2 },
        { at: "C", from: "A", to: "B", arcs: 2 },
        { at: "A", from: "B", to: "C", label: "x" },
      ],
    },
  },
  {
    title: "equilateral",
    spec: {
      points: { P: { x: -3, y: 0 }, Q: { x: 3, y: 0 }, R: { x: 0, y: +(3 * Math.sqrt(3)).toFixed(4) } },
      polygons: [{ vertices: ["P", "Q", "R"] }],
      segments: [
        { from: "P", to: "Q", ticks: 1, label: "6" },
        { from: "Q", to: "R", ticks: 1 },
        { from: "R", to: "P", ticks: 1 },
      ],
      angles: [{ at: "R", from: "P", to: "Q", label: "60^{\\circ}" }],
    },
  },
  {
    title: "parallel lines, a transversal: 70° and x",
    spec: {
      points: {
        A: { x: -3, y: 2, label: false },
        B: { x: 3, y: 2, label: false },
        C: { x: -3, y: 0, label: false },
        D: { x: 3, y: 0, label: false },
        E: { ...E, label: false },
        F: { ...F, label: false },
        G: { ...polar(1, 70, E), label: false },
        H: { ...polar(1, 250, F), label: false },
      },
      lines: [
        { through: ["A", "B"], arrows: 1, label: "\\ell" },
        { through: ["C", "D"], arrows: 1, label: "m" },
        { through: ["H", "G"], label: "t" },
      ],
      angles: [
        { at: "E", from: "B", to: "G", label: "70^{\\circ}" },
        { at: "F", from: "D", to: "E", label: "x" },
      ],
    },
  },
  {
    title: "vertical angles",
    spec: {
      points: {
        O: { x: 0, y: 0 },
        A: { ...polar(3, 205), label: false },
        B: { ...polar(3, 25), label: false },
        C: { ...polar(3, 140), label: false },
        D: { ...polar(3, 320), label: false },
      },
      lines: [{ through: ["A", "B"] }, { through: ["C", "D"] }],
      angles: [
        { at: "O", from: "B", to: "C", label: "115^{\\circ}" },
        { at: "O", from: "A", to: "D", label: "x" },
      ],
    },
  },
  {
    title: "linear pair",
    spec: {
      points: { A: { x: -3, y: 0 }, B: { x: 0, y: 0 }, C: { x: 3, y: 0 }, D: polar(2.6, 55) },
      lines: [
        { through: ["A", "C"] },
        { through: ["B", "D"], extend: "ray" },
      ],
      angles: [
        { at: "B", from: "C", to: "D", label: "55^{\\circ}" },
        { at: "B", from: "D", to: "A", label: "x" },
      ],
    },
  },
  {
    title: "circle: centre O, radius 5, a chord",
    spec: {
      points: { O: { x: 0, y: 0 }, A: polar(5, -30), B: polar(5, 155), C: polar(5, 70) },
      circles: [{ center: "O", radius: 5 }],
      segments: [
        { from: "O", to: "A", label: "5" },
        { from: "B", to: "C" },
      ],
    },
  },
  {
    title: "inscribed and central angle",
    spec: {
      points: { O: { x: 0, y: 0 }, A: polar(4, 200), B: polar(4, 340), C: polar(4, 90) },
      circles: [{ center: "O", through: "A" }],
      segments: [
        { from: "C", to: "A" },
        { from: "C", to: "B" },
        { from: "O", to: "A" },
        { from: "O", to: "B" },
      ],
      angles: [
        { at: "C", from: "A", to: "B", label: "x" },
        { at: "O", from: "A", to: "B", label: "140^{\\circ}" },
      ],
    },
  },
  {
    title: "a tangent at T",
    spec: {
      points: { O: { x: 0, y: 0 }, T: polar(3, -60), P: { x: +(1.5 + 3 * Math.cos(rad(30))).toFixed(4), y: +(-3 * Math.sin(rad(60)) + 3 * Math.sin(rad(30))).toFixed(4) } },
      circles: [{ center: "O", radius: 3 }],
      segments: [{ from: "O", to: "T", label: "3" }],
      lines: [{ through: ["T", "P"] }],
      angles: [{ at: "T", from: "O", to: "P", right: true }],
    },
  },
  {
    title: "rectangle and its diagonals",
    spec: {
      points: { A: { x: 0, y: 0 }, B: { x: 8, y: 0 }, C: { x: 8, y: 5 }, D: { x: 0, y: 5 }, E: { x: 4, y: 2.5 } },
      polygons: [{ vertices: ["A", "B", "C", "D"] }],
      segments: [
        { from: "A", to: "B", label: "8" },
        { from: "B", to: "C", label: "5" },
        { from: "A", to: "C" },
        { from: "B", to: "D" },
        { from: "A", to: "E", ticks: 1 },
        { from: "E", to: "C", ticks: 1 },
        { from: "B", to: "E", ticks: 1 },
        { from: "E", to: "D", ticks: 1 },
      ],
      angles: [{ at: "D", from: "A", to: "C", right: true }],
    },
  },
  {
    title: "parallelogram: arrows and ticks",
    spec: {
      points: { A: { x: 0, y: 0 }, B: { x: 5, y: 0 }, C: { x: 6.6, y: 3 }, D: { x: 1.6, y: 3 } },
      polygons: [{ vertices: ["A", "B", "C", "D"] }],
      segments: [
        { from: "A", to: "B", arrows: 1, ticks: 1 },
        { from: "D", to: "C", arrows: 1, ticks: 1 },
        { from: "A", to: "D", arrows: 2, ticks: 2 },
        { from: "B", to: "C", arrows: 2, ticks: 2 },
      ],
    },
  },
  {
    title: "trapezoid",
    spec: {
      points: { A: { x: 0, y: 0 }, B: { x: 7, y: 0 }, C: { x: 5, y: 3 }, D: { x: 2, y: 3 }, E: { x: 2, y: 0 } },
      polygons: [{ vertices: ["A", "B", "C", "D"] }],
      segments: [
        { from: "A", to: "B", label: "7", arrows: 1 },
        { from: "D", to: "C", label: "3", arrows: 1 },
        { from: "D", to: "E", dashed: true, label: "h" },
      ],
      angles: [{ at: "E", from: "B", to: "D", right: true }],
    },
  },
  {
    title: "regular hexagon",
    spec: {
      points: {
        A: polar(3, 0),
        B: polar(3, 60),
        C: polar(3, 120),
        D: polar(3, 180),
        E: polar(3, 240),
        F: polar(3, 300),
        O: { x: 0, y: 0 },
      },
      polygons: [{ vertices: ["A", "B", "C", "D", "E", "F"] }],
      segments: [
        { from: "O", to: "A", dashed: true, label: "3" },
        { from: "A", to: "B", label: "3" },
      ],
      angles: [{ at: "C", from: "D", to: "B", label: "120^{\\circ}" }],
    },
  },
  {
    title: "similar triangles",
    spec: {
      points: { A: { x: 0, y: 0 }, B: { x: 4, y: 0 }, C: { x: 0, y: 3 }, D: { x: 6, y: 0 }, E: { x: 14, y: 0 }, F: { x: 6, y: 6 } },
      polygons: [{ vertices: ["A", "B", "C"] }, { vertices: ["D", "E", "F"] }],
      segments: [
        { from: "A", to: "B", label: "4" },
        { from: "A", to: "C", label: "3" },
        { from: "D", to: "E", label: "8" },
        { from: "E", to: "F", label: "x" },
      ],
      angles: [
        { at: "A", from: "B", to: "C", right: true },
        { at: "D", from: "E", to: "F", right: true },
        { at: "B", from: "C", to: "A", arcs: 1 },
        { at: "E", from: "F", to: "D", arcs: 1 },
      ],
    },
  },
  {
    title: "exterior angle",
    spec: {
      points: { A: { x: 0, y: 0 }, B: { x: 5, y: 0 }, C: extC, D: { x: 7.5, y: 0 } },
      polygons: [{ vertices: ["A", "B", "C"] }],
      segments: [{ from: "B", to: "D" }],
      angles: [
        { at: "A", from: "B", to: "C", label: "60^{\\circ}" },
        { at: "C", from: "A", to: "B", label: "70^{\\circ}" },
        { at: "B", from: "D", to: "C", label: "x" },
      ],
    },
  },
  {
    title: "a ray and a line",
    spec: {
      points: { A: { x: -3, y: -1 }, B: { x: 2, y: 0.4 }, P: { x: -2, y: 1.6 }, Q: { x: 1.4, y: 3 } },
      lines: [
        { through: ["A", "B"], label: "\\ell" },
        { through: ["P", "Q"], extend: "ray" },
      ],
    },
  },
];

const PAD = 24;
const TITLE = 30;
export const GALLERY_BOX = { w: 420, h: 340 };
const CELL = { w: GALLERY_BOX.w + 20, h: GALLERY_BOX.h + TITLE + 26 };
const COLS = 4;

export interface GalleryCell {
  title: string;
  drawn: boolean;
  strokes: number;
  wallMs: number;
  collisions: number;
  scale: number;
}

export function buildGallery(): { svg: string; cells: GalleryCell[] } {
  const cells: GalleryCell[] = [];
  const parts: string[] = [];
  FIGURE_GALLERY.forEach((item, i) => {
    const col = i % COLS;
    const row = Math.floor(i / COLS);
    const ox = PAD + col * (CELL.w + PAD);
    const oy = PAD + row * (CELL.h + PAD);
    const seed = 11 + i * 97;
    const planned = planFigure(item.spec, { seed, box: GALLERY_BOX });
    const layout = layoutFigure(item.spec, { seed, box: GALLERY_BOX });
    const cell: GalleryCell = { title: item.title, drawn: Boolean(planned), strokes: 0, wallMs: 0, collisions: layout?.collisions ?? -1, scale: layout?.scale ?? 0 };
    parts.push(`<rect x="${ox}" y="${oy}" width="${CELL.w}" height="${CELL.h}" rx="10" fill="#ffffff" stroke="#e4e4de"/>`);
    parts.push(`<text x="${ox + 14}" y="${oy + 22}" fill="#8a9099">${esc(item.title)}${planned ? "" : "  [nothing drawn]"}</text>`);
    // the box the figure was fitted to, faint
    const bx = ox + 10;
    const by = oy + TITLE;
    parts.push(`<rect x="${bx}" y="${by}" width="${GALLERY_BOX.w}" height="${GALLERY_BOX.h}" fill="none" stroke="#f0f0ea" stroke-dasharray="4 4"/>`);
    if (planned) {
      const paths: string[] = [];
      for (const line of planned.plan.lines) {
        for (const s of line.strokes) {
          paths.push(polylineToSvgD(s.points.map((p) => ({ x: +(p.x + line.x + bx).toFixed(1), y: +(p.y + line.y + by).toFixed(1) }))));
        }
      }
      cell.strokes = paths.length;
      cell.wallMs = planned.plan.totalMs / (planned.plan.pace ?? 1);
      parts.push(`<g fill="none" stroke="#3558d6" stroke-width="3" stroke-linecap="round" stroke-linejoin="round">${paths.map((d) => `<path d="${d}"/>`).join("")}</g>`);
      parts.push(
        `<text x="${ox + CELL.w - 14}" y="${oy + CELL.h - 10}" text-anchor="end" fill="#b0b4ba">${cell.strokes} strokes · ${(cell.wallMs / 1000).toFixed(1)} s${cell.collisions ? ` · ${cell.collisions} crowded` : ""}</text>`,
      );
    }
    cells.push(cell);
  });
  const rows = Math.ceil(FIGURE_GALLERY.length / COLS);
  const width = PAD + COLS * (CELL.w + PAD);
  const height = PAD + rows * (CELL.h + PAD);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
<rect width="100%" height="100%" fill="#f4f4ef"/>
${parts.join("\n")}
</svg>`.replace(/<text /g, '<text font-family="Menlo, monospace" font-size="12" ');
  return { svg, cells };
}

function esc(t: string): string {
  return t.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** Writes docs/figure/gallery.svg and, through `rsvg-convert`, docs/figure/gallery.png; returns the paths written. */
export function writeGallery(root: string, svg: string): string[] {
  const dir = join(root, "docs", "figure");
  mkdirSync(dir, { recursive: true });
  const svgPath = join(dir, "gallery.svg");
  writeFileSync(svgPath, svg);
  const tmp = join(tmpdir(), `figure-gallery-${process.pid}.svg`);
  writeFileSync(tmp, svg);
  for (const bin of ["rsvg-convert", "/opt/homebrew/bin/rsvg-convert"]) {
    try {
      execFileSync(bin, ["-o", join(dir, "gallery.png"), tmp]);
      return [svgPath, join(dir, "gallery.png")];
    } catch {
      // try the next location
    }
  }
  return [svgPath];
}
