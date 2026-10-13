/**
 * The new onboarding (2026-10-13): everything a family does BEFORE the account, at /start, one
 * question per screen, then the account, then the plan screen (unchanged) and the board.
 *
 * Why (docs/START-FLOW.md): the account came first and the card a minute later, and most families
 * who left had never seen the tutor check a line. Aristotle's onboarding, studied on 2026-10-13,
 * asks who you are, a few questions, builds "your plan", and only then asks for the account. Ours
 * does the same with less asking and one real moment: the try board (src/lib/try).
 *
 * Shared contract for the build. Pure: no React, no storage, no network.
 *   - the flow's screens and state:   src/lib/start/** and src/components/start/** (agent "flow")
 *   - the account and what it saves:  src/components/start/StartAccount.tsx, src/lib/start/finish.ts (agent "account")
 *   - the anonymous step counts:      src/lib/start/record.ts, /api/start/step, the admin Funnel (agent "measure")
 */
import { z } from "zod";
import { HEARD_FROM, type HeardFrom } from "@/lib/funnel/contracts";
import type { WelcomeChoice } from "@/lib/onboarding/choice";
import type { PathSkillId } from "@/lib/learning/grades";

export const START_PATH = "/start";

// ------------------------------------------------------------------ who, and the screens

/** Who is at the screen: the grown-up setting it up, or the kid on their own. */
export const START_ROLES = ["parent", "kid"] as const;
export type StartRole = (typeof START_ROLES)[number];

/**
 * The screens, in order. `proof` is the parent's only (one screen of what they get: every line,
 * real product pictures, no testimonials); every other screen is both paths', worded for whoever
 * is there ("What grade is Sam in?" / "What grade are you in?").
 *
 * - `who`: Parent or kid
 * - `name`: the kid's first name (optional: Skip keeps it "your kid" / no name)
 * - `grade`: Kindergarten to 8th, or a high-school course (`WelcomeChoice`)
 * - `focus`: up to 3 skills from that grade's path, or "Not sure" (sets the first problems)
 * - `proof`: parent only
 * - `try`: the try board with a problem from that grade (skippable)
 * - `building`: a short beat, "Making Sam's plan…" (the plan IS computed here: `plan.ts`)
 * - `plan`: "Sam's plan is ready": today's practice and the first skills on the path
 * - `account`: save the plan — the grown-up's email and password (a kid alone: "My grown-up is
 *   here" or "Send it to my grown-up", a link that reopens /start with the answers)
 */
export const START_STEPS = ["who", "name", "grade", "focus", "proof", "try", "building", "plan", "account"] as const;
export type StartStep = (typeof START_STEPS)[number];

/** The screens one role sees, in order. */
export function startSteps(role: StartRole | null): readonly StartStep[] {
  return role === "parent" ? START_STEPS : START_STEPS.filter((s) => s !== "proof");
}

// ------------------------------------------------------------------ the answers

/** A first name as a kid types it: letters, spaces, hyphens and apostrophes, at most 24. */
export const KID_NAME = /^[\p{L}][\p{L}\p{M}' -]{0,23}$/u;
export const MAX_FOCUS = 3;

export interface StartAnswers {
  role: StartRole | null;
  /** the kid's first name, trimmed; null when skipped */
  name: string | null;
  choice: WelcomeChoice | null;
  /** the skills picked on `focus`, in the order picked; [] for "Not sure" */
  focus: readonly PathSkillId[];
  /** what happened on the try board; null when skipped */
  tried: { checked: boolean; solved: boolean } | null;
  /** "How did you hear about Agathon?" on the account screen (optional) */
  heardFrom: HeardFrom | null;
}

export const EMPTY_ANSWERS: StartAnswers = { role: null, name: null, choice: null, focus: [], tried: null, heardFrom: null };

/**
 * The answers as the "Send it to my grown-up" link and the device keep them: checked on the way
 * back in, anything wrong dropped rather than refused (an old link, a hand-edited one).
 */
export const StartAnswersSchema = z.object({
  role: z.enum(START_ROLES).nullable().catch(null),
  name: z.string().trim().regex(KID_NAME).nullable().catch(null),
  choice: z
    .union([z.object({ kind: z.literal("grade"), grade: z.number().int().min(0).max(8) }), z.object({ kind: z.literal("course"), course: z.string().max(32) })])
    .nullable()
    .catch(null),
  focus: z.array(z.string().max(48)).max(MAX_FOCUS).catch([]),
  tried: z.object({ checked: z.boolean(), solved: z.boolean() }).nullable().catch(null),
  heardFrom: z
    .string()
    .refine((v) => HEARD_FROM.some((h) => h.id === v))
    .nullable()
    .catch(null),
});

/** The device keeps the flow (answers, the screen, the journey id) in localStorage under this key. */
export const START_STORAGE_KEY = "agathon.start";
/**
 * The "Send it to my grown-up" link carries the answers under this key in its FRAGMENT
 * (`/start#a=<base64url JSON>`), never the query: the fragment is not sent to the server, so the
 * kid's first name stays out of request logs (`link.ts`).
 */
export const START_ANSWERS_PARAM = "a";

// ------------------------------------------------------------------ counting the steps before the account

/**
 * The steps before the account, counted anonymously by journey (a random id the device keeps), so
 * the admin Funnel can show where families stop BEFORE "Signed up". Once the account exists the
 * journey is linked to it (`start_account`), and from there the account's own funnel takes over.
 * No answers are sent except as noted (never the name).
 */
export const START_EVENTS = [
  "start_shown",
  /** meta: { role } */
  "start_who",
  "start_name",
  /** meta: { grade } or { course } */
  "start_grade",
  /** meta: { count } */
  "start_focus",
  "start_proof",
  "start_try_shown",
  /** the tutor checked a line right on the try board; meta: { solved } */
  "start_try_checked",
  "start_plan",
  "start_account_shown",
  /** a kid sent the plan to a grown-up */
  "start_handoff",
  /** the flow was opened from a grown-up link */
  "start_handoff_opened",
  /** the account was created (the journey is linked to it) */
  "start_account",
] as const;
export type StartEvent = (typeof START_EVENTS)[number];

/** POST body of /api/start/step (public, rate limited per visitor). */
export const StartStepRequestSchema = z.object({
  journeyId: z.string().uuid(),
  event: z.enum(START_EVENTS),
  meta: z.record(z.union([z.string().max(40), z.number().finite(), z.boolean(), z.null()])).optional(),
});
export type StartStepRequest = z.infer<typeof StartStepRequestSchema>;
export const START_STEP_API = "/api/start/step";
