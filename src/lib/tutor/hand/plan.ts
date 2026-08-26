import {
  composeArrow,
  composeCaret,
  composeCircle,
  composeHandwriting,
  composeUnderline,
  type ComposedInk,
} from "./compose";
import { estimateKatexSize, splitSolveNote } from "./solve";
import type { TutorMark, TutorMode } from "../types";

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
    return [{ kind: "draw", x: mark.x, y: mark.y, closed: true, segments: ink.segments, markKind: "circle" }];
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

  if (mode === "solve") {
    const { leadIn, math } = splitSolveNote(text);
    const plans: InkPlan[] = [];
    let nextX = mark.x;
    let nextY = mark.y;
    if (leadIn) {
      const hand = composeHandwriting(leadIn, { maxWidth: mark.w, seed: seedFor(mark, 5) });
      plans.push({
        kind: "draw",
        x: mark.x,
        y: mark.y,
        closed: false,
        segments: hand.segments,
        markKind: "note",
      });
      if (hand.width + 90 > mark.w) {
        nextX = mark.x;
        nextY = mark.y + hand.height;
      } else {
        nextX = mark.x + hand.width + 6;
        nextY = mark.y;
      }
    }
    if (math) {
      const size = estimateKatexSize(math);
      plans.push({
        kind: "katex",
        x: nextX,
        y: nextY,
        w: size.w,
        h: size.h,
        latex: math,
        markKind: "note",
      });
    }
    return plans;
  }

  const hand = composeHandwriting(text, { maxWidth: mark.w, seed: seedFor(mark, 6) });
  return [
    {
      kind: "draw",
      x: mark.x,
      y: mark.y,
      closed: false,
      segments: hand.segments,
      markKind: "note",
    },
  ];
}
