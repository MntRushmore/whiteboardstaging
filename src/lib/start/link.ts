/**
 * The answers as a link: "Send it to my grown-up" (a kid alone on the account screen) shares
 * `${origin}/start#a=<base64url(JSON of the answers)>`, and /start opened from it starts where the
 * kid left off (`answersFromHash`). The answers ride in the fragment, which the browser never sends
 * to a server, so the kid's first name never reaches a request log. The same check reads the
 * answers back from the device (`pending.ts`).
 *
 * Only the answers ever go in: who, the kid's first name, the grade or course, the skills picked,
 * what happened on the try board, and where they heard of us. Never an email, never an id. On the
 * way back in, anything wrong is dropped rather than refused (`StartAnswersSchema`): an old link, a
 * hand-edited one, a skill that no longer exists.
 *
 * Pure: no React, no storage, no network. Tested in `__tests__/link.test.ts`.
 */
import { isHeardFrom } from "@/lib/funnel/contracts";
import { isSkillId } from "@/lib/learning/contracts";
import { isGrade, type PathSkillId } from "@/lib/learning/grades";
import { isCourseId } from "@/lib/onboarding/courseIds";
import type { WelcomeChoice } from "@/lib/onboarding/choice";
import { EMPTY_ANSWERS, MAX_FOCUS, START_ANSWERS_PARAM, START_PATH, StartAnswersSchema, type StartAnswers } from "./contracts";

/**
 * The longest `#a=` value read. A real one is a few hundred characters (a 24-letter name, three
 * skills); anything longer is not ours, and is not parsed.
 */
export const MAX_START_ANSWERS_PARAM = 1024;

/**
 * The answers as they may be trusted: each field checked (`StartAnswersSchema`, then the ids
 * themselves: a course, a grade, a skill, a source), unknown fields dropped, the skills deduplicated.
 * Null when `raw` is not an object at all.
 */
export function cleanStartAnswers(raw: unknown): StartAnswers | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const parsed = StartAnswersSchema.safeParse(raw);
  if (!parsed.success) return null;
  const v = parsed.data;
  let choice: WelcomeChoice | null = null;
  if (v.choice?.kind === "grade" && isGrade(v.choice.grade)) choice = { kind: "grade", grade: v.choice.grade };
  else if (v.choice?.kind === "course" && isCourseId(v.choice.course)) choice = { kind: "course", course: v.choice.course };
  const focus = [...new Set(v.focus.filter((id): id is PathSkillId => isSkillId(id)))].slice(0, MAX_FOCUS);
  return {
    role: v.role,
    name: v.name ? v.name.trim() : null,
    choice,
    focus,
    tried: v.tried ? { checked: v.tried.checked, solved: v.tried.solved } : null,
    heardFrom: isHeardFrom(v.heardFrom) ? v.heardFrom : null,
  };
}

function toBase64Url(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromBase64Url(value: string): string | null {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) return null;
  try {
    const padded = value.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((value.length + 3) % 4);
    const binary = atob(padded);
    const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0));
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return null;
  }
}

/** The answers as the link's `?a=` value: the checked answers (nothing else) as base64url JSON. */
export function encodeStartAnswers(answers: StartAnswers): string {
  const a = cleanStartAnswers(answers) ?? EMPTY_ANSWERS;
  // spelled out, so only these six fields can ever be in a link, in this order
  const out = { role: a.role, name: a.name, choice: a.choice, focus: a.focus, tried: a.tried, heardFrom: a.heardFrom };
  return toBase64Url(JSON.stringify(out));
}

/** The answers a `?a=` value carries, checked; null for anything that is not one (junk, too long). */
export function decodeStartAnswers(param: string | null | undefined): StartAnswers | null {
  if (typeof param !== "string" || !param || param.length > MAX_START_ANSWERS_PARAM) return null;
  const json = fromBase64Url(param);
  if (json === null) return null;
  try {
    return cleanStartAnswers(JSON.parse(json));
  } catch {
    return null;
  }
}

/** "https://www.agathon.app/start#a=…": the link a kid sends their grown-up. */
export function startAnswersLink(origin: string, answers: StartAnswers): string {
  return `${origin.replace(/\/+$/, "")}${START_PATH}#${START_ANSWERS_PARAM}=${encodeStartAnswers(answers)}`;
}

/** The answers a grown-up's link carries, from `location.hash` ("#a=…"); null when it carries none. */
export function answersFromHash(hash: string | null | undefined): StartAnswers | null {
  if (typeof hash !== "string" || !hash.startsWith("#")) return null;
  return decodeStartAnswers(new URLSearchParams(hash.slice(1)).get(START_ANSWERS_PARAM));
}
