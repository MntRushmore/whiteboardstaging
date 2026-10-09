/**
 * The Family page's forms, checked in the browser before anything is sent: the PIN (typed twice, so a
 * slip of the finger cannot lock the grown-up out of their own profile), a kid's name, and the grade
 * picker's options. The server checks the same rules again (src/lib/family/schemas.ts). Pure.
 */
import { hasPlan, isUnlimited, type UnlimitedStatus } from "@/lib/billing/unlimited";
import { GRADES } from "@/lib/learning/grades";
import { MAX_KIDS, NAME_MAX, PIN_PATTERN } from "./contracts";
import { FAMILY_COPY } from "./copy";

/**
 * What stops the grown-up adding a kid right now, the first that applies, or null:
 *  - `plan`: no plan (or a cancelled one). Kids share the grown-up's Agathon Unlimited and have no
 *    ink of their own, so the server refuses a kid without it (409 `plan_required`);
 *  - `active_plan`: a plan that is not giving Unlimited right now (a second trial waiting for its
 *    first charge, a payment to fix, one still being set up): refused the same way;
 *  - `pin`: no PIN yet; `full`: MAX_KIDS already.
 * A plan the page could not read (`known` false) blocks nothing here: the server's answer says it.
 */
export type AddKidBlock = "plan" | "active_plan" | "pin" | "full";

export function addKidBlock(input: { hasPin: boolean; kids: number; plan: { known: boolean; status: UnlimitedStatus } }): AddKidBlock | null {
  if (input.plan.known && !isUnlimited(input.plan)) return hasPlan(input.plan) ? "active_plan" : "plan";
  if (!input.hasPin) return "pin";
  if (input.kids >= MAX_KIDS) return "full";
  return null;
}

/** Why the PIN form cannot be sent yet, or null. */
export function pinFormError(pin: string, confirm: string): string | null {
  if (!PIN_PATTERN.test(pin)) return FAMILY_COPY.pinInvalid;
  if (pin !== confirm) return FAMILY_COPY.pinMismatch;
  return null;
}

/** Keeps only digits, at most 4: what the PIN fields accept as they are typed into. */
export function pinInput(raw: string): string {
  return raw.replace(/\D/g, "").slice(0, 4);
}

/** Why a kid's name cannot be sent yet, or null. */
export function nameError(name: string): string | null {
  const trimmed = name.trim();
  if (!trimmed) return FAMILY_COPY.nameMissing;
  if (trimmed.length > NAME_MAX) return FAMILY_COPY.nameTooLong;
  return null;
}

/** The grade picker: Kindergarten to 8th, then "High school / not sure" (no grade). */
export const NO_GRADE = "none";
export const GRADE_OPTIONS: { value: string; label: string }[] = [...GRADES.map((g) => ({ value: String(g.id), label: g.label })), { value: NO_GRADE, label: FAMILY_COPY.gradeNone }];

export function gradeFromOption(value: string): number | null {
  const n = Number(value);
  return value !== NO_GRADE && Number.isInteger(n) && n >= 0 && n <= 8 ? n : null;
}

export function optionFromGrade(grade: number | null): string {
  return grade === null ? NO_GRADE : String(grade);
}
