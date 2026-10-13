/**
 * What /start saves once the account exists (docs/START-FLOW.md, "After the account"): run right
 * after a sign-up that came back with a session, or on the first signed-in page after one that did
 * not (or after "Already have an account? Sign in": `resume.ts`).
 *
 * 1. This device first, before any request, so nothing in between can show the old onboarding: the
 *    welcome is done (`writeLocalDone`), no guided-board tour marker is ever written (the three tips
 *    show only on a board that has one), and the plan screen is due (`writePlanMarker` "pending",
 *    the home's `planDue`) unless it already showed.
 * 2. The answers, as the student (their JWT; RLS and the RPC act on auth.uid()):
 *    - `save_onboarding` v2: the grade or course (`choiceSave`), where they heard of us, and
 *      onboarding done (`onboarded_at`, stamped once);
 *    - then the kid's first name as `profiles.display_name`, only while the profile has none: an
 *      `update … where display_name is null` through the owner-update policy and the column grant
 *      (display_name is the one column a user may update; it is how /account's ProfileCard saves it).
 * 3. The first board, on the plan's first skill: the first of the skills picked on `focus` that has
 *    practice problems, else the first of the grade's path (`GRADE_PATHS`), else the grade's or
 *    course's starters (`startersFor`). It is made the way Progress's Practice makes one
 *    (`createFirstBoard`, "Practice: <skill>", the problems left in the device's practice marker),
 *    so it opens with real problems in the tutor's hand. A board that fails is not fatal.
 * 4. The welcome email, once onboarding is saved (the server sends it once).
 *
 * Idempotent: the RPC keeps the first `onboarded_at` and `heard_from`, the name is written only
 * over none, and the board is made once per account on this device (`agathon.start.finished.<id>`
 * remembers it; two calls at once share one run). Never throws: what failed is in `failed`, and
 * `next` is always the plan screen.
 *
 * The client is structural (only the calls used here), so the tests pass a fake.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { skillDef, type SkillId } from "@/lib/learning/contracts";
import { GRADE_PATHS, type PathSkillId } from "@/lib/learning/grades";
import { writePracticeMarker } from "@/lib/learning/practiceMarker";
import { choiceSave } from "@/lib/onboarding/choice";
import { COURSES, starterBoardTitle, starterIndex, startersFor } from "@/lib/onboarding/courses";
import { browserStorage, writeLocalDone, type StorageLike } from "@/lib/onboarding/marker";
import { PLAN_PATH, readPlanMarker, writePlanMarker } from "@/lib/onboarding/planMarker";
import { createFirstBoard, saveOnboarding, type OnboardingClient } from "@/lib/onboarding/storage";
import { KID_NAME, type StartAnswers } from "./contracts";

interface QueryResult<T> {
  data: T | null;
  error: { message?: string; code?: string } | null;
}

/** `OnboardingClient` and the one update this needs: `profiles.display_name` over none. */
export interface StartClient extends OnboardingClient {
  from(table: string): ReturnType<OnboardingClient["from"]> & {
    update(values: Record<string, unknown>): {
      eq(column: string, value: string): {
        is(column: string, value: null): { select(columns: string): PromiseLike<QueryResult<Record<string, unknown>[]>> };
      };
    };
  };
}

/** The real `SupabaseClient` as a {@link StartClient} (one cast, as `asOnboardingClient`, for TS2589). */
export function asStartClient(client: Pick<SupabaseClient, "from" | "rpc">): StartClient {
  return client as unknown as StartClient;
}

/** How many problems the first board starts with (Progress's Practice writes as many). */
export const START_PROBLEMS = 4;
/** The practice marker's skill for a board of starters with no skill of their own (a course's). */
export const START_MARKER_SKILL = "start";
/** The first board's name when nothing better names it (no grade, no course, no skill). */
export const FIRST_BOARD_TITLE = "My first practice";

/** The practice-set pieces the first board needs: loaded only when it is made (`defaultPractice`). */
export interface PracticeKit {
  hasPractice(skill: string): boolean;
  practiceProblems(skill: SkillId, count: number, seed: number): string[][];
  /** "Practice: Times tables" */
  practiceTitle(name: string): string;
}

