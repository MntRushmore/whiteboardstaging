import type { Annotation, CheckRequest, RecognizeResponse, SolveStep } from "@/lib/live/contracts";

/**
 * Pure rules shared by the /api/live/* routes (kept out of the route files so they can be
 * unit-tested and so route modules only export Next.js handler symbols).
 */

/* ------------------------------------------------------------------------- */
/* recognize: kind classification (spec §5.2)                                 */
/* ------------------------------------------------------------------------- */

const ARROW_RE = /\\rightarrow|->|\\to\b|\\longrightarrow|\\rightleftharpoons|\\leftrightarrow/;
const ELEMENT_RE = /(?:^|[^a-zA-Z])[A-Z][a-z]?(?:_\{?\d+\}?)?(?=[^a-z]|$)/;
const MATHY_RE = /[\d+\-*/=^<>\\]/;

/** Fraction of the LaTeX string that sits inside `\text{...}` groups. */
export function textCoverage(latex: string): number {
  if (!latex) return 0;
  let covered = 0;
  const re = /\\text\{([^{}]*)\}/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(latex)) !== null) covered += m[0].length;
  return covered / latex.length;
}

/**
 * `chem` when there is a reaction arrow and element tokens; `text` when \text{} covers > 50 %
 * or nothing math-like appears (or the vision model said it is not math); `unknown` when empty.
 */
export function classifyKind(latex: string, isMath = true): RecognizeResponse["kind"] {
  const trimmed = latex.trim();
  if (!trimmed) return "unknown";
  // Strip LaTeX commands before looking for element symbols so `\rightarrow` itself never matches.
  const bare = trimmed.replace(/\\[a-zA-Z]+/g, " ");
  if (ARROW_RE.test(trimmed) && ELEMENT_RE.test(bare)) return "chem";
  if (!isMath) return "text";
  if (textCoverage(trimmed) > 0.5) return "text";
  if (!MATHY_RE.test(trimmed)) return "text";
  return "math";
}

/* ------------------------------------------------------------------------- */
/* check: server post-filters (spec §5.3)                                     */
/* ------------------------------------------------------------------------- */

/**
 * - unknown `lineId` -> drop
 * - `praise` only when the last line's local verdict is ok
 * - never contradict a local `ok` with a `warn`
 * - feedback mode: strip `question` / `latex`
 */
export function filterAnnotation(a: Annotation, req: Pick<CheckRequest, "lines" | "mode">): Annotation | null {
  const ids = new Set(req.lines.map((l) => l.id));
  if (a.lineId !== null && !ids.has(a.lineId)) return null;

  if (a.kind === "praise") {
    const last = req.lines[req.lines.length - 1];
    if (!last || last.local.verdict !== "ok") return null;
  }

  if (a.lineId !== null && a.verdict === "warn") {
    const line = req.lines.find((l) => l.id === a.lineId);
    if (line && line.local.verdict === "ok") return null;
  }

  if (req.mode === "feedback") {
    const stripped: Annotation = { ...a };
    delete stripped.question;
    delete stripped.latex;
    return stripped;
  }
  return a;
}

/* ------------------------------------------------------------------------- */
/* solve: step normalization (spec §5.4)                                      */
/* ------------------------------------------------------------------------- */

/** Re-index a step and make sure a final step is boxed. */
export function normalizeStep(step: SolveStep, index: number): SolveStep {
  const latex = step.final && !/\\boxed\{/.test(step.latex) ? `\\boxed{${step.latex}}` : step.latex;
  return { ...step, index, latex };
}
