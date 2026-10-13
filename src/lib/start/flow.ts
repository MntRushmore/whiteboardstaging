/**
 * The flow of /start (docs/START-FLOW.md): which screen comes next, what each answer changes, where
 * a family that comes back picks up, and every word the screens say, for the grown-up and for the
 * kid alone. `StartFlow` (src/components/start) renders it.
 *
 * - The screens are the contract's (`startSteps`), less `focus` when the grade or course offers no
 *   skills ("Something else").
 * - The device keeps the flow in localStorage under `START_STORAGE_KEY` (the `flow` field; the
 *   journey id beside it is `record.ts`'s), for a week, so a closed tab opens where it was.
 * - A grown-up's link (`#a=…`, `link.ts`) opens on the plan, worded for the grown-up.
 *
 * Pure: no React, no network; storage is passed in.
 */
import { gradeLabel, type PathSkillId } from "@/lib/learning/grades";
import type { WelcomeChoice } from "@/lib/onboarding/choice";
import { COURSES } from "@/lib/onboarding/courses";
import { EMPTY_ANSWERS, KID_NAME, MAX_FOCUS, START_STEPS, START_STORAGE_KEY, startSteps, type StartAnswers, type StartRole, type StartStep } from "./contracts";
import { cleanStartAnswers } from "./link";
import { focusOptions } from "./plan";

// ------------------------------------------------------------------ the screens

export interface FlowState {
  step: StartStep;
  answers: StartAnswers;
  /** opened from a kid's "Send it to my grown-up" link: the grown-up is here */
  fromLink: boolean;
}

export const FIRST_STEP: StartStep = "who";
export const INITIAL_FLOW: FlowState = { step: FIRST_STEP, answers: EMPTY_ANSWERS, fromLink: false };

/** The screens this family sees, in order. */
export function flowSteps(answers: Pick<StartAnswers, "role" | "choice">): StartStep[] {
  const offers = focusOptions(answers.choice).length > 0;
  return startSteps(answers.role).filter((s) => s !== "focus" || offers || !answers.choice);
}

/** The screen after `step`, or null after the last. */
export function nextStep(state: Pick<FlowState, "step" | "answers">): StartStep | null {
  const steps = flowSteps(state.answers);
  const at = steps.indexOf(state.step);
  return at >= 0 && at < steps.length - 1 ? steps[at + 1] : null;
}

/**
 * The screen Back goes to, or null on the first. `building` is a beat, not a place: Back from the
 * plan goes past it.
 */
export function previousStep(state: Pick<FlowState, "step" | "answers" | "fromLink">): StartStep | null {
  if (state.fromLink && state.step === "plan") return null;
  const steps = flowSteps(state.answers);
  let at = steps.indexOf(state.step) - 1;
  while (at >= 0 && steps[at] === "building") at -= 1;
  return at >= 0 ? steps[at] : null;
}

/** The progress bar, 0 to 1: a sliver on the first screen, full on the account. */
export function flowProgress(state: Pick<FlowState, "step" | "answers">): number {
  // before "who" is answered, count the longer (parent's) list, so the bar never jumps back
  const steps = state.answers.role ? flowSteps(state.answers) : flowSteps({ ...state.answers, role: "parent" });
  const at = Math.max(0, steps.indexOf(state.step));
  return Math.min(1, (at + 1) / steps.length);
}

/** The screens with a Skip: the answer is optional, or the screen is a look. */
export const SKIPPABLE: ReadonlySet<StartStep> = new Set<StartStep>(["name", "focus", "proof", "try"]);

/** True when the screen's answers are all there (a screen that needs nothing is always ready). */
function answered(step: StartStep, a: StartAnswers): boolean {
  switch (step) {
    case "who":
      return true;
    case "name":
    case "grade":
      return a.role !== null;
    default:
      return a.role !== null && a.choice !== null;
  }
}

/**
 * Where a flow kept on the device opens: its screen, or the first one whose earlier answers are
 * missing. The beat (`building`) reopens on the plan; the account reopens on the plan too (the
 * family sees what it is saving).
 */
export function resumeStep(answers: StartAnswers, step: StartStep): StartStep {
  const steps = flowSteps(answers);
  const wanted = step === "building" || step === "account" ? "plan" : step;
  let at = steps.indexOf(wanted);
  if (at < 0) at = 0;
  for (let i = 0; i <= at; i += 1) if (!answered(steps[i], answers)) return steps[Math.max(0, i - 1)] ?? FIRST_STEP;
  return steps[at];
}

// ------------------------------------------------------------------ the answers

export function chooseRole(answers: StartAnswers, role: StartRole): StartAnswers {
  return { ...answers, role };
}

