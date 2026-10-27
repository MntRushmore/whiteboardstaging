/**
 * Spaced comebacks (docs/KEYS.md, Phase 4): a skill the kid got through only with help comes back as
 * ONE warm-up problem 2 days later and again 7 days later, so a fix turns into something they keep.
 *
 * Read from the learning record (`learning_attempts`, any origin: a hint on the iPad counts too). For
 * each skill, the latest attempt that ended `with_help` (or `tutor_solved`: the tutor finished it) is
 * the day it was fixed; the comebacks are due that day + 2 and + 7 (local days). One is done once the
 * kid has worked that skill again on or after its due day, whatever the origin. A newer help resets
 * the skill's clock. Only skills Keys can write a problem for are offered (`canWrite`).
 *
 * Pure: no clock (`now` and the time zone come in), no network. Unit-tested.
 */
import type { AttemptRecord, Outcome } from "@/lib/learning/contracts";

/** Days after the help that a skill comes back. */
export const COMEBACK_DAYS = [2, 7] as const;

/** The outcomes that mean "fixed with help". */
const HELPED: readonly Outcome[] = ["with_help", "tutor_solved"];

/** Outcomes that are work on the skill (an attempt left untouched is not a comeback). */
const WORKED: readonly Outcome[] = ["first_try", "self_corrected", "with_help", "tutor_solved"];

const DAY_MS = 86_400_000;

export interface Comeback {
  skill: string;
  /** the local day (YYYY-MM-DD) it was due */
  dueDay: string;
  /** 2 or 7 */
  after: (typeof COMEBACK_DAYS)[number];
  /** the attempt that needed the help */
  fromAttemptId: string;
}

/** The local calendar date of `ms` for a UTC offset in minutes (`Date#getTimezoneOffset`'s sign). */
export function localDayOf(ms: number, tzOffsetMinutes: number): string {
  return new Date(ms - tzOffsetMinutes * 60_000).toISOString().slice(0, 10);
}

function addDays(day: string, n: number): string {
  return new Date(Date.parse(`${day}T00:00:00Z`) + n * DAY_MS).toISOString().slice(0, 10);
}

/**
 * The comebacks due today, most overdue first (at most `limit`). A skill appears once: its earliest
 * comeback still owed (the 2-day one, then the 7-day one). A 2-day comeback never done is let go once
 * the 7-day one is due: the skill is owed one problem, not two.
 */
export function dueComebacks(
  attempts: readonly AttemptRecord[],
  opts: { now: number; tzOffsetMinutes: number; canWrite: (skill: string) => boolean; limit?: number },
): Comeback[] {
  const today = localDayOf(opts.now, opts.tzOffsetMinutes);
  const bySkill = new Map<string, AttemptRecord[]>();
  for (const a of attempts) {
    if (!opts.canWrite(a.skill)) continue;
    const list = bySkill.get(a.skill) ?? [];
    list.push(a);
    bySkill.set(a.skill, list);
  }
  const out: Comeback[] = [];
  for (const [skill, list] of bySkill) {
    const dayOf = (a: AttemptRecord) => localDayOf(Date.parse(a.startedAt), opts.tzOffsetMinutes);
    const helped = list.filter((a) => HELPED.includes(a.outcome) && Number.isFinite(Date.parse(a.startedAt)));
    if (helped.length === 0) continue;
    const last = helped.reduce((x, y) => (Date.parse(y.startedAt) > Date.parse(x.startedAt) ? y : x));
    const helpDay = dayOf(last);
    const workedDays = list.filter((a) => a.id !== last.id && WORKED.includes(a.outcome)).map(dayOf);
    // the latest comeback already due: owed when nothing was worked on or after it
    let owed: Comeback | null = null;
    for (const after of COMEBACK_DAYS) {
      const dueDay = addDays(helpDay, after);
      if (dueDay > today) break;
      owed = workedDays.some((d) => d >= dueDay) ? null : { skill, dueDay, after, fromAttemptId: last.id };
    }
    if (owed) out.push(owed);
  }
  out.sort((a, b) => (a.dueDay === b.dueDay ? a.skill.localeCompare(b.skill) : a.dueDay < b.dueDay ? -1 : 1));
  return out.slice(0, opts.limit ?? out.length);
}
