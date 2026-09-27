/**
 * JOB 3 — misread repair (vision). A line Mathpix read wrongly is shown to a vision model as an
 * image of the ink, together with Mathpix's LaTeX and the lines above it; the model returns the
 * corrected LaTeX (JSON). Scored against the LaTeX the student really wrote with the handwriting
 * scoreboard's own `judgeRead` (exact / same maths / wrong).
 *
 * Items:
 *  - every distinct misread in the handwriting scoreboard (docs/eval/handwriting.json), with the
 *    ink re-drawn by `handInk` exactly as the scoreboard drew it and the read taken from the
 *    Mathpix cache when it is there (else from the JSON);
 *  - a few SYNTHETIC misreads (clean ink of the true line, a plausible wrong read) for confusions
 *    the scoreboard did not produce;
 *  - CONTROLS: lines Mathpix read correctly — preferring the very lines it misread in another
 *    variant — to measure how often the model "corrects" a right read into a wrong one.
 */
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import type { InkStroke } from "@/lib/live/contracts";
import { CACHE_DIR, cacheKey, handInk, judgeRead, normalizeTex, payloadFor, VARIANTS, type Variant } from "../handwriting";
import type { BenchMessage } from "./client";
import { parseModelJson } from "./json";

export const HANDWRITING_JSON = resolve(__dirname, "..", "..", "..", "docs", "eval", "handwriting.json");
export const RSVG = "/opt/homebrew/bin/rsvg-convert";

export type ReadItemKind = "misread" | "synthetic" | "control";

export interface ReadItem {
  id: string;
  kind: ReadItemKind;
  /** what the student wrote */
  truth: string;
  /** what the recognizer returned */
  read: string;
  /** the lines above on the page, as the recognizer read them */
  above: string[];
  variant: string;
  /** where `read` came from */
  source: "mathpix-cache" | "handwriting.json" | "synthetic";
}

interface HandLine {
  original: string;
  recognized: string;
  read: string;
}
interface HandRunJson {
  id: string;
  variant: string;
  lines: HandLine[];
}

/** A line whose ink is worth a control: the confusable glyphs the misreads involve. */
const CONFUSABLE = /e\^|\\int_|\||(?:^|[^a-z\\])[auvb](?:[^a-z]|$)|\\frac\{d\}/;

export const SYNTHETIC: ReadonlyArray<{ truth: string; read: string; above: string[] }> = [
  { truth: "3x + 2 = 11", read: "\\varepsilon x+2=11", above: [] },
  { truth: "x^{2} - 5x + 6 = 0", read: "x^{2}-s x+6=0", above: [] },
  { truth: "x + y + z = 6", read: "x+y+2=6", above: [] },
  { truth: "x^{2} + 4x = 12", read: "x 2+4 x=12", above: [] },
  { truth: "2t - 7 = 9", read: "2 t-7=g", above: [] },
  { truth: "y = 4x - 1", read: "y=4 x-l", above: ["y = ?"] },
];

/**
 * Twenty, not ten: a broken control is paid on every line Mathpix already reads right (~97% of
 * them), so the false-correction rate decides whether repair is worth running at all, and with
 * ten controls one mistake is already a 10% rate.
 */
export const CONTROL_COUNT = 20;

function variantNamed(name: string): Variant {
  const v = VARIANTS.find((x) => x.name === name);
  if (!v) throw new Error(`no variant ${name}`);
  return v;
}

/** The Mathpix read of this ink, from the scoreboard's cache (null when not cached). */
function cachedRead(latex: string, variant: Variant, cacheDir: string): string | null {
  const ink = handInk(latex, variant);
  if (ink.unsupported.length > 0) return null;
  const { payload } = payloadFor(ink.strokes);
  if (!payload) return null;
  const file = join(cacheDir, `${cacheKey(payload)}.json`);
  if (!existsSync(file)) return null;
  const rec = JSON.parse(readFileSync(file, "utf8")) as { ok: boolean; latex: string };
  return rec.ok ? rec.latex : null;
}

