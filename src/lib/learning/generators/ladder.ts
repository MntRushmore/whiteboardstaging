/**
 * A topic's problems as a ladder (the topic picker's boards): a worked example, then problems that
 * get a bit harder each time. The skill's forms are ranked from easy to hard by how much there is
 * to each problem they make (`difficultyOf`, averaged over a few fixed draws, so a skill's ranking
 * is the same on every device and every visit); the problems are drawn from forms spread along that
 * ranking, the first from the easiest form, and the worked example from the easiest form too, so
 * the first "Now you try" is one like the example.
 */
import type { PracticeProblem } from "../contracts";
import type { Form } from "./form";
import { makeRng, seedFrom } from "./rng";

/** Draws of one form before the ladder moves on to the form next to it. */
const DRAWS_PER_FORM = 40;
/** Draws of each form that rank it. */
const RANK_SAMPLES = 6;
/**
 * How much a form's place in its skill's list adds to its rank: the forms are written roughly from
 * the classic first one on (`\frac{2}{8} + \frac{3}{8}` before `5 \times \frac{1}{4}`), and that
 * order breaks the near ties `difficultyOf` cannot tell apart.
 */
const LIST_WEIGHT = 1.5;

/**
 * How much there is to a problem, roughly as a student meets it: each number (more for long ones and
 * decimals), each letter, operation and relation, and more for fractions, roots, powers, brackets,
 * absolute values, functions (sin, log, ∫, lim) and each extra line of a system. Only ever compared
 * within one skill.
 */
export function difficultyOf(problem: readonly string[]): number {
  let score = (problem.length - 1) * 4;
  for (const raw of problem) {
    const s = raw.replace(/\\(?:left|right)/g, "");
    for (const n of s.match(/\d+(?:\.\d+)?/g) ?? []) score += 1 + 0.4 * (n.replace(".", "").length - 1) + (n.includes(".") ? 1 : 0);
    score += 1.5 * (s.replace(/\\[a-zA-Z]+/g, "").match(/[a-zA-Z]/g) ?? []).length;
    score += (s.match(/[+\-=<>]|\\(?:times|div|cdot|le|ge|pm|to)(?![a-zA-Z])/g) ?? []).length;
    score += 2 * (s.match(/\\frac/g) ?? []).length;
    score += 2 * (s.match(/\\sqrt/g) ?? []).length;
    score += 1.5 * (s.match(/\^/g) ?? []).length;
    score += 1.5 * (s.match(/\(/g) ?? []).length;
    score += 0.75 * (s.match(/\|/g) ?? []).length;
    score += 2 * (s.match(/\\(?:sin|cos|tan|log|ln|int|lim)(?![a-zA-Z])/g) ?? []).length;
  }
  return score;
}

const rankings = new Map<string, number[]>();

/** The skill's form indices from easiest to hardest: `difficultyOf` on a few draws, nudged by the list's own order. */
export function rankForms(skill: string, forms: readonly Form[]): number[] {
  const cached = rankings.get(skill);
  if (cached && cached.length === forms.length) return cached;
  const r = makeRng(seedFrom(0, `${skill}:rank`));
  const scores = forms.map((form) => {
    let total = 0;
    let n = 0;
    for (let i = 0; i < RANK_SAMPLES * 4 && n < RANK_SAMPLES; i++) {
      const p = form(r);
      if (!p || p.length === 0) continue;
      total += difficultyOf(p);
      n++;
    }
    return n > 0 ? total / n : Number.POSITIVE_INFINITY;
  });
  forms.forEach((_, i) => (scores[i] += LIST_WEIGHT * i));
  const ranked = forms.map((_, i) => i).sort((a, b) => scores[a] - scores[b] || a - b);
  rankings.set(skill, ranked);
  return ranked;
}

export interface Ladder {
  /** easy to hard, each new to the ladder */
  problems: PracticeProblem[];
  /** worked-example candidates, easiest first, none of them among `problems` */
  examples: PracticeProblem[];
}

/** Where along the ranking each of `count` problems comes from: the first at the easiest, the last at the hardest. */
export function ladderRanks(forms: number, count: number): number[] {
  if (forms <= 0 || count <= 0) return [];
  if (count === 1) return [0];
  return Array.from({ length: count }, (_, i) => Math.round((i * (forms - 1)) / (count - 1)));
}

/**
 * `count` problems from easy to hard and `examples` worked-example candidates, from `seed` (the same
 * seed, the same ladder). Fewer when the skill's forms keep missing (never in practice).
 */
export function drawLadderFrom(skill: string, forms: readonly Form[], count: number, seed: number, examples = 3): Ladder {
  const n = Math.max(0, Math.floor(Number.isFinite(count) ? count : 0));
  if (forms.length === 0 || n === 0) return { problems: [], examples: [] };
  const ranked = rankForms(skill, forms);
  const r = makeRng(seedFrom(seed, `${skill}:ladder`));
  const seen = new Set<string>();
  const draw = (rank: number): PracticeProblem | null => {
    // the form at this rank, then the ones next to it, easier first
    const order = [rank, ...ranked.map((_, k) => k).filter((k) => k !== rank).sort((a, b) => Math.abs(a - rank) - Math.abs(b - rank) || a - b)];
    for (const k of order) {
      const form = forms[ranked[k]];
      for (let t = 0; t < DRAWS_PER_FORM; t++) {
        const p = form(r);
        if (!p || p.length === 0) continue;
        const key = p.join("; ");
        if (seen.has(key)) continue;
        seen.add(key);
        return [...p];
      }
    }
    return null;
  };
  const problems = ladderRanks(forms.length, n)
    .map(draw)
    .filter((p): p is PracticeProblem => p !== null);
  const exampleRanks = [0, 0, 1, 1].slice(0, Math.max(0, examples)).map((k) => Math.min(k, forms.length - 1));
  return {
    problems,
    examples: exampleRanks.map(draw).filter((p): p is PracticeProblem => p !== null),
  };
}
