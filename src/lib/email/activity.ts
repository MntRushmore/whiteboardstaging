/**
 * What a family did on Agathon, for the emails its grown-up gets during the free trial (2026-10-09,
 * "kids come back"): the trial nudges (src/lib/email/nudges.ts) and the "your trial ends" reminder
 * (src/lib/email/trialReminders.ts). Parents need to see what their kid did before the card is
 * charged; and a family that has not started yet needs a nudge, not a bill.
 *
 * A family is the account that holds the plan and its kid profiles (`family_members`, the kids
 * share the grown-up's plan). The emails name the kids when there are any, else the account itself
 * (a student's own account, paid for by a parent). What was done is everyone's, the account's own
 * work included even when it has kids (a student on the grown-up's login, with a sibling added as a
 * kid): "has anyone practiced" (`practicedSinceOnboarding`) and "what was done"
 * (`familyProgress`) read the same people, so a family that skips the first-practice nudge because
 * someone practiced is the one the progress email and the reminder tell about.
 *
 * The pure half (summaries, names, the streak) is tested on its own; `readFamilyActivity` is the one
 * reader, through the service role, and never throws.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { skillDef } from "@/lib/learning/contracts";
import { K8_SKILLS, isK8SkillId } from "@/lib/learning/grades";
import { EMAIL_TIME_ZONE, progressLines, type LearnerProgress } from "@/lib/email/templates";

export type { LearnerProgress };

const DAY_MS = 24 * 60 * 60 * 1000;

/** Outcomes that count as a problem solved (the student got there, with a hint or not). */
export const SOLVED_OUTCOMES: readonly string[] = ["first_try", "self_corrected", "with_help"];
/** Of those, solved without help. */
export const ALONE_OUTCOMES: readonly string[] = ["first_try", "self_corrected"];

/** Attempts read per family at most (newest first): far more than a trial's first week holds. */
export const ATTEMPT_READ_CAP = 2_000;
/** Today's practice rows read per family at most. */
export const PRACTICE_READ_CAP = 500;
/** How far back Today's practice is read, for the streak. */
export const PRACTICE_LOOKBACK_DAYS = 60;

export interface LearnerAttempt {
  skill: string;
  outcome: string;
  /** ISO */
  startedAt: string;
}

export interface LearnerPractice {
  /** the student's local day, YYYY-MM-DD */
  day: string;
  done: number;
  goal: number;
  completedAt: string | null;
}

/** One person in the family: the account, or one of its kids. */
export interface LearnerActivity {
  userId: string;
  displayName: string | null;
  isKid: boolean;
  onboardedAt: string | null;
  /** since the reader's `since`, newest first */
  attempts: LearnerAttempt[];
  /** the last PRACTICE_LOOKBACK_DAYS days */
  practice: LearnerPractice[];
}

export interface FamilyActivity {
  /** the account first, then its kids in the order they were added */
  learners: LearnerActivity[];
}

// ------------------------------------------------------------------ names

/**
 * A display name reduced to something an email may carry: its first word, letters (and an inner
 * apostrophe or hyphen) only, at most 20 characters. Anything else (a URL, a sentence, digits) is no
 * name at all. Display names are typed by users; this is the narrow form that cannot carry a link
 * or a message to whoever reads the email (src/lib/email/templates.ts, "What may be interpolated").
 */
