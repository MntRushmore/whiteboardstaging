import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Relative imports so this file also runs on its own under `jiti` (no `@/` alias there).
import { layoutMath } from "../mathLayout";
import { polylineToSvgD } from "../path";

/**
 * A contact sheet of the tutor's hand: representative lines of what the engine emits,
 * rendered stroke-for-stroke to SVG. It exists to be LOOKED AT — overlapping limits, a
 * tiny integral sign or a script that falls off its base are obvious in a picture and
 * invisible in a bounding-box assertion.
 *
 *   npx jiti src/lib/hand/__tests__/gallery.ts
 *
 * writes docs/hand/gallery.png (via `rsvg-convert`, on the PATH or in /opt/homebrew/bin).
 * `gallery.test.ts` builds the same sheet in memory on every test run, so a construct
 * that stops rendering fails there too.
 */

export const GALLERY: readonly string[] = [
  "\\frac{d}{dx}\\left(x^{3} - 2x\\right) = 3x^{2} - 2",
  "\\frac{dy}{dx} = 2x \\cdot e^{x^{2}}",
  "\\frac{d^{2}y}{dx^{2}} = -\\sin x",
  "f'(x) = 6x + 1, \\quad f''(x) = 6",
  "y' = \\frac{1}{x} + \\ln x",
  "\\int x^{2}\\,dx = \\frac{x^{3}}{3} + C",
  "\\int_{0}^{2} 3x^{2}\\,dx = \\left[ x^{3} \\right]_{0}^{2} = 8",
  "\\int_{-1}^{1} \\frac{1}{1 + x^{2}}\\,dx",
  "= \\frac{x^{4}}{4} \\bigg|_{0}^{2} = 4",
  "\\Big[ 2\\sqrt{x} \\Big]_{1}^{9} = 4",
  "\\iint_{R} xy\\,dA",
  "\\lim_{x \\to 2} \\frac{x^{2} - 4}{x - 2} = 4",
  "\\lim_{x \\to \\infty} \\left(1 + \\frac{1}{x}\\right)^{x} = e",
  "\\sum_{i=1}^{n} i = \\frac{n(n+1)}{2}",
  "x = \\frac{-b \\pm \\sqrt{b^{2} - 4ac}}{2a}",
  "x = \\frac{4 \\pm 2\\sqrt{3}}{2} = 2 \\pm \\sqrt{3}",
  "x = 2 \\text{ or } x = 3",
  "\\left| 2x - 3 \\right| = 5",
  "|x - 1| < 4 \\Rightarrow -3 < x < 5",
  "\\ln|x| + C",
  "\\log_{2} 8 = 3, \\ \\log_{5} 7 \\approx 1.21",
  "e^{2x} = 5 \\Rightarrow x = \\frac{\\ln 5}{2}",
  "\\sqrt[3]{x} = x^{\\frac{1}{3}}, \\quad x^{-2} = \\frac{1}{x^{2}}",
  "\\sin^{2} x + \\cos^{2} x = 1",
  "\\tan^{-1}(1) = \\frac{\\pi}{4}",
  "\\cos(3x) \\ne 0, \\ \\theta = 30^\\circ",
  "\\alpha + \\beta + \\gamma = 180^\\circ",
  "\\delta \\varepsilon \\lambda \\mu \\sigma \\phi \\omega \\rho \\tau",
  "\\Delta x \\quad \\Sigma \\quad \\Omega \\quad \\Pi",
  "x \\in \\mathbb{R}, \\ x \\notin \\{1, 2\\}",
  "x \\in (2, 3) \\cup [4, \\infty)",
  "\\varnothing \\quad \\emptyset \\quad \\mathbb{Z} \\subset \\mathbb{Q} \\subset \\mathbb{C}",
  "a \\le b, \\ c \\geq d, \\ p \\approx 3.14",
  "3 \\times 4 \\div 2 \\cdot 5 = 30",
  "15\\% \\text{ of } 80 = 12",
  "\\left(\\frac{1}{2}\\right)^{2} = \\frac{1}{4}",
  "\\frac{\\frac{1}{x} + 1}{x - \\frac{1}{2}}",
  "\\overline{x} = 4.5, \\quad \\vec{v} = (1, 2)",
  "\\begin{cases} x + y = 5 \\\\ x - y = 1 \\end{cases}",
  "\\begin{cases} x + y + z = 6 \\\\ x - y + z = 2 \\\\ 2x + y - z = 1 \\end{cases}",
  "\\begin{pmatrix} 1 & 2 \\\\ 3 & 4 \\end{pmatrix}",
  "4\\,\\mathrm{Fe} + 3\\,\\mathrm{O_{2}} \\rightarrow 2\\,\\mathrm{Fe_{2}O_{3}}",
  "\\mathrm{d}x, \\ \\operatorname{d}t, \\ \\mathrm{e}^{i\\pi} = -1",
  "x \\to -\\infty, \\ \\therefore \\ x_{1} = 2, \\ x_{2} = 3",
];

