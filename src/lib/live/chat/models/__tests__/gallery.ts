import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { polylineToSvgD } from "@/lib/hand";
import type { HandPlan } from "../../../handwriting";
import type { VisualModel } from "../../contracts";
import { MODEL_BOXES, sketchModel, type ModelSketch } from "..";

/**
 * The visual models' contact sheet: realistic specs of every kind, each planned in its largest box
 * and in its smallest, inked as the board inks them (each line in its colour, a closed stroke
 * tinted once whole, a stroke as wide as tldraw draws it at its weight). It exists to be LOOKED AT —
 * a label too close to a line, a lopsided array, a crowded number line is obvious in a picture and
 * invisible to a bounding-box assertion. The real-board check is the dev handle
 * (`window.__agathonChat`, `useLiveMath.ts`) driven by Playwright (docs/qa-screenshots/ask-v2-models).
 *
 *   MODEL_GALLERY=1 npx vitest run src/lib/live/chat/models/__tests__/gallery.test.ts
 *
 * writes docs/qa-screenshots/ask-v2-models/sheet-<kind group>.png (`MODEL_GALLERY=debug` shades the
 * writing's boxes).
 */

/** `big`: too big for its kind's smallest box (999 in blocks): the desk draws it in a larger one. */
export const GALLERY: ReadonlyArray<{ title: string; model: VisualModel; big?: boolean }> = [
  { title: "3 + 4 on a number line", model: { kind: "number_line", from: 0, to: 10, marks: [], jumps: [{ from: 3, to: 7 }] } },
  { title: "skip count by 5s", model: { kind: "number_line", from: 0, to: 20, marks: [], jumps: [{ from: 0, to: 5 }, { from: 5, to: 10 }, { from: 10, to: 15 }, { from: 15, to: 20 }] } },
  { title: "where is 3/4", model: { kind: "number_line", from: 0, to: 1, step: 0.25, marks: [{ at: 0.75 }], jumps: [] } },
  { title: "15 - 7 counting back", model: { kind: "number_line", from: 0, to: 20, marks: [], jumps: [{ from: 15, to: 10 }, { from: 10, to: 8 }] } },
  { title: "-5 to 5, A at -3", model: { kind: "number_line", from: -5, to: 5, marks: [{ at: -3, label: "A" }, { at: 2 }], jumps: [] } },
  { title: "0 to 100 by 10s, 37", model: { kind: "number_line", from: 0, to: 100, step: 10, marks: [{ at: 37, label: "37" }], jumps: [] } },
  { title: "3/4 vs 5/8", model: { kind: "fraction_bars", bars: [{ parts: 4, shaded: 3 }, { parts: 8, shaded: 5 }] } },
  { title: "1/2 = 2/4 = 4/8", model: { kind: "fraction_bars", bars: [{ parts: 2, shaded: 1 }, { parts: 4, shaded: 2 }, { parts: 8, shaded: 4 }] } },
  { title: "2/3 of a bar", model: { kind: "fraction_bars", bars: [{ parts: 3, shaded: 2 }] } },
  { title: "3/4 vs 5/8 circles", model: { kind: "fraction_circles", circles: [{ parts: 4, shaded: 3 }, { parts: 8, shaded: 5 }] } },
  { title: "1/3 = 2/6", model: { kind: "fraction_circles", circles: [{ parts: 3, shaded: 1 }, { parts: 6, shaded: 2 }] } },
  { title: "7/12", model: { kind: "fraction_circles", circles: [{ parts: 12, shaded: 7 }] } },
  { title: "4 × 6 array", model: { kind: "array", rows: 4, cols: 6 } },
  { title: "3 × 4 array", model: { kind: "array", rows: 3, cols: 4 } },
  { title: "8 × 9 array", model: { kind: "array", rows: 8, cols: 9 } },
  { title: "3 groups of 4", model: { kind: "equal_groups", groups: 3, each: 4 } },
  { title: "6 groups of 5", model: { kind: "equal_groups", groups: 6, each: 5 } },
  { title: "share into 4 plates", model: { kind: "equal_groups", groups: 4, each: 0, label: "12 shared by 4" } },
  { title: "23 × 14", model: { kind: "area_model", a: 23, b: 14 } },
  { title: "7 × 8", model: { kind: "area_model", a: 7, b: 8 } },
  { title: "4 × 1,234", model: { kind: "area_model", a: 4, b: 1234 } },
  { title: "345 in blocks", model: { kind: "base_ten", value: 345 } },
  { title: "128 in blocks", model: { kind: "base_ten", value: 128 } },
  { title: "999 in blocks", model: { kind: "base_ten", value: 999 }, big: true },
  { title: "3,405.27", model: { kind: "place_value", value: 3405.27 } },
  { title: "582", model: { kind: "place_value", value: 582 } },
  { title: "1,250,000", model: { kind: "place_value", value: 1250000 }, big: true },
  {
    title: "3 bags of 8 apples",
    model: { kind: "tape", rows: [{ segments: [{ units: 1, label: "8" }, { units: 1, label: "8" }, { units: 1, label: "8" }] }], total: "?" },
  },
  {
    title: "Sam has 3 times as many",
    model: {
      kind: "tape",
      rows: [
        { label: "Sam", segments: [{ units: 1, label: "12" }, { units: 1, label: "12" }, { units: 1, label: "12" }] },
        { label: "Ann", segments: [{ units: 1, label: "12" }] },
      ],
      total: "48",
    },
  },
  { title: "5 + ? = 13", model: { kind: "tape", rows: [{ segments: [{ units: 5, label: "5" }, { units: 8, label: "?" }] }], total: "13" } },
  { title: "7 in a ten frame", model: { kind: "ten_frame", filled: 7 } },
  { title: "13 in ten frames", model: { kind: "ten_frame", filled: 13 } },
  { title: "3:45", model: { kind: "clock", hour: 3, minute: 45 } },
  { title: "10:10", model: { kind: "clock", hour: 10, minute: 10 } },
  { title: "6:30", model: { kind: "clock", hour: 6, minute: 30 } },
];