export function safeFirstName(name: string | null | undefined): string | null {
  const first = (name ?? "").trim().split(/\s+/)[0] ?? "";
  if (!/^\p{L}(?:[\p{L}\p{M}]|['’-](?=\p{L}))*$/u.test(first) || [...first].length > 20) return null;
  return first;
}

/** A skill id's name for a grown-up ("Times tables"), or null for an unknown one or "other". */
export function skillTitle(id: string): string | null {
  if (isK8SkillId(id)) return K8_SKILLS[id].name;
  if (id === "other") return null;
  return skillDef(id)?.name ?? null;
}

// ------------------------------------------------------------------ the numbers

/** `at`'s calendar date in `timeZone`, YYYY-MM-DD. */
export function localDayIn(at: Date, timeZone: string = EMAIL_TIME_ZONE): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(at);
}

function previousDay(day: string): string {
  const t = Date.parse(`${day}T00:00:00Z`);
  return new Date(t - DAY_MS).toISOString().slice(0, 10);
}

/** Days of Today's practice completed in a row, ending `today` or the day before (a day not over yet does not break it). */
export function practiceStreak(practice: readonly LearnerPractice[], today: string): number {
  const done = new Set(practice.filter((p) => p.completedAt !== null || p.done >= p.goal).map((p) => p.day));
  let day = done.has(today) ? today : previousDay(today);
  let streak = 0;
  while (done.has(day) && streak < 366) {
    streak++;
    day = previousDay(day);
  }
  return streak;
}

/** One learner's numbers since `since`. */
export function summarizeLearner(learner: LearnerActivity, since: Date, now: Date): LearnerProgress {
  const from = since.getTime();
  const fromDay = localDayIn(since);
  const attempts = learner.attempts.filter((a) => Date.parse(a.startedAt) >= from);
  const solved = attempts.filter((a) => SOLVED_OUTCOMES.includes(a.outcome));
  const counts = new Map<string, number>();
  for (const a of attempts) {
    const title = skillTitle(a.skill);
    if (title) counts.set(title, (counts.get(title) ?? 0) + 1);
  }
  const skills = [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([name]) => name);
  const practiceDays = new Set(learner.practice.filter((p) => p.day >= fromDay && (p.completedAt !== null || p.done >= p.goal)).map((p) => p.day)).size;
  return {
    name: safeFirstName(learner.displayName),
    tried: attempts.length,
    solved: solved.length,
    alone: solved.filter((a) => ALONE_OUTCOMES.includes(a.outcome)).length,
    skills,
    streak: practiceStreak(learner.practice, localDayIn(now)),
    practiceDays,
  };
}

/** Who the emails name: the kids when the account has any, else the account itself. */
export function shownLearners(activity: FamilyActivity): LearnerActivity[] {
  const kids = activity.learners.filter((l) => l.isKid);
  return kids.length ? kids : activity.learners.filter((l) => !l.isKid).slice(0, 1);
}

/**
 * Whose work the summaries count: the shown learners, then the account itself when it has kids
 * (its own work is shown when there is any, like everyone's; `practicedSinceOnboarding` counts it).
 */
function progressLearners(activity: FamilyActivity): LearnerActivity[] {
  const shown = shownLearners(activity);
  const account = activity.learners.filter((l) => !l.isKid).slice(0, 1);
  return [...shown, ...account.filter((a) => !shown.includes(a))];
}

/** Did something: a problem tried, or a day of Today's practice started. */
export function hasProgress(p: LearnerProgress): boolean {
  return progressLines(p).length > 0;
}

/**
 * The family's progress since `since`: one entry per learner who did something, the kids first and
 * then the account's own work when it has any; [] when nobody did.
 */
export function familyProgress(activity: FamilyActivity, since: Date, now: Date): LearnerProgress[] {
  return progressLearners(activity)
    .map((l) => summarizeLearner(l, since, now))
    .filter(hasProgress);
}

/**
 * Whether anyone in the family (the kids or the account itself, as `familyProgress` counts) has
 * practiced since they finished the welcome: a day of Today's practice, or a problem started after
 * onboarding (one started during the welcome's guided board does not count). Without an
 * onboarding time, any problem counts.
 */
export function practicedSinceOnboarding(activity: FamilyActivity): boolean {
  return progressLearners(activity).some((l) => {
    if (l.practice.some((p) => p.done > 0 || p.completedAt !== null)) return true;
    const after = l.onboardedAt ? Date.parse(l.onboardedAt) : NaN;
    return l.attempts.some((a) => !Number.isFinite(after) || Date.parse(a.startedAt) > after);
  });
}

/** The first names the emails can use for the shown learners (none that are not safe). */
export function learnerNames(activity: FamilyActivity): string[] {
  return shownLearners(activity)
    .map((l) => safeFirstName(l.displayName))
    .filter((n): n is string => n !== null);
}

// ------------------------------------------------------------------ the reader

type Db = Pick<SupabaseClient, "from">;

const str = (v: unknown): string | null => (typeof v === "string" && v ? v : null);
const num = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) ? v : 0);

