#!/usr/bin/env node
/**
 * make-fixtures.mjs — the kid's handwriting the Live loop is tested and demonstrated with.
 *
 * The simulator has no Pencil, so the Live Lab and the tests replay ink. That ink comes from the
 * web's own handwriting scoreboard (src/__eval__/handwriting.ts): each line written by the tutor's
 * hand engine (`layoutMath`) and then put through the scoreboard's four student hands (`VARIANTS`:
 * clean, slanted, steep, messy — slant, scale, rotation, wobble, uneven glyph sizes, a wandering
 * baseline), exactly as `handInk` makes them for the Mathpix scoreboard. Nothing here is a real
 * child's writing: all of it is synthetic and can be committed.
 *
 * Run from the worktree root, after `npm ci` (deterministic: the same file byte for byte):
 *
 *   node ios/Packages/AgathonLive/Tools/make-fixtures.mjs
 *
 * Writes Tests/AgathonLiveTests/Fixtures/kid-hands.json:
 *
 *   { "source": "...", "variants": ["clean", ...],
 *     "lines": { "<latex>": { "<variant>": [ { "x": [..], "y": [..] }, ... ] } } }
 *
 * Coordinates are page units relative to the line's top-left (its ink box starts at 0, 0), to
 * 0.01. The Swift port of `handInk` (`StudentHands`) is checked against this file.
 */
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const ROOT = process.cwd();
if (!fs.existsSync(path.join(ROOT, "src/__eval__/handwriting.ts"))) {
  console.error("Run this from the worktree root (the directory with src/__eval__).");
  process.exit(2);
}
const NM = path.join(ROOT, "node_modules");
const OUT = path.join(ROOT, "ios/Packages/AgathonLive/Tests/AgathonLiveTests/Fixtures/kid-hands.json");

const { createJiti } = await import(pathToFileURL(path.join(NM, "jiti/lib/jiti.mjs")).href);
const jiti = createJiti(import.meta.url, {
  alias: { "@": path.join(ROOT, "src") },
  fsCache: false,
  moduleCache: true,
});
const eval_ = await jiti.import(path.join(ROOT, "src/__eval__/handwriting.ts"));
const { handInk, VARIANTS } = eval_;

/** The Lab's scenarios and the tests' lines: a slip, a right chain, a calculator line, a fraction. */
const LINES = [
  "2x + 3 = 11",
  "2x = 8",
  "x = 5",
  "x = 4",
  "3x - 5 = 10",
  "3x = 15",
  "36 + 2 =",
  "5x + 2 = 17",
  "5x = 15",
  "x = 3",
  "\\frac{3}{4} + \\frac{1}{8} = \\frac{7}{8}",
];

const r2 = (v) => Math.round(v * 100) / 100;
const lines = {};
for (const latex of LINES) {
  const byVariant = {};
  for (const v of VARIANTS) {
    const ink = handInk(latex, v);
    if (ink.strokes.length === 0) throw new Error(`no ink for ${latex} (${v.name}): ${ink.unsupported.join(", ")}`);
    const pts = ink.strokes.flatMap((s) => s.segments.flat());
    const x0 = Math.min(...pts.map((p) => p.x));
    const y0 = Math.min(...pts.map((p) => p.y));
    byVariant[v.name] = ink.strokes.map((s) => {
      const p = s.segments.flat();
      return { x: p.map((q) => r2(q.x - x0)), y: p.map((q) => r2(q.y - y0)) };
    });
  }
  lines[latex] = byVariant;
}

const out = {
  source: "src/__eval__/handwriting.ts handInk(latex, VARIANTS[i]); ink box moved to (0, 0); 0.01 page units",
  variants: VARIANTS.map((v) => v.name),
  lines,
};
fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, `${JSON.stringify(out)}\n`);
console.log(`wrote ${path.relative(ROOT, OUT)}: ${LINES.length} lines × ${VARIANTS.length} hands, ${fs.statSync(OUT).size} bytes`);
