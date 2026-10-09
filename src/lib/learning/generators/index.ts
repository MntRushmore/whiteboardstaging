/**
 * Every practice generator, by skill, and the one way problems are drawn from them: the skill's
 * forms in a shuffled rotation (so a batch varies in form), each problem new to the batch.
 */
import type { PracticeProblem, SkillId } from "../contracts";
import { ALGEBRA } from "./algebra";
import { ARITHMETIC } from "./arithmetic";
import { CALCULUS } from "./calculus";
import type { Form, FormTable } from "./form";
import { FUNCTIONS } from "./functions";
import { GEOMETRY } from "./geometry";
import { drawLadderFrom, type Ladder } from "./ladder";
import { PRIMARY } from "./primary";
import { makeRng, seedFrom } from "./rng";
import { SCIENCE } from "./science";
import { TRIG } from "./trig";

export type { Form, FormTable } from "./form";
export { difficultyOf, type Ladder } from "./ladder";

/** Every skill's forms: the K–8 path's (`primary.ts`), then the original skills'. */
export const GENERATORS: FormTable = { ...PRIMARY, ...ARITHMETIC, ...ALGEBRA, ...FUNCTIONS, ...GEOMETRY, ...TRIG, ...CALCULUS, ...SCIENCE };

/** The most problems one call makes (a practice board holds 12; `write_problems` takes 12). */
export const MAX_PRACTICE = 24;

/** Draws per problem before a batch gives up (a form's constraint missed, a repeat). */
const DRAWS_PER_PROBLEM = 40;

export function formsFor(skill: string): readonly Form[] {
  return (Object.prototype.hasOwnProperty.call(GENERATORS, skill) ? GENERATORS[skill as SkillId] : undefined) ?? [];
}

/**
 * `count` different problems for a skill from `seed`: the forms in an order the seed shuffles,
 * taken in turn, so consecutive problems differ in form. A prefix of a longer batch from the same
 * seed is the shorter batch.
 */
export function drawProblems(skill: string, count: number, seed: number): PracticeProblem[] {
  const forms = formsFor(skill);
  const n = Math.min(MAX_PRACTICE, Math.max(0, Math.floor(Number.isFinite(count) ? count : 0)));
  if (forms.length === 0 || n === 0) return [];
  const r = makeRng(seedFrom(seed, skill));
  const order = r.shuffle(forms.map((_, i) => i));
  const out: PracticeProblem[] = [];
  const seen = new Set<string>();
  for (let draw = 0; out.length < n && draw < n * DRAWS_PER_PROBLEM; draw++) {
    const problem = forms[order[draw % order.length]](r);
    if (!problem || problem.length === 0) continue;
    const key = problem.join("; ");
    if (seen.has(key)) continue;
    seen.add(key);
    out.push([...problem]);
  }
  return out;
}

/**
 * A topic's ladder (`ladder.ts`): `count` problems from easy to hard and a few worked-example
 * candidates from the easiest form, none repeated. Same seed, same ladder.
 */
export function drawLadder(skill: string, count: number, seed: number): Ladder {
  return drawLadderFrom(skill, formsFor(skill), Math.min(MAX_PRACTICE, count), seed);
}