/**
 * A family's activity since `since` (attempts) and over the last PRACTICE_LOOKBACK_DAYS days
 * (Today's practice), through the service role: the account, its kids, their names and onboarding,
 * newest attempts first up to ATTEMPT_READ_CAP. `{ error }` when the account or its attempts cannot
 * be read; Today's practice that cannot be read counts as none (the table is newer than the rest).
 * Never throws.
 */
export async function readFamilyActivity(db: Db, userId: string, since: Date, now: Date = new Date()): Promise<FamilyActivity | { error: string }> {
  try {
    const kids = await db.from("family_members").select("child_id,created_at").eq("parent_id", userId).order("created_at", { ascending: true });
    if (kids.error) return { error: `family_members: ${kids.error.message}` };
    const kidIds = ((kids.data ?? []) as Array<{ child_id?: unknown }>).map((k) => str(k.child_id)).filter((id): id is string => id !== null);
    const ids = [userId, ...kidIds];
    const fromDay = localDayIn(new Date(now.getTime() - PRACTICE_LOOKBACK_DAYS * DAY_MS));

    const [profiles, attempts, practice] = await Promise.all([
      db.from("profiles").select("user_id,display_name,onboarded_at").in("user_id", ids),
      db
        .from("learning_attempts")
        .select("user_id,skill,outcome,started_at")
        .in("user_id", ids)
        .gte("started_at", since.toISOString())
        .order("started_at", { ascending: false })
        .limit(ATTEMPT_READ_CAP),
      db.from("daily_practice").select("user_id,day,done,goal,completed_at").in("user_id", ids).gte("day", fromDay).limit(PRACTICE_READ_CAP),
    ]);
    if (profiles.error) return { error: `profiles: ${profiles.error.message}` };
    if (attempts.error) return { error: `learning_attempts: ${attempts.error.message}` };

    const profileOf = new Map<string, { display_name?: unknown; onboarded_at?: unknown }>();
    for (const p of (profiles.data ?? []) as Array<{ user_id?: unknown; display_name?: unknown; onboarded_at?: unknown }>) {
      const id = str(p.user_id);
      if (id) profileOf.set(id, p);
    }
    const learners: LearnerActivity[] = ids.map((id) => ({
      userId: id,
      displayName: str(profileOf.get(id)?.display_name),
      isKid: id !== userId,
      onboardedAt: str(profileOf.get(id)?.onboarded_at),
      attempts: [],
      practice: [],
    }));
    const byId = new Map(learners.map((l) => [l.userId, l]));
    for (const a of (attempts.data ?? []) as Array<Record<string, unknown>>) {
      const l = byId.get(str(a.user_id) ?? "");
      const startedAt = str(a.started_at);
      if (l && startedAt) l.attempts.push({ skill: str(a.skill) ?? "other", outcome: str(a.outcome) ?? "in_progress", startedAt });
    }
    if (!practice.error) {
      for (const p of (practice.data ?? []) as Array<Record<string, unknown>>) {
        const l = byId.get(str(p.user_id) ?? "");
        const day = str(p.day);
        if (l && day) l.practice.push({ day, done: num(p.done), goal: num(p.goal) || 5, completedAt: str(p.completed_at) });
      }
    }
    return { learners };
  } catch (err) {
    return { error: err instanceof Error ? err.message : String(err) };
  }
}