const TLDRAW: Record<string, { ink: string; tint: string }> = {
  blue: { ink: "#4465e9", tint: "#dce1f8" },
  orange: { ink: "#e16919", tint: "#f8e2d4" },
  green: { ink: "#099268", tint: "#d3e9e3" },
  violet: { ink: "#ae3ec9", tint: "#ecdcf2" },
  "light-blue": { ink: "#4ba1f1", tint: "#ddedfa" },
  yellow: { ink: "#f1ac4b", tint: "#f9f0e6" },
  black: { ink: "#1d1d1d", tint: "#e8e8e8" },
  grey: { ink: "#9fa8b2", tint: "#eceef0" },
};

/** A plan as the board inks it (as lecture mode's sheets do). */
export function planSvg(plan: HandPlan, dx: number, dy: number): string {
  const out: string[] = [];
  for (const line of plan.lines) {
    const c = TLDRAW[line.style?.color ?? "blue"] ?? TLDRAW.blue;
    const fill = line.style?.closed && line.style.fill && line.style.fill !== "none" ? c.tint : "none";
    for (const st of line.strokes) {
      const d = polylineToSvgD(st.points.map((p) => ({ x: +(p.x + line.x + dx).toFixed(2), y: +(p.y + line.y + dy).toFixed(2) }))) + (line.style?.closed ? " Z" : "");
      out.push(`<path d="${d}" fill="${fill}" stroke="${c.ink}" stroke-width="${(0.765 * (1 + 2.4 * (st.weight ?? 1))).toFixed(2)}"/>`);
    }
  }
  return `<g stroke-linecap="round" stroke-linejoin="round">${out.join("")}</g>`;
}

const esc = (t: string) => t.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

export interface GalleryCell {
  title: string;
  box: { w: number; h: number };
  /** the smallest box, for a spec that needs a larger one */
  big?: boolean;
  sketch: ModelSketch | null;
}

