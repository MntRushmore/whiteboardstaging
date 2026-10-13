/**
 * The try board's problems (src/lib/try/contracts.ts): the onboarding's own starters — the ones
 * the guided board writes for a new student, each held to the engine in
 * src/lib/onboarding/__tests__/courses.test.ts — grouped into the page's grade bands. Pure: the page
 * renders them and the routes look them up by id, so a problem the page shows is always one the
 * engine can check.
 */
import { GRADE_STARTERS, STARTER_PROBLEMS, type StarterProblem } from "@/lib/onboarding/courses";
import { TRY_BANDS, type TryBandId, type TryProblem } from "./contracts";

function fromStarter(band: TryBandId, n: number, s: StarterProblem): TryProblem {
  return { id: `${band}-${n}`, band, lines: s.lines, hint: s.hint, oneStep: Boolean(s.oneStep) };
}

function build(): readonly TryProblem[] {
  const out: TryProblem[] = [];
  for (const band of TRY_BANDS) {
    const starters = [...band.grades.flatMap((g) => GRADE_STARTERS[g] ?? []), ...band.courses.flatMap((c) => STARTER_PROBLEMS[c] ?? [])];
    starters.forEach((s, n) => out.push(fromStarter(band.id, n, s)));
  }
  return out;
}

/** Every problem, band by band, each band in grade order. */
export const TRY_PROBLEMS: readonly TryProblem[] = build();

const BY_ID = new Map(TRY_PROBLEMS.map((p) => [p.id, p]));

/** A band's problems, in order. */
export function tryProblems(band: TryBandId): readonly TryProblem[] {
  return TRY_PROBLEMS.filter((p) => p.band === band);
}

/** The problem with this id, or null (an id the page made up, or from an older page). */
export function tryProblem(id: string): TryProblem | null {
  return BY_ID.get(id) ?? null;
}
