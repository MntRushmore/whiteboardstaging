/**
 * The course problem sets, one file per school course, added to the scoreboard after the
 * original corpus (`../corpus.ts` → `CORPUS`). A problem's course is its topic's
 * (`TOPIC_COURSE`) unless it names one; `docs/eval/courses.md` lists each course's skills.
 *
 * HOOK(geometry): the Geometry set lives in `./geometry.ts` (`export const GEOMETRY: EvalProblem[]`),
 * written in parallel. When that file lands, import it here and add `...GEOMETRY` to the list:
 *
 *   import { GEOMETRY } from "./geometry";
 *   export const COURSE_PROBLEMS = [...ALGEBRA_1, ...ALGEBRA_2, ...GEOMETRY];
 */
import type { EvalProblem } from "../corpus";
import { ALGEBRA_1 } from "./algebra1";
import { ALGEBRA_2 } from "./algebra2";

export const COURSE_PROBLEMS: readonly EvalProblem[] = [...ALGEBRA_1, ...ALGEBRA_2];
