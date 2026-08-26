import { readStrokePoint } from "./strokes";
import type { StrokeSample } from "./types";

/** Mathpix v3/strokes body: one inner array per continuous stroke. */
export function toMathpixStrokePayload(strokes: StrokeSample[]) {
  return {
    strokes: {
      strokes: {
        x: strokes.map((stroke) => stroke.points.map((p) => p.x)),
        y: strokes.map((stroke) => stroke.points.map((p) => p.y)),
      },
    },
  };
}

export function parseStrokeSamples(raw: unknown): StrokeSample[] {
  if (!Array.isArray(raw)) return [];
  const out: StrokeSample[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const points = (item as { points?: unknown }).points;
    if (!Array.isArray(points)) continue;
    const parsed = points
      .map((point) => readStrokePoint(point))
      .filter((point): point is { x: number; y: number } => Boolean(point));
    if (parsed.length === 1 && parsed[0]) {
      parsed.push({ x: parsed[0].x + 0.5, y: parsed[0].y });
    }
    if (parsed.length >= 2) out.push({ points: parsed });
  }
  return out;
}

export function latexFromMathpix(data: Record<string, unknown>): string {
  const styled = typeof data.latex_styled === "string" ? data.latex_styled.trim() : "";
  if (styled) return styled;
  const latex = typeof data.latex === "string" ? data.latex.trim() : "";
  if (latex) return latex;
  const text = typeof data.text === "string" ? data.text.trim() : "";
  if (!text) return "";
  return text
    .replace(/^\\\(/, "")
    .replace(/\\\)$/, "")
    .replace(/^\\\[/, "")
    .replace(/\\\]$/, "")
    .trim();
}
