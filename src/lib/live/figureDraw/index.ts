import type { FigurePlanOptions, FigurePlanResult, FigureSpec } from "./contracts";

/**
 * Figures the tutor draws by hand: a `FigureSpec` (./contracts.ts) — named points in figure units
 * and what joins and marks them — checked (`checkFigure`, ./check.ts: what is wrong with it, in
 * words a model can fix) and drawn (`planFigure`). Pure.
 */
export * from "./contracts";
export { CHECK, checkFigure } from "./check";
export { degreesOf, lengthOf, nameLatex } from "./labels";

/**
 * The figure in the tutor's hand, fitted to `opts.box` true to scale, or null when it cannot be
 * drawn (see `checkFigure`).
 *
 * Placeholder: the drawer lands next.
 */
export function planFigure(spec: FigureSpec, opts: FigurePlanOptions): FigurePlanResult | null {
  void spec;
  void opts;
  return null;
}