export interface FinishDeps {
  /** the device's localStorage (markers); null when there is none */
  storage: StorageLike | null;
  now: () => number;
  /** the practice set's seed: a new set each time */
  seed: () => number;
  practice: () => Promise<PracticeKit>;
  /** the welcome email, once onboarding is saved (fire and forget) */
  welcomeEmail: () => void;
}

async function defaultPractice(): Promise<PracticeKit> {
  const [set, view] = await Promise.all([import("@/lib/learning/practiceSet"), import("@/lib/learning/progressView")]);
  return { hasPractice: set.hasPractice, practiceProblems: set.practiceProblems, practiceTitle: view.practiceTitle };
}

function defaultDeps(): FinishDeps {
  return {
    storage: browserStorage(),
    now: Date.now,
    seed: () => Math.floor(Math.random() * 0x7fffffff),
    practice: defaultPractice,
    welcomeEmail: () => {
      void import("@/lib/email/client").then(({ sendWelcomeEmail }) => sendWelcomeEmail()).catch(() => undefined);
    },
  };
}

// ------------------------------------------------------------------ the first board

/** The skills the first board may be on, in order: those picked on `focus`, then the grade's path. */
export function firstSkills(answers: Pick<StartAnswers, "focus" | "choice">): PathSkillId[] {
  const path = answers.choice?.kind === "grade" ? GRADE_PATHS[answers.choice.grade] : [];
  return [...new Set([...answers.focus, ...path])];
}

export interface FirstBoardPlan {
  /** the practice marker's skill: a skill id, or `START_MARKER_SKILL` for a course's starters */
  skill: string;
  title: string;
  problems: string[][];
}

/**
 * What the first board is: the first skill (`firstSkills`) with practice problems, `START_PROBLEMS`
 * of them, named "Practice: <skill>"; with none, the grade's or course's starters (all of them,
 * the student's own first: `starterIndex` by user id, as the old welcome chose). Null when even
 * those are missing.
 */
export function firstBoardPlan(answers: Pick<StartAnswers, "focus" | "choice">, kit: PracticeKit, seed: number, userId: string): FirstBoardPlan | null {
  for (const skill of firstSkills(answers)) {
    if (!kit.hasPractice(skill)) continue;
    const problems = kit.practiceProblems(skill, START_PROBLEMS, seed);
    if (problems.length > 0) return { skill, title: kit.practiceTitle(skillDef(skill)?.name ?? skill), problems: problems.map((p) => [...p]) };
  }
  const { course, grade } = choiceSave(answers.choice);
  const own = course ?? "other";
  const starters = startersFor(own, starterIndex(own, userId, grade), grade);
  if (starters.length === 0) return null;
  const first = starters[0];
  const skillName = starterBoardTitle(first);
  const courseName = own === "other" ? null : (COURSES.find((c) => c.id === own)?.label ?? null);
  const name = skillName ?? courseName;
  return {
    skill: first.skill ?? START_MARKER_SKILL,
    title: name ? kit.practiceTitle(name) : FIRST_BOARD_TITLE,
    problems: starters.map((s) => [...s.lines]),
  };
}

// ------------------------------------------------------------------ the device's note of it

/** `agathon.start.finished.<userId>` = { boardId, createdAt }: the first board was made (once). */
export const finishedKey = (userId: string) => `agathon.start.finished.${userId}`;

export function readStartFinished(storage: StorageLike | null | undefined, userId: string): { boardId: string; createdAt: number } | null {
  try {
    const raw = storage?.getItem(finishedKey(userId));
    if (!raw) return null;
    const v = JSON.parse(raw) as { boardId?: unknown; createdAt?: unknown } | null;
    return v && typeof v.boardId === "string" && v.boardId && typeof v.createdAt === "number" ? { boardId: v.boardId, createdAt: v.createdAt } : null;
  } catch {
    return null;
  }
}

function writeStartFinished(storage: StorageLike | null | undefined, userId: string, boardId: string, now: number): void {
  try {
    storage?.setItem(finishedKey(userId), JSON.stringify({ boardId, createdAt: now }));
  } catch {
    /* private mode: a second run on this device could make a second board */
  }
}

// ------------------------------------------------------------------ the name

export type NameOutcome = "named" | "kept" | "none" | "failed";

/**
 * The kid's first name as the profile's display name, only over none (`is null`, in the same
 * statement): "named"; "kept" when the profile already had one; "none" when there is no name to
 * give (skipped, or not a first name `KID_NAME` accepts).
 */
