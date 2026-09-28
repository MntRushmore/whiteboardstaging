import { describe, expect, it } from "vitest";
import { boundsOf, DRAWINGS, Pen, writeAt } from "@/__eval__/drawings";
import { VARIANTS } from "@/__eval__/handwriting";
import type { InkStroke } from "../../contracts";
import { splitInk } from "../../diagrams";
import { clusterLines } from "../../strokeClusters";
import { tableRules } from "../table";

const ROWS: Array<[string, string]> = [
  ["\\overline{AB} \\cong \\overline{CB}", "\\text{Given}"],
  ["\\overline{AD} \\cong \\overline{CD}", "\\text{Given}"],
  ["\\overline{BD} \\cong \\overline{BD}", "\\text{Reflexive}"],
  ["\\triangle ABD \\cong \\triangle CBD", "\\text{SSS}"],
];

/** A proof in the student's hand: optional header and T-table, rows 80 px apart. */
function proofScene(opts: { header?: boolean; bar?: boolean; divider?: boolean; rows?: number; variant?: number } = {}) {
  const variant = VARIANTS[opts.variant ?? 1];
  const pen = new Pen("table", 3);
  const parts: InkStroke[][] = [];
  const top = 100;
  if (opts.header) parts.push(writeAt("\\text{Statements}", 100, top, variant), writeAt("\\text{Reasons}", 580, top, variant));
  const rules: InkStroke[] = [];
  const y0 = top + 60;
  const n = opts.rows ?? ROWS.length;
  if (opts.bar) rules.push(pen.stroke({ x: 80, y: y0 }, { x: 900, y: y0 + 3 }));
  if (opts.divider) rules.push(pen.stroke({ x: 540, y: y0 - 2 }, { x: 543, y: y0 + 40 + 80 * n }));
  parts.push(rules);
  const lines: InkStroke[][] = [];
  ROWS.slice(0, n).forEach(([s, r], i) => {
    const y = y0 + 22 + 80 * i;
    lines.push(writeAt(s, 100, y, variant), writeAt(r, 580, y + 4, variant));
  });
  return { rules, lines, header: parts[0], all: [...parts.flat(), ...lines.flat()] };
}

/** Every written line is exactly one line of the clusterer, with exactly its strokes. */
function linesIntact(all: readonly InkStroke[], written: readonly InkStroke[][]): boolean {
  const split = splitInk(all);
  const lines = clusterLines(split.writing);
  return written.every((w) => {
    const ids = new Set<string>(w.map((s) => s.id));
    return lines.some((l) => l.strokeIds.length === ids.size && l.strokeIds.every((id) => ids.has(id)));
  });
}

describe("a proof's T-table", () => {
  it("the bar and the divider are table rules; every statement and reason stays a line of its own", () => {
    for (let v = 0; v < VARIANTS.length; v++) {
      const scene = proofScene({ header: true, bar: true, divider: true, variant: v });
      const split = splitInk(scene.all);
      for (const r of scene.rules) expect(split.roles.get(r.id)?.role, VARIANTS[v].name).toBe("table");
      expect(split.diagrams, VARIANTS[v].name).toEqual([]);
      expect(linesIntact(scene.all, scene.lines), VARIANTS[v].name).toBe(true);
    }
  });

  it("a T drawn before the first row is complete is a table as soon as there is writing beside it", () => {
    const scene = proofScene({ header: true, bar: true, divider: true, rows: 1 });
    expect(splitInk(scene.all).roles.get(scene.rules[1].id)?.role).toBe("table");
    expect(linesIntact(scene.all, scene.lines)).toBe(true);
  });

  it("a divider with no bar is a table rule once two rows sit level on both sides of it", () => {
    const scene = proofScene({ divider: true });
    expect(splitInk(scene.all).roles.get(scene.rules[0].id)?.role).toBe("table");
    expect(linesIntact(scene.all, scene.lines)).toBe(true);
  });

  it("without the table the rows read the same", () => {
    const scene = proofScene({ header: true });
    expect(linesIntact(scene.all, scene.lines)).toBe(true);
  });

  it("the figure beside a proof is still a drawing, with its labels", () => {
    const scene = proofScene({ header: true, bar: true, divider: true });
    const b = boundsOf(scene.all);
    const tri = DRAWINGS.triangle(b.x + b.w + 80, 120, 5);
    const all = [...scene.all, ...tri.strokes, ...tri.labels.flat()];
    const split = splitInk(all);
    expect(split.diagrams).toHaveLength(1);
    expect(split.diagrams[0].labels.length).toBe(tri.labels.length);
    expect(linesIntact(all, scene.lines)).toBe(true);
  });

  it("an inverted T (an altitude on its base) is not a table; nor is a line of maths", () => {
    const pen = new Pen("alt", 1);
    const base = pen.stroke({ x: 100, y: 400 }, { x: 400, y: 401 });
    const altitude = pen.stroke({ x: 250, y: 150 }, { x: 251, y: 400 });
    const labels = [...writeAt("A", 80, 405), ...writeAt("C", 405, 405), ...writeAt("B", 245, 120)];
    expect(tableRules([base, altitude, ...labels], 20).size).toBe(0);
    for (const latex of ["\\frac{3x^{2} + 2x - 1}{x - 4}", "\\int_{0}^{2} 3x^{2} \\, dx", "\\left| \\frac{x}{2} - 1 \\right| = 3", "\\begin{bmatrix} 1 & 2 \\\\ 3 & 4 \\end{bmatrix}"]) {
      const ink = writeAt(latex, 100, 100);
      expect(tableRules(ink, 20).size, latex).toBe(0);
    }
  });

  it("a quadrilateral with a side run on past a corner is not a table: its corner marks and labels are not rows", () => {
    // the T: the top side, and the right side (slanted) hanging from it; the labels sit at the
    // corners, one of them straddling the right side's middle x
    const pen = new Pen("quad", 4);
    const sides = [
      pen.stroke({ x: 59, y: 220 }, { x: 86, y: 12 }),
      pen.stroke({ x: 80, y: 60 }, { x: 327, y: 46 }),
      pen.stroke({ x: 270, y: 50 }, { x: 308, y: 284 }),
      pen.stroke({ x: 300, y: 229 }, { x: -12, y: 216 }),
    ];
    const marks = [pen.arc(91, 50, 8, 8), pen.arc(282, 59, 8, 10), pen.arc(292, 238, 11, 10), pen.arc(52, 210, 10, 9)];
    const labels = [...writeAt("x", 104, 27), ...writeAt("100^{\\circ}", 277, 64), ...writeAt("90^{\\circ}", 254, 249), ...writeAt("80^{\\circ}", 15, 178)];
    expect(tableRules([...sides, ...marks, ...labels], 18).size).toBe(0);
  });
});
