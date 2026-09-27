/**
 * JOB 2 — the solve fallback: problems the local engine cannot do today, sent with the product's
 * own solve prompt (`buildSolveMessages`, src/lib/server/prompts/solve.ts) so the reply is the
 * JSON Lines the route really parses. Each reply goes through the route's parser
 * (`jsonlToEvents` + `SolveStepSchema`, 8-step cap, last step forced final and boxed) and then
 * through the board's interlock (`createSolveStepGuard` with `engineParsesStep`), exactly as
 * `LiveLoop` does before it draws anything.
 *
 * Scored: the fraction of steps the guard lets through, whether the final answer is right
 * (numerically, `answers.ts`), and whether any step carries words. `usable` is what a student
 * would actually see: the final step survives the guard, is right, and no step has words.
 *
 * The candidates are filtered at run time to the ones `localSolve` still returns `source: null`
 * for — when the engine learns one, it drops out of the bench on its own.
 */
import { LIVE_LIMITS, SolveStepSchema, type CheckLine, type LiveEngine, type SolveRequest, type SolveStep } from "@/lib/live/contracts";
import { analyzeColumn, localSolve } from "@/lib/live/localSolve";
import { createSolveStepGuard, engineParsesStep, type SolveStepRejection } from "@/lib/live/solveSteps";
import { normalizeStep } from "@/lib/server/live-rules";
import { buildSolveMessages } from "@/lib/server/prompts/solve";
import { jsonlToEvents } from "@/lib/server/sse";
import { wordsIn } from "../judge";
import { checkAnswer, type AnswerSpec } from "./answers";
import type { BenchMessage } from "./client";

export interface FallbackProblem {
  id: string;
  area: "integral" | "improper" | "limit" | "series" | "sequence" | "system" | "trig" | "identity" | "optimization" | "function" | "inequality" | "counting";
  lines: string[];
  expect: AnswerSpec;
  /** shown in the report */
  answer: string;
}

const PI = Math.PI;

