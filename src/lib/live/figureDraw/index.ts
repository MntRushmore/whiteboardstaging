/**
 * Figures the tutor draws by hand: a `FigureSpec` (./contracts.ts) — named points in figure units
 * and what joins and marks them — checked (`checkFigure`, ./check.ts: what is wrong with it, in
 * words a model can fix) and drawn (`planFigure`, ./plan.ts: a `HandPlan` true to scale, fitted to
 * a box, revealed by the HandWriter like the worked steps and the graphs). Pure.
 */
export * from "./contracts";
export { CHECK, checkFigure } from "./check";
export { FIGURE, layoutFigure, planFigure, textSizesFor, type FigureLayout, type FigurePart, type FigurePartKind } from "./plan";
export { degreesOf, lengthOf, nameLatex } from "./labels";
