import { isGeometryProblem } from "../problems";
import type { TutorMark, TutorMode } from "../types";
import {
  composeAngleArc,
  composeArrow,
  composeCaret,
  composeCircle,
  composeHandwriting,
  composeTickMarks,
  composeUnderline,
  NOTE_HAND_SIZE,
  type ComposedInk,
} from "./compose";

export type InkSegment = ComposedInk["segments"][number];

export type InkPlan =
  | {
      kind: "draw";
      x: number;
      y: number;
      closed: boolean;
      segments: InkSegment[];
      markKind: TutorMark["kind"];
    }
  | {
      kind: "hand";
      x: number;
      y: number;
      w: number;
      h: number;
      segments: InkSegment[];
      markKind: TutorMark["kind"];
    }
  | {
      kind: "katex";
      x: number;
      y: number;
      w: number;
      h: number;
      latex: string;
      markKind: TutorMark["kind"];
    };

function seedFor(mark: TutorMark, salt: number): number {
  return (mark.problemId * 1009 + Math.round(mark.x) * 13 + Math.round(mark.y) * 7 + salt) >>> 0;
}

/** Turn a mark into draw/katex plans. Never text nodes. */
export function planTutorInk(mark: TutorMark, mode?: TutorMode): InkPlan[] {
  if (mark.kind === "circle") {
    const ink = composeCircle(mark.w, mark.h, seedFor(mark, 1));
    const plans: InkPlan[] = [
      { kind: "draw", x: mark.x, y: mark.y, closed: true, segments: ink.segments, markKind: "circle" },
    ];
    if (isGeometryProblem(mark.problemId)) {
      const arc = composeAngleArc(mark.w, mark.h, seedFor(mark, 11));
      const ticks = composeTickMarks(mark.w, seedFor(mark, 12));
      plans.push(
        { kind: "draw", x: mark.x, y: mark.y, closed: false, segments: arc.segments, markKind: "circle" },
        { kind: "draw", x: mark.x, y: mark.y + mark.h - 2, closed: false, segments: ticks.segments, markKind: "circle" },
      );
    }
    return plans;
  }

  if (mark.kind === "caret") {
    const ink = composeCaret(seedFor(mark, 2));
    return [
      {
        kind: "draw",
        x: mark.x - ink.width / 2,
        y: mark.y,
        closed: false,
        segments: ink.segments,
        markKind: "caret",
      },
    ];
  }

  if (mark.kind === "underline") {
    const ink = composeUnderline(mark.w, seedFor(mark, 3));
    return [{ kind: "draw", x: mark.x, y: mark.y + mark.h, closed: false, segments: ink.segments, markKind: "underline" }];
  }

  if (mark.kind === "arrow") {
    const ink = composeArrow(mark.w, mark.h, seedFor(mark, 4));
    return [{ kind: "draw", x: mark.x, y: mark.y, closed: false, segments: ink.segments, markKind: "arrow" }];
  }

  const text = mark.text?.trim();
  if (!text) return [];

  const size =
    mode === "solve" ? Math.max(18, mark.h) : NOTE_HAND_SIZE;
  const hand = composeHandwriting(text, {
    maxWidth: Math.max(mark.w, size * Math.max(2, text.length)),
    seed: seedFor(mark, mode === "solve" ? 5 : 6),
    size,
  });
  // Atlas compositor only. Do not emit a tldraw draw — dash:"draw"
  // concatenates every glyph path and runs freehand (the red scribble).
  return [
    {
      kind: "hand",
      x: mark.x,
      y: mark.y,
      w: Math.max(8, hand.width),
      h: Math.max(16, hand.height),
      segments: hand.segments,
      markKind: "note",
    },
  ];
}