export const FALLBACK_CANDIDATES: readonly FallbackProblem[] = [
  { id: "fb-01", area: "integral", lines: ["\\int x e^{x} \\, dx"], expect: { kind: "antiderivative", integrand: "x e^{x}", variable: "x" }, answer: "x e^{x} - e^{x} + C" },
  { id: "fb-02", area: "integral", lines: ["\\int x \\cos(x^{2}) \\, dx"], expect: { kind: "antiderivative", integrand: "x \\cos(x^{2})", variable: "x" }, answer: "\\frac{1}{2}\\sin(x^{2}) + C" },
  { id: "fb-03", area: "integral", lines: ["\\int \\sin^{2} x \\, dx"], expect: { kind: "antiderivative", integrand: "\\sin^{2}(x)", variable: "x" }, answer: "\\frac{x}{2} - \\frac{\\sin 2x}{4} + C" },
  { id: "fb-04", area: "integral", lines: ["\\int \\frac{1}{x^{2} + 1} \\, dx"], expect: { kind: "antiderivative", integrand: "\\frac{1}{x^{2} + 1}", variable: "x" }, answer: "\\arctan x + C" },
  { id: "fb-05", area: "integral", lines: ["\\int \\ln x \\, dx"], expect: { kind: "antiderivative", integrand: "\\ln(x)", variable: "x" }, answer: "x \\ln x - x + C" },
  { id: "fb-06", area: "integral", lines: ["\\int \\frac{1}{x^{2} - 1} \\, dx"], expect: { kind: "antiderivative", integrand: "\\frac{1}{x^{2} - 1}", variable: "x" }, answer: "\\frac{1}{2}\\ln\\left|\\frac{x - 1}{x + 1}\\right| + C" },
  { id: "fb-07", area: "integral", lines: ["\\int e^{x} \\sin x \\, dx"], expect: { kind: "antiderivative", integrand: "e^{x} \\sin(x)", variable: "x" }, answer: "\\frac{e^{x}(\\sin x - \\cos x)}{2} + C" },
  { id: "fb-08", area: "improper", lines: ["\\int_{1}^{\\infty} \\frac{1}{x^{2}} \\, dx"], expect: { kind: "number", value: 1 }, answer: "1" },
  { id: "fb-09", area: "limit", lines: ["\\lim_{x \\to 0} \\frac{e^{x} - 1}{x}"], expect: { kind: "number", value: 1 }, answer: "1" },
  { id: "fb-10", area: "limit", lines: ["\\lim_{x \\to 4} \\frac{\\sqrt{x} - 2}{x - 4}"], expect: { kind: "number", value: 0.25 }, answer: "\\frac{1}{4}" },
  { id: "fb-11", area: "limit", lines: ["\\lim_{n \\to \\infty} \\left(1 + \\frac{1}{n}\\right)^{n}"], expect: { kind: "number", value: Math.E }, answer: "e" },
  { id: "fb-12", area: "limit", lines: ["\\lim_{x \\to \\infty} \\left(\\sqrt{x^{2} + x} - x\\right)"], expect: { kind: "number", value: 0.5 }, answer: "\\frac{1}{2}" },
  { id: "fb-13", area: "series", lines: ["\\sum_{n=1}^{\\infty} \\frac{1}{2^{n}}"], expect: { kind: "number", value: 1 }, answer: "1" },
  { id: "fb-14", area: "series", lines: ["\\sum_{k=1}^{n} k^{2}"], expect: { kind: "expression", latex: "\\frac{n(n + 1)(2n + 1)}{6}" }, answer: "\\frac{n(n + 1)(2n + 1)}{6}" },
  { id: "fb-15", area: "sequence", lines: ["a_{1} = 3", "d = 4", "a_{20} = ?"], expect: { kind: "number", value: 79 }, answer: "79" },
  { id: "fb-16", area: "system", lines: ["x^{2} - y^{2} = 16", "x - y = 2"], expect: { kind: "values", values: { x: [5], y: [3] } }, answer: "x = 5, \\ y = 3" },
  { id: "fb-17", area: "system", lines: ["\\log x + \\log y = 2", "x = 4y"], expect: { kind: "values", values: { x: [20], y: [5] } }, answer: "x = 20, \\ y = 5" },
  { id: "fb-18", area: "system", lines: ["y = x^{2}", "y = 2x + 3"], expect: { kind: "values", values: { x: [-1, 3], y: [1, 9] } }, answer: "(x, y) = (-1, 1), (3, 9)" },
  { id: "fb-19", area: "trig", lines: ["2\\sin x - 1 = 0, \\quad 0 \\le x < 2\\pi"], expect: { kind: "values", values: { x: [PI / 6, (5 * PI) / 6] } }, answer: "x = \\frac{\\pi}{6}, \\ x = \\frac{5\\pi}{6}" },
  { id: "fb-20", area: "trig", lines: ["2\\cos^{2} x - \\cos x - 1 = 0, \\quad 0 \\le x < 2\\pi"], expect: { kind: "values", values: { x: [0, (2 * PI) / 3, (4 * PI) / 3] } }, answer: "x = 0, \\ x = \\frac{2\\pi}{3}, \\ x = \\frac{4\\pi}{3}" },
  { id: "fb-21", area: "identity", lines: ["\\frac{\\sin^{2} x}{1 - \\cos x} = 1 + \\cos x"], expect: { kind: "expression", latex: "1 + \\cos(x)" }, answer: "1 + \\cos x" },
  { id: "fb-22", area: "optimization", lines: ["A = x(20 - x)", "\\frac{dA}{dx} = 0"], expect: { kind: "values", values: { x: [10] } }, answer: "x = 10" },
  { id: "fb-23", area: "function", lines: ["f(x) = \\frac{2x + 1}{x - 3}", "f^{-1}(x) = ?"], expect: { kind: "expression", latex: "\\frac{3x + 1}{x - 2}" }, answer: "\\frac{3x + 1}{x - 2}" },
  { id: "fb-24", area: "inequality", lines: ["\\frac{x - 1}{x + 2} > 0"], expect: { kind: "relation", latex: "x < -2, \\ x > 1", variable: "x" }, answer: "x < -2, \\ x > 1" },
  { id: "fb-25", area: "counting", lines: ["\\binom{10}{3}"], expect: { kind: "number", value: 120 }, answer: "120" },
  // spares: used only if the engine learns one of the above
  { id: "fb-26", area: "integral", lines: ["\\int \\tan x \\, dx"], expect: { kind: "antiderivative", integrand: "\\tan(x)", variable: "x" }, answer: "-\\ln|\\cos x| + C" },
  { id: "fb-27", area: "limit", lines: ["\\lim_{x \\to 0} \\frac{\\ln(1 + x)}{x}"], expect: { kind: "number", value: 1 }, answer: "1" },
  { id: "fb-28", area: "inequality", lines: ["x^{2} - 5x + 6 < 0"], expect: { kind: "relation", latex: "2 < x < 3", variable: "x" }, answer: "2 < x < 3" },
  // harder ones, added when the engine learned trig and integration techniques (2026-09-27)
  { id: "fb-26", area: "integral", lines: ["\\int e^{x} \\sin x \\, dx"], expect: { kind: "antiderivative", integrand: "e^{x} \\sin(x)", variable: "x" }, answer: "\\frac{e^{x}(\\sin x - \\cos x)}{2} + C" },
  { id: "fb-27", area: "integral", lines: ["\\int \\frac{1}{x^{2}(x + 1)} \\, dx"], expect: { kind: "antiderivative", integrand: "\\frac{1}{x^{2}(x + 1)}", variable: "x" }, answer: "-\\frac{1}{x} - \\ln|x| + \\ln|x + 1| + C" },
  { id: "fb-28", area: "integral", lines: ["\\int \\frac{1}{x^{2} + 2x + 5} \\, dx"], expect: { kind: "antiderivative", integrand: "\\frac{1}{x^{2} + 2x + 5}", variable: "x" }, answer: "\\frac{1}{2}\\arctan\\frac{x + 1}{2} + C" },
  { id: "fb-29", area: "integral", lines: ["\\int x^{2} e^{x} \\, dx"], expect: { kind: "antiderivative", integrand: "x^{2} e^{x}", variable: "x" }, answer: "e^{x}(x^{2} - 2x + 2) + C" },
  { id: "fb-30", area: "trig", lines: ["\\sin x = \\frac{1}{3}, \\ 0 \\le x < 2\\pi"], expect: { kind: "values", values: { x: [Math.asin(1 / 3), PI - Math.asin(1 / 3)] } }, answer: "x = \\sin^{-1}\\frac{1}{3}, \\ x = \\pi - \\sin^{-1}\\frac{1}{3}" },
  { id: "fb-31", area: "series", lines: ["\\sum_{n=0}^{\\infty} \\left(\\frac{1}{2}\\right)^{n}"], expect: { kind: "number", value: 2 }, answer: "2" },
  { id: "fb-32", area: "series", lines: ["\\sum_{n=1}^{\\infty} \\frac{1}{n(n+1)}"], expect: { kind: "number", value: 1 }, answer: "1" },
  { id: "fb-33", area: "function", lines: ["2^{x} = 3^{x - 1}"], expect: { kind: "values", values: { x: [Math.log(3) / (Math.log(3) - Math.log(2))] } }, answer: "x = \\frac{\\ln 3}{\\ln 3 - \\ln 2}" },
  { id: "fb-34", area: "function", lines: ["e^{2x} - 3e^{x} + 2 = 0"], expect: { kind: "values", values: { x: [0, Math.log(2)] } }, answer: "x = 0, \\ x = \\ln 2" },
  { id: "fb-35", area: "inequality", lines: ["|x - 1| + |x + 2| = 5"], expect: { kind: "values", values: { x: [-3, 2] } }, answer: "x = -3, \\ x = 2" },
  { id: "fb-36", area: "counting", lines: ["\\binom{10}{3} ="], expect: { kind: "number", value: 120 }, answer: "120" },
  { id: "fb-37", area: "limit", lines: ["\\lim_{x \\to 0} \\frac{\\tan x - x}{x^{3}}"], expect: { kind: "number", value: 1 / 3 }, answer: "\\frac{1}{3}" },
  { id: "fb-38", area: "sequence", lines: ["a_{1} = 3, \\ a_{n} = 2a_{n-1}", "a_{6} = ?"], expect: { kind: "number", value: 96 }, answer: "96" },
  { id: "fb-39", area: "optimization", lines: ["A = x(20 - 2x)", "\\text{maximum of } A"], expect: { kind: "number", value: 50 }, answer: "50" },
];

