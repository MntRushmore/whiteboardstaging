import type { ClusterBounds, TutorMark } from "./types";

/** Overlay spacing lock (Simon). */
export const SOCRATIC_GAP_PX = 12;
export const SOCRATIC_MAX_CH = 28;
export const SOCRATIC_FONT_PX = 14;
export const CIRCLE_STROKE_PX = 1.5;
export const CIRCLE_PAD_PX = 6;
export const CARET_GAP_PX = 8;
export const SOLVE_WIDTH_PX = 280;
export const SOLVE_GAP_PX = 16;
export const TUTOR_RED = "#E11D48";
/** Dry atlas nib. Not tldraw freehand. */
export const HAND_NIB_PX = 1.4;
/** Warm paper. Not cold white. */
export const PAPER = "#F4EFE6";

/** Geist 14, 1ch ≈ 0.6em → max-width 28ch. */
export const SOCRATIC_WIDTH_PX = SOCRATIC_MAX_CH * SOCRATIC_FONT_PX * 0.6;

/** tldraw `s` stroke is 2px; scale so the circle stroke is 1.5px. */
export const CIRCLE_STROKE_SCALE = CIRCLE_STROKE_PX / 2;

/** tldraw `s` font is 18px; scale so notes are Geist 14. */
export const NOTE_FONT_SCALE = SOCRATIC_FONT_PX / 18;

/** tldraw text `w` is unscaled; visual width = w * NOTE_FONT_SCALE. */
export function unscaledTextWidth(visualPx: number): number {
  return visualPx / NOTE_FONT_SCALE;
}

export function layoutSocraticQuestion(bbox: ClusterBounds, text: string): {
  x: number;
  y: number;
  w: number;
  h: number;
  text: string;
} {
  return {
    x: bbox.x + bbox.w + SOCRATIC_GAP_PX,
    y: bbox.y,
    w: SOCRATIC_WIDTH_PX,
    h: SOCRATIC_FONT_PX * 1.35,
    text,
  };
}

/** Last stroke cluster only. Ignore model nx / page-margin x. */
export function pinSocraticNote(mark: TutorMark, cluster: ClusterBounds): TutorMark {
  const laid = layoutSocraticQuestion(cluster, mark.text?.trim() ?? "");
  return { ...mark, kind: "note", ...laid, bbox: cluster };
}

export function layoutFeedbackCircle(bbox: ClusterBounds): ClusterBounds {
  return {
    x: bbox.x - CIRCLE_PAD_PX,
    y: bbox.y - CIRCLE_PAD_PX,
    w: bbox.w + CIRCLE_PAD_PX * 2,
    h: bbox.h + CIRCLE_PAD_PX * 2,
  };
}

export function layoutFeedbackCaret(bbox: ClusterBounds): { x: number; y: number } {
  return {
    x: bbox.x + bbox.w / 2,
    y: bbox.y + bbox.h + CARET_GAP_PX,
  };
}

export function layoutSolveColumn(
  bbox: ClusterBounds,
  notes: string[],
): { x: number; y: number; w: number; h: number; text: string }[] {
  const line = 22;
  return notes.map((text, i) => ({
    x: bbox.x + bbox.w + SOLVE_GAP_PX,
    y: bbox.y + i * line,
    w: SOLVE_WIDTH_PX,
    h: line,
    text,
  }));
}

export function applyOverlayLayout(mode: "socratic" | "solve" | "feedback", marks: TutorMark[]): TutorMark[] {
  const bbox = marks[0]?.bbox;
  if (!bbox) return marks;

  if (mode === "socratic") {
    const note = marks.find((m) => m.kind === "note" && m.text);
    if (!note) return [];
    return [pinSocraticNote(note, bbox)];
  }

  if (mode === "solve") {
    const notes = marks.filter((m) => m.kind === "note" && m.text).map((m) => m.text!);
    return layoutSolveColumn(bbox, notes).map((laid, i) => ({
      ...marks.filter((m) => m.kind === "note" && m.text)[i]!,
      ...laid,
    }));
  }

  const circleBox = layoutFeedbackCircle(bbox);
  const caretAt = layoutFeedbackCaret(bbox);
  const circle = marks.find((m) => m.kind === "circle") ?? {
    ...marks[0],
    kind: "circle" as const,
  };
  const caret = marks.find((m) => m.kind === "caret") ?? {
    ...marks[0],
    kind: "caret" as const,
  };

  return [
    { ...circle, ...circleBox },
    { ...caret, x: caretAt.x, y: caretAt.y, w: 10, h: 10 },
  ];
}