const SIZE = 30;
const PAD = 18;
/** Width of one of the sheet's two columns, in px. */
export const COL_W = 780;
const LABEL_H = 13;
const ROW_GAP = 14;

type Placed = { latex: string; x: number; y: number; d: string[]; w: number; h: number; unsupported: string[] };

export function buildSheet(lines: readonly string[]): { svg: string; placed: Placed[] } {
  const half = Math.ceil(lines.length / 2);
  const placed: Placed[] = [];
  const colH = [PAD, PAD];
  lines.forEach((latex, i) => {
    const col = i < half ? 0 : 1;
    const layout = layoutMath(latex, { size: SIZE, seed: 11 + i * 7 });
    const x = PAD + col * (COL_W + PAD);
    const y = colH[col] + LABEL_H + 4;
    placed.push({
      latex,
      x,
      y,
      d: layout.strokes.map((s) => polylineToSvgD(s.points.map((p) => ({ x: +(p.x + x).toFixed(2), y: +(p.y + y).toFixed(2) })))),
      w: layout.width,
      h: layout.height,
      unsupported: layout.unsupported,
    });
    colH[col] = y + layout.height + ROW_GAP;
  });
  const width = PAD * 3 + COL_W * 2;
  const height = Math.max(...colH) + PAD;
  const esc = (t: string) => t.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const labels = placed
    .map((p) => {
      const bad = p.unsupported.length > 0;
      const note = bad ? `  [unsupported: ${esc(p.unsupported.join(" "))}]` : "";
      return `<text x="${p.x}" y="${p.y - 6}" fill="${bad ? "#c0392b" : "#8a9099"}">${esc(p.latex)}${note}</text>`;
    })
    .join("\n");
  const ink = placed.map((p) => p.d.map((d) => `<path d="${d}"/>`).join("")).join("\n");
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
<rect width="100%" height="100%" fill="#fbfbf8"/>
<line x1="${PAD + COL_W + PAD / 2}" y1="${PAD}" x2="${PAD + COL_W + PAD / 2}" y2="${height - PAD}" stroke="#e6e6e0"/>
<g font-family="Menlo, monospace" font-size="10" stroke="none">
${labels}
</g>
<g fill="none" stroke="#2f5bd3" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round">
${ink}
</g>
</svg>`;
  return { svg, placed };
}

/**
 * Writes `docs/hand/gallery.png` through `rsvg-convert`; without it, leaves the SVG at
 * `docs/hand/gallery.svg` instead.
 */
function writeGallery(root: string): void {
  const dir = join(root, "docs", "hand");
  mkdirSync(dir, { recursive: true });
  const { svg } = buildSheet(GALLERY);
  const tmp = join(tmpdir(), `hand-gallery-${process.pid}.svg`);
  writeFileSync(tmp, svg);
  for (const bin of ["rsvg-convert", "/opt/homebrew/bin/rsvg-convert"]) {
    try {
      execFileSync(bin, ["-z", "1.5", "-o", join(dir, "gallery.png"), tmp]);
      console.log(`wrote ${join(dir, "gallery.png")}`);
      return;
    } catch {
      // try the next location
    }
  }
  writeFileSync(join(dir, "gallery.svg"), svg);
  console.log(`rsvg-convert not found: wrote ${join(dir, "gallery.svg")}`);
}

// Run directly (`npx jiti src/lib/hand/__tests__/gallery.ts`), not when a test imports it.
if (/[\\/]hand[\\/]__tests__[\\/]gallery\.ts$/.test(process.argv[process.argv.length - 1] ?? "")) {
  writeGallery(process.cwd());
}
