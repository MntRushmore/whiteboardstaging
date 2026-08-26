import { applyOverlayLayout } from "./layout";
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
  // Cluster-normalized: 0–1 is on the work, >1 is just outside that cluster.
  // Do not treat nx>=1 as a page-margin coordinate, and do not zero it.
  return {
    kind: rec.kind,
    nx: Number.isFinite(nx) ? Math.min(1.25, Math.max(-0.1, nx)) : 0,
    ny: Number.isFinite(ny) ? Math.min(1.25, Math.max(-0.1, ny)) : 0,
    nw: Math.min(1, Math.max(0.02, nw > 1 ? 0.2 : nw)),
    nh: Math.min(1, Math.max(0.02, nh > 1 ? 0.12 : nh)),
    text,
  };
}

/**
 * Map nx/ny onto the given bounds. Those bounds must be the last stroke
 * cluster, never the page. nx~0.95 × page width is the far-right miss.
 */
export function mapNormalizedMarkToPage(
  mark: NormalizedMark,
  pageId: string,
  bounds: ClusterBounds,
  problemId: number,
  latex: string,
): TutorMark {
  return {
    kind: mark.kind,
    pageId,
    x: bounds.x + mark.nx * bounds.w,
    y: bounds.y + mark.ny * bounds.h,
    w: Math.max(12, mark.nw * bounds.w),
    h: Math.max(10, mark.nh * bounds.h),
    text: mark.text,
    problemId,
    latex,
    bbox: bounds,
  };
}

/**
 * Simon's overlay lock:
 * - socratic: one margin question
 * - solve: stepped notes pinned right of the work
 * - feedback: circle and caret only
 */
export function constrainMarks(mode: TutorMode, marks: TutorMark[]): TutorMark[] {
  if (mode === "socratic") {
    const note = marks.find((m) => m.kind === "note" && m.text);
    return applyOverlayLayout("socratic", note ? [note] : []);
  }

  if (mode === "solve") {
    return applyOverlayLayout(
      "solve",
      marks.filter((m) => m.kind === "note" && m.text).slice(0, 4),
    );
  }

  const circle = marks.find((m) => m.kind === "circle");
  const caret = marks.find((m) => m.kind === "caret");
  const seed = marks[0];
  if (!seed) return [];
  return applyOverlayLayout(
    "feedback",
    [circle, caret].filter((m): m is TutorMark => Boolean(m)).length
      ? [circle, caret].filter((m): m is TutorMark => Boolean(m))
      : [seed],
  );
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

export function isUsableLatex(latex: string): boolean {
  return latex.trim().length > 0;
}

const LATEX_COMMAND = /\\[a-zA-Z]+\*?/g;
const QUOTED_LETTER = /['"‘’“”]([A-Za-z])['"‘’“”]/g;
const NAMED_LETTER = /\b(?:variable|letter|unknown|term|coefficient of)\s+([A-Za-z])\b/gi;
const LETTER_REPRESENTS = /\b([A-Za-z])\s+represent/gi;

/** Letters that actually appear in the recognized latex (commands stripped). */
export function lettersInLatex(latex: string): Set<string> {
  const stripped = latex.replace(LATEX_COMMAND, " ").replace(/[{}]/g, " ");
  return new Set((stripped.match(/[A-Za-z]/g) ?? []).map((ch) => ch.toLowerCase()));
}

/**
 * Drop leftover openers that talk about a variable not in this latex.
 * "What does 'a' represent" against `36+2=` is the bug.
 */
export function noteTextFitsLatex(text: string, latex: string): boolean {
  const allowed = lettersInLatex(latex);
  const mentioned = new Set<string>();
  for (const re of [QUOTED_LETTER, NAMED_LETTER, LETTER_REPRESENTS]) {
    re.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = re.exec(text))) {
      mentioned.add(match[1]!.toLowerCase());
    }
  }
  for (const ch of mentioned) {
    if (!allowed.has(ch)) return false;
  }
  return true;
}

export function notesAboutLatex(marks: TutorMark[], latex: string): TutorMark[] {
  return marks.filter((mark) => {
    if (mark.kind !== "note" || !mark.text?.trim()) return true;
    return noteTextFitsLatex(mark.text, latex);
  });
}