/** A typed first name: trimmed and inner spaces closed up; "" when empty; null when not a first name. */
export function cleanName(raw: string): string | null {
  const name = raw.trim().replace(/\s+/g, " ");
  if (!name) return "";
  return KID_NAME.test(name) ? name : null;
}

export function chooseName(answers: StartAnswers, name: string | null): StartAnswers {
  return { ...answers, name: name ? name : null };
}

/** A new grade or course keeps only the picks it still offers. */
export function chooseLevel(answers: StartAnswers, choice: WelcomeChoice): StartAnswers {
  const offered = new Set<string>(focusOptions(choice));
  return { ...answers, choice, focus: answers.focus.filter((s) => offered.has(s)) };
}

/** Tap a skill on `focus`: on, or off; at most `MAX_FOCUS`, in the order picked. */
export function toggleFocus(answers: StartAnswers, skill: PathSkillId): StartAnswers {
  if (answers.focus.includes(skill)) return { ...answers, focus: answers.focus.filter((s) => s !== skill) };
  if (answers.focus.length >= MAX_FOCUS) return answers;
  return { ...answers, focus: [...answers.focus, skill] };
}

export function notSure(answers: StartAnswers): StartAnswers {
  return { ...answers, focus: [] };
}

/** What happened on the try board; merged upward (a solved try stays solved). */
export function chooseTried(answers: StartAnswers, tried: { checked: boolean; solved: boolean }): StartAnswers {
  const was = answers.tried;
  return { ...answers, tried: { checked: tried.checked || !!was?.checked, solved: tried.solved || !!was?.solved } };
}

// ------------------------------------------------------------------ kept on the device

export type FlowStorage = Pick<Storage, "getItem" | "setItem">;

/** A flow kept longer than this starts over. */
export const FLOW_TTL_MS = 7 * 24 * 60 * 60_000;

interface KeptFlow {
  step: StartStep;
  answers: unknown;
  savedAt: number;
}