/** Misreads, synthetic misreads and controls, in a fixed order. */
export function buildReadItems(opts: { json?: string; cacheDir?: string } = {}): ReadItem[] {
  const runs = (JSON.parse(readFileSync(opts.json ?? HANDWRITING_JSON, "utf8")) as { runs: HandRunJson[] }).runs;
  const cacheDir = opts.cacheDir ?? CACHE_DIR;
  const items: ReadItem[] = [];
  const seen = new Set<string>();
  const misreadLines = new Set<string>();
  const readOf = (original: string, variant: string, fallback: string): { read: string; source: ReadItem["source"] } => {
    const cached = cachedRead(original, variantNamed(variant), cacheDir);
    return cached !== null ? { read: cached, source: "mathpix-cache" } : { read: fallback, source: "handwriting.json" };
  };

  for (const run of runs) {
    run.lines.forEach((l, i) => {
      if (l.read !== "wrong" || !l.recognized) return;
      const key = `${run.variant}|${l.original}|${l.recognized}`;
      if (seen.has(key)) return;
      seen.add(key);
      misreadLines.add(l.original);
      const r = readOf(l.original, run.variant, l.recognized);
      if (judgeRead(l.original, r.read) !== "wrong") return; // the cache disagrees: not a misread any more
      items.push({ id: `mr-${String(items.length + 1).padStart(2, "0")}`, kind: "misread", truth: l.original, read: r.read, above: run.lines.slice(0, i).map((x) => x.recognized), variant: run.variant, source: r.source });
    });
  }

  SYNTHETIC.forEach((s, i) => {
    items.push({ id: `sy-${String(i + 1).padStart(2, "0")}`, kind: "synthetic", truth: s.truth, read: s.read, above: s.above, variant: "clean", source: "synthetic" });
  });

  // controls: first the lines misread elsewhere but read right here, then other confusable lines
  const controls: ReadItem[] = [];
  const used = new Set<string>();
  for (const pass of [0, 1]) {
    for (const run of runs) {
      run.lines.forEach((l, i) => {
        if (controls.length >= CONTROL_COUNT || l.read !== "exact" || used.has(l.original)) return;
        const wanted = pass === 0 ? misreadLines.has(l.original) : CONFUSABLE.test(l.original);
        if (!wanted) return;
        const r = readOf(l.original, run.variant, l.recognized);
        if (judgeRead(l.original, r.read) !== "exact") return;
        used.add(l.original);
        controls.push({ id: `ct-${String(controls.length + 1).padStart(2, "0")}`, kind: "control", truth: l.original, read: r.read, above: run.lines.slice(0, i).map((x) => x.recognized), variant: run.variant, source: r.source });
      });
    }
  }
  return [...items, ...controls];
}

// ---------------------------------------------------------------- the image

/** The ink as an SVG, the way `captureCrop` frames it (padding 8, white background), scaled up to ≤ 1024 px wide. */
export function inkSvg(strokes: readonly InkStroke[]): string {
  const pts = strokes.flatMap((s) => s.segments.flat());
  const minX = Math.min(...pts.map((p) => p.x)) - 8;
  const minY = Math.min(...pts.map((p) => p.y)) - 8;
  const w = Math.max(...pts.map((p) => p.x)) + 8 - minX;
  const h = Math.max(...pts.map((p) => p.y)) + 8 - minY;
  const scale = Math.min(2, 1024 / w);
  const W = Math.round(w * scale);
  const H = Math.round(h * scale);
  const paths = strokes
    .flatMap((s) => s.segments)
    .filter((seg) => seg.length > 0)
    .map((seg) => {
      const d = seg.map((p, i) => `${i === 0 ? "M" : "L"}${((p.x - minX) * scale).toFixed(1)} ${((p.y - minY) * scale).toFixed(1)}`).join(" ");
      return `<path d="${seg.length === 1 ? `${d} l0.01 0` : d}"/>`;
    })
    .join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}"><rect width="${W}" height="${H}" fill="#ffffff"/><g fill="none" stroke="#1d1d1d" stroke-width="${(3.2 * scale).toFixed(1)}" stroke-linecap="round" stroke-linejoin="round">${paths}</g></svg>`;
}

