/**
 * Pure state of the first-run welcome: who sees it, and what the boards home shows while that is
 * being decided. No React, no storage, no network — the components (`src/components/onboarding/**`)
 * drive these. The guided board's coach marks are `tour.ts` (only the tour's lazy chunk loads them).
 */
import type { Grade } from "@/lib/learning/grades";
import type { CourseId } from "./courseIds";

// ---------------------------------------------------------------- the welcome

/**
 * The onboarding fields of `profiles` (migrations 20260928100000_onboarding.sql and
 * 20261009000000_kids_come_back.sql). A student in Kindergarten to 8th grade has a `grade` and the
 * course "other"; a high-school student has a course and no grade.
 */
export interface OnboardingProfile {
  course: CourseId | null;
  /** 0..8 (0 is Kindergarten), or null: a high-school course, or not chosen */
  grade: Grade | null;
  onboarded_at: string | null;
}

/**
 * - `checking`: not known yet (the home keeps its skeleton rather than flash the empty state);
 * - `show`: a student who has not finished onboarding and has no boards;
 * - `hide`: everyone else — including whenever the answer is unavailable (a failed read, no
 *   profile, a database without the migration): nobody is ever held at the welcome by an error.
 */
export type WelcomeDecision = "checking" | "show" | "hide";

export interface WelcomeInput {
  /** the board list: still loading, failed, or how many boards the student has */
  boards: "loading" | "error" | number;
  /** the profile read: still loading, failed/unavailable, or the row (null: no row) */
  profile: "loading" | "error" | OnboardingProfile | null;
  /** this device already recorded the welcome or tour as done (`marker.ts`) */
  localDone: boolean;
}

export function welcomeDecision({ boards, profile, localDone }: WelcomeInput): WelcomeDecision {
  if (localDone) return "hide";
  if (boards === "loading") return "checking";
  if (boards === "error" || boards > 0) return "hide";
  if (profile === "loading") return "checking";
  if (profile === "error" || profile === null) return "hide";
  return profile.onboarded_at ? "hide" : "show";
}

/** Whether the home needs the profile at all: only a student with no boards might see the welcome. */
export function needsProfile({ boards, localDone }: Pick<WelcomeInput, "boards" | "localDone">): boolean {
  return !localDone && boards === 0;
}

export type HomeState = "loading" | "error" | "empty" | "list";
export type HomeView = HomeState | "welcome";

/** The dashboard's own state (`dashboardStateFor`) with the welcome folded in. */
export function homeView(state: HomeState, welcome: WelcomeDecision): HomeView {
  if (state !== "empty") return state;
  if (welcome === "checking") return "loading";
  return welcome === "show" ? "welcome" : "empty";
}
