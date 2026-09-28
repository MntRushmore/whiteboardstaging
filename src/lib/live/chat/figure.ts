// The check only (no drawing code): the chat route runs it on the server.
import { checkFigure } from "../figureDraw/check";
import type { FigureSpec } from "../figureDraw/contracts";

/** A 3-4-5 right triangle, labelled: the simplest figure a chat asks for (tests, the eval). */
export const PROBE_FIGURE: FigureSpec = {
  points: { A: { x: 0, y: 0 }, B: { x: 4, y: 0 }, C: { x: 0, y: 3 } },
  segments: [
    { from: "A", to: "B", label: "4" },
    { from: "A", to: "C", label: "3" },
    { from: "B", to: "C", label: "x" },
  ],
  angles: [{ at: "A", from: "B", to: "C", right: true }],
};

/**
 * What the figure drawer finds wrong with a spec (`checkFigure`: sentences a model can act on), or
 * [] when it will be drawn true to what it says. Never throws: a check that throws is reported as a
 * problem. At most eight.
 */
export function figureProblems(spec: FigureSpec, check: (spec: FigureSpec) => string[] = checkFigure): string[] {
  try {
    return check(spec).filter((p) => typeof p === "string" && p.trim()).slice(0, 8);
  } catch (err) {
    return [err instanceof Error ? err.message.slice(0, 160) : "the figure could not be checked"];
  }
}