export const FALLBACK_SIZE = 25;

/** The candidates the engine still cannot do (`localSolve` → `source: null`), first `FALLBACK_SIZE`. */
export function selectFallbackProblems(engine: LiveEngine, candidates: readonly FallbackProblem[] = FALLBACK_CANDIDATES, size = FALLBACK_SIZE): FallbackProblem[] {
  return candidates.filter((p) => localSolve(engine, p.lines).source === null).slice(0, size);
}

/** The request the board would send for these lines: each line with the engine's own kind and verdict. */
export function solveRequestFor(engine: LiveEngine, p: FallbackProblem): SolveRequest {
  const analyses = analyzeColumn(engine, p.lines);
  const lines: CheckLine[] = p.lines.map((latex, i) => ({
    id: `l${i + 1}`,
    latex,
    bbox: [0.1, 0.1 + 0.1 * i, 0.6, 0.18 + 0.1 * i],
    local: { kind: analyses[i]?.kind ?? "unknown", verdict: analyses[i]?.verdict ?? "unknown" },
  }));
  return { boardId: "bench", region: { x: 0, y: 0, w: 1600, h: 900 }, lines };
}

export function fallbackMessages(engine: LiveEngine, p: FallbackProblem): BenchMessage[] {
  return buildSolveMessages(solveRequestFor(engine, p)) as BenchMessage[];
}

