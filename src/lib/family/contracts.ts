/**
 * Families (2026-10-09, "kids come back"): a grown-up's account with kid profiles under it. Each kid is
 * a real Supabase user (so boards, the learning record, Progress and RLS work unchanged), made by the
 * server for the grown-up, with no email of their own and no password: an address on
 * KID_EMAIL_DOMAIN that never receives mail. The kids share the grown-up's Agathon Unlimited plan.
 *
 * Shared contract for the K–8 build (docs/KIDS-COME-BACK.md). Tables `families` (the grown-up, and
 * their PIN's hash) and `family_members` (one row per kid) are in
 * supabase/migrations/20261009000000_kids_come_back.sql; every write goes through the
 * /api/family routes with the service role.
 *
 * Rules every module keeps:
 *  - Nothing ever emails a kid address (`isKidEmail`): the welcome, nudges, reminders, alerts.
 *  - A kid never sees billing: the plan screen and the account's Billing say "Ask a grown-up".
 *  - Switching to the grown-up's profile asks for their PIN (set before the first kid is added),
 *    checked by the server and rate limited.
 *  - Deleting the grown-up's account deletes their kids' accounts too.
 */

/** Kid accounts' addresses (`kid-<uuid>@kids.agathon.app`) and the test for one: `kidEmail.ts`. */
export { KID_EMAIL_DOMAIN, isKidEmail } from "./kidEmail";

/** Kids under one grown-up. */
export const MAX_KIDS = 6;

/** A grown-up's PIN: exactly 4 digits. */
export const PIN_PATTERN = /^\d{4}$/;

/** The pictures a profile can have (`profiles.avatar`): an id each, drawn as an emoji for now. */
export const AVATARS = {
  fox: "🦊",
  owl: "🦉",
  cat: "🐱",
  dog: "🐶",
  panda: "🐼",
  rabbit: "🐰",
  tiger: "🐯",
  frog: "🐸",
  penguin: "🐧",
  koala: "🐨",
  lion: "🦁",
  unicorn: "🦄",
} as const;
export type AvatarId = keyof typeof AVATARS;

export function isAvatarId(value: unknown): value is AvatarId {
  return typeof value === "string" && Object.prototype.hasOwnProperty.call(AVATARS, value);
}

/** A profile name: 1–30 characters after trimming. */
export const NAME_MAX = 30;

export type FamilyRole = "solo" | "parent" | "kid";

export interface FamilyMember {
  userId: string;
  displayName: string;
  avatar: AvatarId | null;
  /** 0..8, null for a high-school course or unknown */
  grade: number | null;
  isParent: boolean;
  /** headline numbers for the grown-up's family page; null when not read */
  stats: { streak: number; problemsThisWeek: number; mastered: number } | null;
}

/** GET /api/family: who is signed in and who else is in their family. */
export interface FamilyState {
  role: FamilyRole;
  /** the signed-in user */
  me: string;
  /** the grown-up's user id (`me` for solo and parent) */
  parentId: string;
  /** grown-up first, then the kids in the order they were added */
  members: FamilyMember[];
  hasPin: boolean;
}

/** POST /api/family/kids */
export interface AddKidInput {
  displayName: string;
  grade: number | null;
  avatar: AvatarId;
}

/** POST /api/family/switch: `to` is a member's user id; `pin` only when switching to the grown-up. */
export interface SwitchInput {
  to: string;
  pin?: string;
}

/** The new session, which the client hands to `supabase.auth.setSession`. */
export interface SwitchResult {
  access_token: string;
  refresh_token: string;
}