/** One sheet: the given entries, each in its largest box (and, with `small`, its smallest too). */
export function buildSheet(entries: ReadonlyArray<{ title: string; model: VisualModel; big?: boolean }>, opts: { small?: boolean; debug?: boolean; columns?: number } = {}): { svg: string; cells: GalleryCell[] } {
  const cells: GalleryCell[] = [];
  for (const e of entries) {
    const boxes = MODEL_BOXES[e.model.kind];
    cells.push({ title: e.title, box: boxes[0], sketch: sketchModel(e.model, boxes[0], 7) });
    if (opts.small) {
      const last = boxes[boxes.length - 1];
      cells.push({ title: `${e.title} (smallest box)`, box: last, sketch: sketchModel(e.model, last, 7), big: e.big });
    }
  }
  const cols = opts.columns ?? 2;
  const cw = Math.max(...cells.map((c) => c.box.w)) + 48;
  const rowsH: number[] = [];
  for (let i = 0; i < cells.length; i += cols) rowsH.push(Math.max(...cells.slice(i, i + cols).map((c) => c.box.h)) + 70);
  const W = cols * cw + 24;
  const H = rowsH.reduce((a, b) => a + b, 0) + 24;
  const parts: string[] = [`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" font-family="Helvetica, Arial" font-size="15"><rect width="100%" height="100%" fill="#f6f6f2"/>`];
  let y = 12;
  for (let r = 0; r < rowsH.length; r++) {
    for (let c = 0; c < cols; c++) {
      const cell = cells[r * cols + c];
      if (!cell) continue;
      const x = 12 + c * cw;
      parts.push(`<rect x="${x}" y="${y}" width="${cw - 12}" height="${rowsH[r] - 12}" rx="10" fill="#fff" stroke="#e4e4de"/>`);
      const s = cell.sketch;
      const note = s ? `${Math.round(s.plan.bounds.w)}×${Math.round(s.plan.bounds.h)} · ${(s.plan.totalMs / (s.plan.pace ?? 1) / 1000).toFixed(1)} s` : "nothing drawn";
      parts.push(`<text x="${x + 14}" y="${y + 22}" fill="#6a7079">${esc(cell.title)} — box ${cell.box.w}×${cell.box.h} — ${note}</text>`);
      const bx = x + 18;
      const by = y + 38;
      parts.push(`<rect x="${bx}" y="${by}" width="${cell.box.w}" height="${cell.box.h}" fill="none" stroke="#e6e3d8" stroke-dasharray="4 4"/>`);
      if (s) {
        if (opts.debug) for (const t of s.texts) parts.push(`<rect x="${(t.rect.x + bx).toFixed(1)}" y="${(t.rect.y + by).toFixed(1)}" width="${t.rect.w.toFixed(1)}" height="${t.rect.h.toFixed(1)}" fill="#ffd9d9" fill-opacity="0.6"/>`);
        parts.push(planSvg(s.plan, bx, by));
      }
    }
    y += rowsH[r];
  }
  parts.push("</svg>");
  return { svg: parts.join(""), cells };
}

/** Writes the sheets as PNGs (rsvg-convert) — or SVGs where it is missing — into docs/qa-screenshots/ask-v2-models. */
export function writeSheets(root: string, sheets: Record<string, string>): string[] {
  const dir = join(root, "docs", "qa-screenshots", "ask-v2-models");
  mkdirSync(dir, { recursive: true });
  const out: string[] = [];
  for (const [name, svg] of Object.entries(sheets)) {
    const tmp = join(tmpdir(), `model-gallery-${name}-${process.pid}.svg`);
    writeFileSync(tmp, svg);
    let done = false;
    for (const bin of ["rsvg-convert", "/opt/homebrew/bin/rsvg-convert"]) {
      try {
        execFileSync(bin, ["-o", join(dir, `${name}.png`), tmp]);
        out.push(join(dir, `${name}.png`));
        done = true;
        break;
      } catch {
        // the next location
      }
    }
    if (!done) {
      writeFileSync(join(dir, `${name}.svg`), svg);
      out.push(join(dir, `${name}.svg`));
    }
  }
  return out;
}
