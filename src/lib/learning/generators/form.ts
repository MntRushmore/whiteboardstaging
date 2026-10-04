import type { PracticeProblem, SkillId } from "../contracts";
import type { Rng } from "./rng";

/**
 * One form of practice problem (`ax + b = c`, `\frac{x}{a} - b = c`, …): numbers chosen from the
 * seeded generator, answer first, so the problem is clean by construction. Null when this draw
 * missed a constraint (the caller draws again).
 */
export type Form = (r: Rng) => PracticeProblem | null;

/** The forms of each skill that has practice. */
export type FormTable = Partial<Record<SkillId, readonly Form[]>>;
