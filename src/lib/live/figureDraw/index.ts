import type { FigurePlanOptions, FigurePlanResult, FigureSpec } from "./contracts";

export * from "./contracts";

/**
 * The problems with a figure spec, in words for the model to fix (a name used but not defined, a
 * zero-length side, a label the hand cannot write, …), or [] when it can be drawn.
 *
 * Placeholder: the figure-drawer build replaces this file.
 */
export function checkFigure(spec: FigureSpec): string[] {
  void spec;
  return ["the figure drawer is not built yet"];
}

/**
 * The figure in the tutor's hand, fitted to `opts.box` true to scale, or null when it cannot be
 * drawn (see `checkFigure`).
 *
 * Placeholder: the figure-drawer build replaces this file.
 */
export function planFigure(spec: FigureSpec, opts: FigurePlanOptions): FigurePlanResult | null {
  void spec;
  void opts;
  return null;
}