export async function nameProfile(client: StartClient, userId: string, name: string | null | undefined): Promise<NameOutcome> {
  const clean = typeof name === "string" ? name.trim() : "";
  if (!clean || !KID_NAME.test(clean)) return "none";
  try {
    const { data, error } = await client.from("profiles").update({ display_name: clean }).eq("user_id", userId).is("display_name", null).select("display_name");
    if (error) return "failed";
    return Array.isArray(data) && data.length > 0 ? "named" : "kept";
  } catch {
    return "failed";
  }
}

// ------------------------------------------------------------------ all of it

export type FinishFailure = "save" | "name" | "board" | "marker";

export interface FinishResult {
  /** where to go: the plan screen, always */
  next: typeof PLAN_PATH;
  /** the first board (made now, or by an earlier run on this device); null when it failed */
  boardId: string | null;
  /** save_onboarding answered: onboarding is done on the account */
  saved: boolean;
  name: NameOutcome;
  /** what went wrong, for the metrics (never shown: the plan screen comes next either way) */
  failed: FinishFailure[];
}

type BoardOutcome = { ok: true; boardId: string; marked: boolean } | { ok: false; error: string };

async function makeFirstBoard(client: StartClient, userId: string, answers: StartAnswers, deps: FinishDeps): Promise<BoardOutcome> {
  try {
    const plan = firstBoardPlan(answers, await deps.practice(), deps.seed(), userId);
    if (!plan) return { ok: false, error: "no_problems" };
    const made = await createFirstBoard(client, userId, plan.title);
    if (!made.ok) return { ok: false, error: made.error };
    const now = deps.now();
    writeStartFinished(deps.storage, userId, made.value, now);
    // no storage (private mode): the board opens blank, named for the skill
    const marked = writePracticeMarker({ boardId: made.value, skill: plan.skill, problems: plan.problems, createdAt: now }, deps.storage);
    return { ok: true, boardId: made.value, marked };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

async function finishOnce(client: StartClient, userId: string, answers: StartAnswers, deps: FinishDeps): Promise<FinishResult> {
  const failed: FinishFailure[] = [];
  // 1. this device: the old welcome and the tour never show; the plan screen is next
  writeLocalDone(deps.storage, userId);
  if (readPlanMarker(deps.storage, userId) === null) writePlanMarker(deps.storage, userId, "pending");

  // 2 and 3: the answers (then the name: save_onboarding makes a missing profile row) and the board
  const { course, grade } = choiceSave(answers.choice);
  const earlier = readStartFinished(deps.storage, userId);
  const saving = saveOnboarding(client, { course, grade, heardFrom: answers.heardFrom, complete: true }).then(async (res) => ({
    saved: res.ok,
    name: await nameProfile(client, userId, answers.name),
  }));
  const making: Promise<BoardOutcome> = earlier ? Promise.resolve({ ok: true, boardId: earlier.boardId, marked: true }) : makeFirstBoard(client, userId, answers, deps);
  const [{ saved, name }, board] = await Promise.all([saving, making]);

  if (!saved) failed.push("save");
  if (name === "failed") failed.push("name");
  if (!board.ok) failed.push("board");
  else if (!board.marked) failed.push("marker");

  // 4. the welcome email: the server reads onboarded_at, so only after the save
  if (saved) {
    try {
      deps.welcomeEmail();
    } catch {
      /* a welcome email is not worth an error */
    }
  }
  return { next: PLAN_PATH, boardId: board.ok ? board.boardId : null, saved, name, failed };
}

const running = new Map<string, Promise<FinishResult>>();

/**
 * Save the /start answers to `userId`'s account and make the first board (see the top of this
 * file). Two calls for one account at once share one run. Never throws.
 */
export function finishStart(client: StartClient, userId: string, answers: StartAnswers, deps: Partial<FinishDeps> = {}): Promise<FinishResult> {
  const current = running.get(userId);
  if (current) return current;
  const all = { ...defaultDeps(), ...deps };
  const run = finishOnce(client, userId, answers, all)
    .catch((): FinishResult => ({ next: PLAN_PATH, boardId: null, saved: false, name: "failed", failed: ["save", "name", "board"] }))
    .finally(() => running.delete(userId));
  running.set(userId, run);
  return run;
}
