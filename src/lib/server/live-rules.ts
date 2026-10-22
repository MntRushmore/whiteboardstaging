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
/**
 * A hint points with the ink, never by counting: its card sits beside the line, and a kid does not
 * number their lines (the iPad's kid sessions, 2026-10-22: "Check the addition on the right side of
 * line 4", where line 4 counted the tutor's problem). "line 4" -> "this line", "lines 2 and 3" ->
 * "these lines", "step 3" -> "this step", "the second line" -> "this line". The iPad's
 * `LiveCopy.Hint.pointing` does the same to whatever reaches a card.
 */
export function pointWithInk(text: string): string {
  const rules: [RegExp, string][] = [
    [/\blines\s+\d+(?:\s*(?:,|and|&|-|–|to)\s*\d+)+\b/gi, "these lines"],
    [/\bsteps\s+\d+(?:\s*(?:,|and|&|-|–|to)\s*\d+)+\b/gi, "these steps"],
    [/\bline\s*(?:#|no\.?\s*)?\d+\b/gi, "this line"],
    [/\bstep\s*(?:#|no\.?\s*)?\d+\b/gi, "this step"],
    [/\b(?:the\s+)?(?:first|second|third|fourth|fifth|sixth|last)\s+line\b/gi, "this line"],
  ];
  let out = text;
  for (const [re, words] of rules) {
    out = out.replace(re, (_m, ...rest) => {
      const offset = rest[rest.length - 2] as number;
      const whole = rest[rest.length - 1] as string;
      const before = whole.slice(0, offset).trimEnd();
      // a sentence's first word keeps its capital
      const starts = before === "" || /[.?:!]$/.test(before);
      return starts ? words[0].toUpperCase() + words.slice(1) : words;
    });
  }
  return out;
}

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

  a = { ...a, message: pointWithInk(a.message), ...(a.question !== undefined ? { question: pointWithInk(a.question) } : {}) };

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
  return { ...step, index, latex, explanation: pointWithInk(step.explanation) };
}
