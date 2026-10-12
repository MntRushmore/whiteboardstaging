/**
 * Type it (docs/TYPE-MATH.md): what the parser, the writer (the Live loop) and the bar share.
 * Types and meta keys only: nothing here pulls the parser or the bar into the board's bundle.
 */

import type { Rect } from "@/lib/live/contracts";

/** What the parser makes of a typed line. */
export type TypedParse =
  | { ok: true; latex: string }
  | {
      ok: false;
      /** short, kind, for a kid: "Close the bracket", "Something goes after the =" */
      hint: string;
      /** the best LaTeX it could make, for the preview while they're still typing; "" for none */
      partial: string;
    };

/** On every stroke of a typed line: the line's id (the strokes are student ink, with no `live` meta). */
export const TYPED_ID_META = "typedId";
/** On the line's FIRST stroke only: what it says as LaTeX. */
export const TYPED_LATEX_META = "typedLatex";
/** On the line's FIRST stroke only: what the kid typed, given back to the box when they edit it. */
export const TYPED_TEXT_META = "typedText";
/** On the line's FIRST stroke only: how many strokes it was written with (a group missing one isn't whole). */
export const TYPED_COUNT_META = "typedCount";

export interface WriteTypedArgs {
  /** what the kid typed */
  text: string;
  /** `plainToLatex(text).latex` */
  latex: string;
  /**
   * Rewrite this line instead of writing a new one. A typed line's ink is replaced where it
   * stands; a pen line keeps its ink and its reading becomes `latex`.
   */
  replaceLineId?: string;
  /** start a new problem instead of the next line of the current one */
  newProblem?: boolean;
}

export type WriteTypedResult =
  | { ok: true; lineId: string; /** page bounds of the line written */ bounds: Rect }
  | {
      ok: false;
      /**
       * `empty`: nothing to write. `unwritable`: the hand can't write it (layoutMath's
       * `unsupported`). `off`: Live is off on this board. `noLine`: `replaceLineId` is gone.
       */
      reason: "empty" | "unwritable" | "off" | "noLine";
    };

/** A line the bar can offer to edit (↑ in the box, the pencil beside a line). */
export interface TypedLineRef {
  lineId: string;
  /** written by the bar (its ink is rewritten on edit) or by the pen (its reading is) */
  typed: boolean;
  /** what the kid typed; "" for a pen line (the bar fills the box from `latex`) */
  typedText: string;
  /** the line's reading */
  latex: string;
  /** page bounds */
  bounds: Rect;
}

/** Where Enter writes next: the bar's ghost caret on the board. Page coordinates. */
export interface TypedSpot {
  x: number;
  baselineY: number;
  /** the hand size the line is written at (layoutMath's `size`) */
  size: number;
}
