import { checkFigure, planFigure, type FigureSpec } from "../figureDraw";
import type { FigurePlanOptions, FigurePlanResult } from "../figureDraw/contracts";

/**
 * Can the figure drawer draw at all? A 3-4-5 right triangle, labelled, is the simplest figure a
 * chat asks for: when it cannot be planned, the drawer is not there (the build before the drawer
 * lands ships a placeholder that plans nothing), and asking a model to repair a figure would be
 * money spent on a question nobody can answer.
 */
export const PROBE_FIGURE: FigureSpec = {
  points: { A: { x: 0, y: 0 }, B: { x: 4, y: 0 }, C: { x: 0, y: 3 } },
  segments: [
    { from: "A", to: "B", label: "4" },
    { from: "A", to: "C", label: "3" },
    { from: "B", to: "C", label: "x" },
  ],
  angles: [{ at: "A", from: "B", to: "C", right: true }],
};

export function figureDrawerReady(plan: (spec: FigureSpec, opts: FigurePlanOptions) => FigurePlanResult | null = planFigure): boolean {
  try {
    return plan(PROBE_FIGURE, { seed: 1, box: { w: 300, h: 240 } }) !== null;
  } catch {
    return false;
  }
}

/** `checkFigure`, never throwing: a drawer that throws on a spec reports it as a problem. */
export function figureProblems(spec: FigureSpec, check: (spec: FigureSpec) => string[] = checkFigure): string[] {
  try {
    return check(spec).filter((p) => typeof p === "string" && p.trim()).slice(0, 8);
  } catch (err) {
    return [err instanceof Error ? err.message.slice(0, 160) : "the figure could not be checked"];
  }
}