function readObject(storage: FlowStorage | null): Record<string, unknown> {
  try {
    const raw = storage?.getItem(START_STORAGE_KEY);
    const value: unknown = raw ? JSON.parse(raw) : null;
    return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

/** Keep the flow (beside the journey id `record.ts` keeps in the same object). */
export function keepFlow(storage: FlowStorage | null, state: Pick<FlowState, "step" | "answers">, now: number): void {
  if (!storage) return;
  try {
    const flow: KeptFlow = { step: state.step, answers: state.answers, savedAt: now };
    storage.setItem(START_STORAGE_KEY, JSON.stringify({ ...readObject(storage), flow }));
  } catch {
    // private mode: the flow lasts this page
  }
}

/** Forget the flow (the account exists); the journey id stays for `record.ts`. */
export function forgetFlow(storage: FlowStorage | null): void {
  if (!storage) return;
  try {
    const rest = readObject(storage);
    delete rest.flow;
    storage.setItem(START_STORAGE_KEY, JSON.stringify(rest));
  } catch {
    // nothing to forget
  }
}

/** The flow this device kept, checked, and where it reopens; null when there is none (or it is old). */
export function readKeptFlow(storage: FlowStorage | null, now: number): { step: StartStep; answers: StartAnswers } | null {
  const kept = readObject(storage).flow as Partial<KeptFlow> | undefined;
  if (!kept || typeof kept !== "object" || typeof kept.savedAt !== "number") return null;
  if (now - kept.savedAt > FLOW_TTL_MS || kept.savedAt - now > FLOW_TTL_MS) return null;
  const answers = cleanStartAnswers(kept.answers);
  if (!answers || !answers.role) return null;
  const step = (START_STEPS as readonly string[]).includes(kept.step as string) ? (kept.step as StartStep) : FIRST_STEP;
  return { step: resumeStep(answers, step), answers };
}

// ------------------------------------------------------------------ the words

/** "Sam’s" */
export function possessive(name: string): string {
  return `${name}’s`;
}

/** "3rd grade", "Algebra 1"; null with no answer. */
export function levelLabel(choice: WelcomeChoice | null): string | null {
  if (!choice) return null;
  return choice.kind === "grade" ? gradeLabel(choice.grade) : (COURSES.find((c) => c.id === choice.course)?.label ?? null);
}

/**
 * Every word on the screens before the account, for whoever is there: the grown-up (with or without
 * the kid's name) or the kid alone. Short, plain, US English; a kid of five to ten reads the kid's.
 */
export function flowCopy(a: Pick<StartAnswers, "role" | "name" | "choice">, fromLink = false) {
  const kid = a.role === "kid" && !fromLink;
  const name = a.name;
  const level = levelLabel(a.choice);
  const their = kid ? "your" : name ? possessive(name) : "your kid’s";
  return {
    bar: { back: "Back", skip: "Skip", progress: "Your progress", signIn: "Sign in" },
    who: {
      title: "Who’s getting started?",
      lede: "A few quick questions, then your math plan.",
      parent: { small: "I’m a", big: "parent", hint: "or another grown-up" },
      kid: { small: "I’m a", big: "kid", hint: "here to practice" },
      haveAccount: "Already have an account?",
      signIn: "Sign in",
    },
    name: {
      title: kid ? "What’s your first name?" : "What’s your kid’s first name?",
      lede: kid ? "It goes at the top of your plan." : "It goes at the top of their plan.",
      label: "First name",
      placeholder: kid ? "Your first name" : "Their first name",
      invalid: "Use letters only, like Sam or Mary-Kate.",
      next: "Continue",
    },
    grade: {
      title: kid ? "What grade are you in?" : name ? `What grade is ${name} in?` : "What grade is your kid in?",
      lede: kid ? "So every problem is just right for you." : "The tutor picks problems for that grade.",
      highSchool: "High school",
      highSchoolHint: "Algebra, geometry and up",
      courseTitle: kid ? "Which class are you taking?" : name ? `Which class is ${name} taking?` : "Which class are they taking?",
      courseLede: "Pick the one closest to it.",
      backToGrades: "Back to grades",
    },
    focus: {
      title: kid ? "What’s tricky for you right now?" : name ? `What’s tricky for ${name} right now?` : "What’s tricky right now?",
      lede: kid ? "Pick up to 3. Your plan starts there." : `Pick up to 3. ${capitalize(their)} plan starts there.`,
      notSure: "Not sure yet",
      notSureHint: level ? `Start at the beginning of ${a.choice?.kind === "grade" ? `the ${level} path` : level}` : "Start at the beginning",
      full: "That’s 3. Tap one again to swap it out.",
      next: "Continue",
      picked: (n: number) => (n === 0 ? "Pick up to 3" : `${n} picked`),
    },
    proof: {
      title: name ? `${name} does the math. You see how it’s going.` : "They do the math. You see how it’s going.",
      lede: name ? `Progress shows ${possessive(name)} path, and how many problems ${name} solved without help.` : "Progress shows their path, and how many problems they solved without help.",
      next: "Sounds good",
      caption: "A 3rd grader’s Progress page, from the app.",
      alt: "Agathon’s Progress page: a 3rd grade path with 2 of 4 skills mastered, and this week’s 47 minutes of practice, 31 problems worked on, 28 solved on their own and 2 days of math in a row.",
    },
    try: {
      title: kid ? "Your turn. Try one!" : name ? `Try one, or hand it to ${name}.` : "Try one, or hand it over.",
      lede: (answer: boolean) => (answer ? "Write the answer under the problem. The tutor checks it." : "Write the next step under the problem. The tutor checks it."),
      next: "Continue",
      later: "Maybe later",
    },
    building: {
      title: kid ? "Making your plan…" : name ? `Making ${possessive(name)} plan…` : "Making the plan…",
      level: level ? `${level} problems` : "Problems for every level",
      start: (skill: string | null) => (skill ? `Starting with ${skill}` : "Starting with the basics"),
      board: "A first board, ready to write on",
    },
    plan: {
      title: fromLink ? (name ? `${name} made a math plan` : "Your kid made a math plan") : kid ? "Your plan is ready" : name ? `${possessive(name)} plan is ready` : "The plan is ready",
      lede: fromLink
        ? name
          ? `Save it so ${name} can start practicing.`
          : "Save it so they can start practicing."
        : kid
          ? "Made from your answers. Save it to start."
          : name
            ? `Made from your answers, for ${name}. Save it to start.`
            : "Made from your answers. Save it to start.",
      whose: kid ? "Your plan" : name ? possessive(name) + " plan" : "The plan",
      startHere: "Start here",
      next: "Next",
      then: "Then",
      firstBoardNote: (skill: string) =>
        kid
          ? `Your first board starts with ${skill}, ready to write on. The tutor checks each line.`
          : name
            ? `${possessive(name)} first board starts with ${skill}, ready to write on. The tutor checks each line.`
            : `The first board starts with ${skill}, ready to write on. The tutor checks each line.`,
      free: "Free to save. No card needed.",
      open: "The tutor starts with a few problems to see where things are, then picks what comes next.",
      tried: (solved: boolean) => (solved ? "Solved one already" : "Tried one already"),
      save: kid ? "Save my plan" : name ? `Save ${possessive(name)} plan` : "Save the plan",
    },
  };
}

export type FlowCopy = ReturnType<typeof flowCopy>;

function capitalize(s: string): string {
  return s ? s[0].toUpperCase() + s.slice(1) : s;
}
