/**
 * SAT v2 mockups: the ink. Every handwritten line in docs/sat2/mockups.html is drawn stroke for
 * stroke by the real hand engine (src/lib/hand), never a typeface.
 *
 *   npx jiti docs/sat2/ink-gen.ts      (writes docs/sat2/ink.js)
 *
 * - "tutor": the tutor's hand exactly as the engine writes it (cobalt in the page).
 * - "student": the same engine with a second, looser hand laid over it: a forward slant, narrower
 *   letters, a baseline that drifts uphill, each stroke nudged and turned a little, more tremor.
 *   It is drawn thin in the page (0.65x the app's default pen), the owner's note on kid ink.
 * Synthetic only: no real student's ink is used (the repo is public).
 */
import { writeFileSync } from "node:fs";
import { join } from "node:path";

import { layoutMath } from "../../src/lib/hand/mathLayout";
import { mulberry32 } from "../../src/lib/hand/path";

type Hand = "student" | "tutor";
type Piece = { hand: Hand; latex: string; size: number; seed: number };

const PIECES: Record<string, Piece> = {
  // print shop (algebra-linear-two-var-0102)
  s_b19: { hand: "student", latex: "b = 19", size: 38, seed: 3 },
  s_m: { hand: "student", latex: "m = \\frac{31 - 19}{2 - 0} = \\frac{12}{2} = 6", size: 38, seed: 17 },
  s_mfrac: { hand: "student", latex: "m = \\frac{31 - 19}{2 - 0}", size: 38, seed: 23 },
  s_y_part: { hand: "student", latex: "y = 6x +", size: 38, seed: 29 },
  s_y: { hand: "student", latex: "y = 6x + 19", size: 38, seed: 31 },
  s_mwrong: { hand: "student", latex: "m = 31 - 19 = 12", size: 38, seed: 37 },
  s_12: { hand: "student", latex: "12", size: 30, seed: 41 },
  s_2: { hand: "student", latex: "2", size: 30, seed: 43 },
  s_6: { hand: "student", latex: "= 6", size: 38, seed: 47 },
  // exterior angle (geometry_trig-lines-angles-triangles-0001)
  s_ext1: { hand: "student", latex: "180 - 52 - 71 = 57", size: 38, seed: 53 },
  s_ext2: { hand: "student", latex: "x = 180 - 57", size: 38, seed: 59 },
  s_ext3: { hand: "student", latex: "= 123", size: 38, seed: 61 },
  s_57: { hand: "student", latex: "57", size: 28, seed: 67 },
  // music app (psda-probability-0107)
  s_prob: { hand: "student", latex: "\\frac{66}{120} = \\frac{11}{20}", size: 38, seed: 71 },
  s_free: { hand: "student", latex: "120 \\text{ free}", size: 34, seed: 73 },
  // tutor
  t_mfrac: { hand: "tutor", latex: "m = \\frac{31 - 19}{2 - 0}", size: 38, seed: 101 },
  t_b19: { hand: "tutor", latex: "b = 19", size: 38, seed: 103 },
  t_m6: { hand: "tutor", latex: "m = \\frac{31 - 19}{2 - 0} = 6", size: 38, seed: 107 },
  t_12: { hand: "tutor", latex: "12", size: 28, seed: 109 },
  t_2: { hand: "tutor", latex: "2", size: 28, seed: 113 },
};

type P = { x: number; y: number };

/** Catmull-Rom through the points, as cubic Béziers: a pen line, not a polyline. */
function smoothD(pts: P[]): string {
  const f = (n: number) => +n.toFixed(2);
  if (pts.length === 0) return "";
  if (pts.length < 3) return `M${f(pts[0].x)} ${f(pts[0].y)}` + pts.slice(1).map((p) => ` L${f(p.x)} ${f(p.y)}`).join("");
  let d = `M${f(pts[0].x)} ${f(pts[0].y)}`;
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[Math.max(0, i - 1)], p1 = pts[i], p2 = pts[i + 1], p3 = pts[Math.min(pts.length - 1, i + 2)];
    const c1 = { x: p1.x + (p2.x - p0.x) / 6, y: p1.y + (p2.y - p0.y) / 6 };
    const c2 = { x: p2.x - (p3.x - p1.x) / 6, y: p2.y - (p3.y - p1.y) / 6 };
    d += ` C${f(c1.x)} ${f(c1.y)} ${f(c2.x)} ${f(c2.y)} ${f(p2.x)} ${f(p2.y)}`;
  }
  return d;
}

function build(p: Piece) {
  const lay = layoutMath(p.latex, { size: p.size, seed: p.seed });
  if (lay.unsupported.length) throw new Error(`${p.latex}: unsupported ${lay.unsupported.join(" ")}`);
  const rng = mulberry32(p.seed * 7919);
  const base = lay.baseline;
  const strokes = lay.strokes.map((s) => {
    let pts: P[] = s.points.map((q) => ({ x: q.x, y: q.y }));
    if (p.hand === "student") {
      const dx = (rng() - 0.5) * 1.6, dy = (rng() - 0.5) * 1.4, rot = (rng() - 0.5) * 0.06;
      const cx = pts.reduce((a, q) => a + q.x, 0) / pts.length, cy = pts.reduce((a, q) => a + q.y, 0) / pts.length;
      pts = pts.map((q, i) => {
        // turn the stroke a little about its own centre, then nudge it
        const rx = cx + (q.x - cx) * Math.cos(rot) - (q.y - cy) * Math.sin(rot);
        const ry = cy + (q.x - cx) * Math.sin(rot) + (q.y - cy) * Math.cos(rot);
        const t = i / Math.max(1, pts.length - 1);
        const wob = Math.sin(t * Math.PI) * (rng() - 0.5) * 0.9;
        let x = rx * 0.93 + dx + wob;
        let y = ry + dy + wob * 0.6;
        x += (base - y) * 0.17; // forward slant
        y += Math.sin(x / 120 + p.seed) * 1.6 - x * 0.018; // drift, a little uphill
        return { x, y };
      });
    }
    return pts;
  });
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const s of strokes) for (const q of s) { minX = Math.min(minX, q.x); minY = Math.min(minY, q.y); maxX = Math.max(maxX, q.x); maxY = Math.max(maxY, q.y); }
  // keep the writing line at y = 0 so the page places a piece by its baseline
  const out = strokes.map((s) => smoothD(s.map((q) => ({ x: q.x - minX, y: q.y - base }))));
  return { d: out, w: +(maxX - minX).toFixed(1), top: +(minY - base).toFixed(1), bottom: +(maxY - base).toFixed(1) };
}

const ink: Record<string, ReturnType<typeof build>> = {};
for (const [k, p] of Object.entries(PIECES)) ink[k] = build(p);
const file = join(process.cwd(), "docs", "sat2", "ink.js");
writeFileSync(file, `// Generated by docs/sat2/ink-gen.ts (the real hand engine). Do not edit.\nwindow.INK = ${JSON.stringify(ink)};\n`);
console.log(`wrote ${file}: ${Object.keys(ink).length} pieces`);