/** PNG of the item's ink as a data URL (rsvg-convert). */
export function inkPng(item: Pick<ReadItem, "truth" | "variant">): { dataUrl: string; bytes: number; width: number; height: number } {
  const ink = handInk(item.truth, variantNamed(item.variant));
  if (ink.unsupported.length > 0) throw new Error(`hand cannot write ${item.truth}: ${ink.unsupported.join(", ")}`);
  const svg = inkSvg(ink.strokes);
  const png = execFileSync(RSVG, ["-f", "png"], { input: svg, maxBuffer: 16 * 1024 * 1024 });
  const [, width, height] = /width="(\d+)" height="(\d+)"/.exec(svg) ?? [];
  return { dataUrl: `data:image/png;base64,${png.toString("base64")}`, bytes: png.length, width: Number(width), height: Number(height) };
}

// ---------------------------------------------------------------- the prompt

export const REPAIR_SYSTEM_PROMPT = [
  "You proofread a handwriting recognizer. You get an image of ONE handwritten line of a student's maths, the recognizer's LaTeX for that line, and the lines above it on the page (as the recognizer read them).",
  "Compare the LaTeX with the image symbol by symbol.",
  "- If it matches what is written, return it unchanged.",
  "- If the recognizer misread something (a letter read as a look-alike digit or Greek letter, the wrong case, bars or brackets misread or dropped, lost limits, subscripts or superscripts), return the corrected LaTeX.",
  "The lines above only tell you which letters and notation the student uses; they may contain misreads themselves.",
  "Transcribe exactly what is written, even if the maths is wrong: never solve, simplify or fix the student's maths.",
  'Return JSON only: {"latex": string, "changed": boolean}. KaTeX-renderable LaTeX, no $ delimiters.',
].join("\n");

export function repairMessages(item: ReadItem, imageDataUrl: string): BenchMessage[] {
  const above = item.above.filter((l) => l.trim());
  const text = [
    `Recognizer's LaTeX for the line in the image: ${item.read}`,
    above.length > 0 ? `Lines above, top to bottom:\n${above.map((l, i) => `${i + 1}. ${l}`).join("\n")}` : "Lines above: none",
    "JSON only.",
  ].join("\n");
  return [
    { role: "system", content: REPAIR_SYSTEM_PROMPT },
    {
      role: "user",
      content: [
        { type: "image_url", image_url: { url: imageDataUrl } },
        { type: "text", text },
      ],
    },
  ];
}

// ---------------------------------------------------------------- scoring

export interface ReadScore {
  id: string;
  kind: ReadItemKind;
  badJson: boolean;
  latex: string;
  /** `judgeRead(truth, latex)` */
  verdict: "exact" | "semantic" | "wrong";
  correct: boolean;
  /** the model's LaTeX differs from the recognizer's */
  changed: boolean;
}

export function scoreRepairReply(item: ReadItem, content: string): ReadScore {
  const parsed = parseModelJson(content) as { latex?: unknown } | null;
  const latex = typeof parsed?.latex === "string" ? parsed.latex.replace(/^\$+|\$+$/g, "").trim() : null;
  if (latex === null) return { id: item.id, kind: item.kind, badJson: true, latex: "", verdict: "wrong", correct: false, changed: false };
  const verdict = judgeRead(item.truth, latex);
  return { id: item.id, kind: item.kind, badJson: false, latex, verdict, correct: verdict !== "wrong", changed: normalizeTex(latex) !== normalizeTex(item.read) };
}
