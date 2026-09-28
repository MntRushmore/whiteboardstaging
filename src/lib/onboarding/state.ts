/**
 * Pure state of the first-run onboarding: who sees the welcome, what the boards home shows while
 * that is being decided, and the guided board's coach marks as a small state machine. No React,
 * no storage, no network — the components (`src/components/onboarding/**`) drive these.
 */
import type { CourseId } from "./courseIds";
import type { TourMarkerStep } from "./marker";

// ---------------------------------------------------------------- the welcome

/** The onboarding fields of `profiles` (migration 20260928100000_onboarding.sql). */
export interface OnboardingProfile {
  course: CourseId | null;
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

// ---------------------------------------------------------------- the guided board

/**
 * - `problem`: the tutor is writing the starter problem;
 * - `write`: coach mark 1, "write the next step" — waits for a tick or a ring;
 * - `result`: coach mark 1 again, saying what the mark means;
 * - `modes`: coach mark 2, the help tabs;
 * - `ask`: coach mark 3, the Ask button;
 * - `done`: finished or skipped (completion is stored once, on entering it).
 */
export type TourStep = "problem" | "write" | "result" | "modes" | "ask" | "done";
export type MarkKind = "check" | "circle" | "question";

export interface TourState {
  step: TourStep;
  /** what the tutor put on the student's line, once it did */
  outcome: "tick" | "ring" | null;
  /** the tutor could not read the student's last line (a question mark) */
  unread: boolean;
  /** true when `done` came from Skip / Close rather than the last Next */
  skipped: boolean;
}

export type TourEvent =
  | { type: "problemReady" }
  | { type: "mark"; mark: MarkKind }
  | { type: "next" }
  | { type: "askOpened" }
  | { type: "skip" };

export function initialTour(step: TourMarkerStep = "problem"): TourState {
  return { step, outcome: null, unread: false, skipped: false };
}

export function tourReducer(state: TourState, event: TourEvent): TourState {
  if (state.step === "done") return state;
  if (event.type === "skip") return { ...state, step: "done", skipped: true };
  switch (state.step) {
    case "problem":
      return event.type === "problemReady" || event.type === "next" ? { ...state, step: "write" } : state;
    case "write":
    case "result":
      if (event.type === "mark") {
        if (event.mark === "question") return state.step === "write" ? { ...state, unread: true } : state;
        return { ...state, step: "result", outcome: event.mark === "check" ? "tick" : "ring", unread: false };
      }
      return event.type === "next" ? { ...state, step: "modes" } : state;
    case "modes":
      return event.type === "next" ? { ...state, step: "ask" } : state;
    case "ask":
      return event.type === "next" || event.type === "askOpened" ? { ...state, step: "done" } : state;
  }
}

/** The step to remember on this device, so a reload resumes the tour where it was. */
export function markerStepOf(step: TourStep): TourMarkerStep | null {
  switch (step) {
    case "problem":
    case "write":
    case "modes":
    case "ask":
      return step;
    case "result":
      return "modes";
    case "done":
      return null;
  }
}

/** "1 of 3" for the coach marks; null while the problem is being written and once done. */
export function coachNumber(step: TourStep): 1 | 2 | 3 | null {
  switch (step) {
    case "write":
    case "result":
      return 1;
    case "modes":
      return 2;
    case "ask":
      return 3;
    default:
      return null;
  }
}

export const COACH_COUNT = 3;

/**
 * The tutor's mark on a shape, from its meta (`meta.mark = "check:<x>,<y>,<w>,<h>"`, written by
 * `LiveLoop.syncMark` on the tutor's own ink): null for anything else.
 */
export function markKindOf(meta: unknown): MarkKind | null {
  if (!meta || typeof meta !== "object") return null;
  const m = meta as Record<string, unknown>;
  if (m.live !== true || m.source !== "ai" || typeof m.mark !== "string") return null;
  const kind = m.mark.split(":")[0];
  return kind === "check" || kind === "circle" || kind === "question" ? kind : null;
}
