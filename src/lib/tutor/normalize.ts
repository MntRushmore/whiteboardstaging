import {
  MARK_KINDS,
  TUTOR_MODES,
  type ClusterBounds,
  type NormalizedMark,
  type TutorMark,
  type TutorMarkKind,
  type TutorMode,
} from "./types";

export function clamp01(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.min(1, Math.max(0, n));
}

export function clampConfidence(n: unknown): number {
  const value = typeof n === "number" ? n : Number(n);
  if (!Number.isFinite(value)) return 0;
  return Math.min(1, Math.max(0, value));
}

export function isTutorMode(value: unknown): value is TutorMode {
  return typeof value === "string" && (TUTOR_MODES as readonly string[]).includes(value);
}

export function isMarkKind(value: unknown): value is TutorMarkKind {
  return typeof value === "string" && (MARK_KINDS as readonly string[]).includes(value);
}

export function parseTutorMode(value: unknown, fallback: TutorMode): TutorMode {
  return isTutorMode(value) ? value : fallback;
}

export function parseJsonObject(text: string): Record<string, unknown> {
  const trimmed = text.trim();
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/);
  const raw = fenced ? fenced[1].trim() : trimmed;
  const parsed = JSON.parse(raw) as unknown;
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("Tutor response was not a JSON object");
  }
  return parsed as Record<string, unknown>;
}

export function parseNormalizedMark(raw: unknown): NormalizedMark | null {
  if (!raw || typeof raw !== "object") return null;
  const rec = raw as Record<string, unknown>;
  if (!isMarkKind(rec.kind)) return null;

  const nx = Number(rec.nx ?? rec.x);
  const ny = Number(rec.ny ?? rec.y);
  const nw = Number(rec.nw ?? rec.w);
  const nh = Number(rec.nh ?? rec.h);
  if (![nx, ny, nw, nh].every(Number.isFinite)) return null;

  const text = typeof rec.text === "string" ? rec.text.trim() : undefined;
  return {
    kind: rec.kind,
    nx: clamp01(nx > 1 ? 0 : nx),
    ny: clamp01(ny > 1 ? 0 : ny),
    nw: Math.min(1, Math.max(0.02, nw > 1 ? 0.2 : nw)),
    nh: Math.min(1, Math.max(0.02, nh > 1 ? 0.12 : nh)),
    text,
  };
}

export function mapNormalizedMarkToPage(
  mark: NormalizedMark,
  pageId: string,
  bounds: ClusterBounds,
): TutorMark {
  return {
    kind: mark.kind,
    pageId,
    x: bounds.x + mark.nx * bounds.w,
    y: bounds.y + mark.ny * bounds.h,
    w: Math.max(12, mark.nw * bounds.w),
    h: Math.max(10, mark.nh * bounds.h),
    text: mark.text,
  };
}

/**
 * Product constraints:
 * - socratic: at most one question note + optional circle
 * - solve: step notes only (no bitmap, no circles/underlines)
 * - feedback: circles/underlines + one short margin note
 */
export function constrainMarks(mode: TutorMode, marks: TutorMark[]): TutorMark[] {
  if (mode === "socratic") {
    const note = marks.find((m) => m.kind === "note" && m.text);
    const circle = marks.find((m) => m.kind === "circle");
    return [circle, note].filter((m): m is TutorMark => Boolean(m));
  }

  if (mode === "solve") {
    return marks
      .filter((m) => m.kind === "note" && m.text)
      .slice(0, 5);
  }

  const decorations = marks
    .filter((m) => m.kind === "circle" || m.kind === "underline")
    .slice(0, 4);
  const note = marks.find((m) => m.kind === "note" && m.text);
  return note ? [...decorations, note] : decorations;
}

export function downsamplePoints(
  points: { x: number; y: number }[],
  maxPoints = 64,
): { x: number; y: number }[] {
  if (points.length <= maxPoints) return points;
  const out: { x: number; y: number }[] = [];
  const last = points.length - 1;
  for (let i = 0; i < maxPoints; i++) {
    const index = i === maxPoints - 1 ? last : Math.round((i * last) / (maxPoints - 1));
    out.push(points[index]);
  }
  return out;
}

export function richTextToPlain(value: unknown): string {
  if (!value) return "";
  if (typeof value === "string") return value;
  if (typeof value !== "object") return "";
  const rec = value as { text?: unknown; content?: unknown };
  if (typeof rec.text === "string") return rec.text;
  if (Array.isArray(rec.content)) {
    return rec.content.map(richTextToPlain).join("");
  }
  return "";
}
