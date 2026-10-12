/**
 * Plain typing ↔ the LaTeX the board speaks (docs/TYPE-MATH.md). Pure: no DOM, no tldraw.
 * Loaded with the bar only, never with the board.
 *
 * CONTRACT STUB: the parser branch replaces both bodies.
 */

import type { TypedParse } from "./contracts";

export function plainToLatex(text: string): TypedParse {
  const latex = text.trim();
  return { ok: true, latex };
}

export function latexToPlain(latex: string): string {
  return latex;
}