// ---------------------------------------------------------------- scoring

export interface FallbackStep {
  latex: string;
  ok: boolean;
  reason?: SolveStepRejection;
  introduced: string[];
}

export interface FallbackScore {
  id: string;
  /** no parseable step at all */
  badOutput: boolean;
  invalidLines: number;
  steps: FallbackStep[];
  stepsPassed: number;
  /** the final step's answer is right (whatever the guard says) */
  answerCorrect: boolean;
  /** the final step survives the guard */
  finalDrawn: boolean;
  words: boolean;
  /** what the student would see: final step drawn, right, no words */
  usable: boolean;
  /**
   * The same with the integration constant `C` in scope: today's guard rejects every `+ C` as a
   * symbol from nowhere, so no antiderivative from any model is ever drawn. A what-if, not the product.
   */
  stepsPassedWithC: number;
  usableWithC: boolean;
  got: string;
  reason?: string;
}

/** The route's parse of a JSONL reply: valid steps, 8-step cap, the last one final and boxed. */
export async function parseSolveReply(content: string): Promise<{ steps: SolveStep[]; invalid: number }> {
  const steps: SolveStep[] = [];
  let pending: SolveStep | null = null;
  const flush = (isLast: boolean) => {
    if (!pending) return;
    steps.push(normalizeStep(isLast ? { ...pending, final: true } : pending, steps.length + 1));
    pending = null;
  };
  async function* once() {
    yield content;
  }
  const { invalid } = await jsonlToEvents(once(), SolveStepSchema, (step) => {
    flush(false);
    pending = step;
    if (steps.length + 1 >= LIVE_LIMITS.maxSolveSteps) {
      flush(true);
      return false;
    }
    return true;
  });
  flush(true);
  return { steps, invalid };
}

export async function scoreFallbackReply(engine: LiveEngine, p: FallbackProblem, content: string): Promise<FallbackScore> {
  const { steps, invalid } = await parseSolveReply(content);
  if (steps.length === 0) {
    return { id: p.id, badOutput: true, invalidLines: invalid, steps: [], stepsPassed: 0, answerCorrect: false, finalDrawn: false, words: false, usable: false, stepsPassedWithC: 0, usableWithC: false, got: "", reason: "no valid step" };
  }
  const parses = (latex: string) => engineParsesStep(engine, latex);
  const guard = createSolveStepGuard({ sourceLatex: p.lines, parses });
  const judged: FallbackStep[] = steps.map((s) => {
    const v = guard.check(s.latex);
    return { latex: s.latex, ok: v.ok, reason: v.reason, introduced: v.introduced };
  });
  const withC = createSolveStepGuard({ sourceLatex: [...p.lines, "C"], parses });
  const judgedWithC = steps.map((s) => withC.check(s.latex).ok);
  const latex = steps.map((s) => s.latex);
  const check = checkAnswer(p.expect, latex);
  const words = latex.some((l) => wordsIn(l).length > 0);
  const finalDrawn = judged[judged.length - 1].ok;
  return {
    id: p.id,
    badOutput: false,
    invalidLines: invalid,
    steps: judged,
    stepsPassed: judged.filter((s) => s.ok).length,
    answerCorrect: check.correct,
    finalDrawn,
    words,
    usable: check.correct && finalDrawn && !words,
    stepsPassedWithC: judgedWithC.filter(Boolean).length,
    usableWithC: check.correct && judgedWithC[judgedWithC.length - 1] && !words,
    got: check.got,
    reason: check.reason,
  };
}
