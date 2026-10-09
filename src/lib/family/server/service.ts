/**
 * What each /api/family route does, between "the caller is signed in" (requireUser) and the HTTP
 * answer: who may do it, in which order, and what it says when they may not. Kept out of the route
 * files (which may export only handlers) and over the `FamilyStore` seam, so the authorization rules
 * have tests that drive them with a fake store.
 *
 * Who may do what:
 *  - anyone signed in reads their own family (GET /api/family); a grown-up gets their kids' numbers;
 *  - only a grown-up (never a kid profile) sets the PIN, adds kids, edits or removes their OWN kids;
 *  - a kid is added only while the grown-up's plan gives Unlimited (kids have no ink of their own:
 *    supabase/migrations/20261009040000_family_hardening.sql), once the PIN is set, while the family
 *    has fewer than MAX_KIDS, and within KID_ADDS a day (so removing and re-adding cannot churn
 *    accounts);
 *  - switching follows `decideSwitch`, and to the grown-up only with their PIN, checked here against
 *    the hash with every try counted per family first (PIN_ATTEMPTS, PIN_DAILY_LIMIT). The day's last
 *    wrong PIN locks switching to the grown-up until they sign in with their password, and is
 *    recorded as an app event; a counter that cannot be asked refuses the try.
 * A kid or a profile that is not the caller's answers 404, the same as one that does not exist.
 */
import type { ApiErrorCode, AuthedUser } from "@/lib/server/auth";
import { isKidEmail, MAX_KIDS, type AddKidInput, type FamilyMember, type FamilyState, type SwitchInput, type SwitchResult } from "@/lib/family/contracts";
import { buildFamilyState, decideSwitch, ownsKid, type FamilyLinks } from "@/lib/family/members";
import type { EditKidInput } from "@/lib/family/schemas";
import { hashPin, PIN_DAILY_LIMIT, verifyPin } from "./pin";
import type { FamilyStore } from "./store";

/** A refusal, as the route answers it (`json(status, code, message, extra)`). */
export interface Refusal {
  ok: false;
  status: number;
  code: ApiErrorCode;
  message: string;
  /**
   * machine-readable why, for the app's copy: `pin_required`, `wrong_pin`, `no_pin`, `kid`,
   * `too_many`, `plan_required`, `kid_add_limit`, `pin_locked`, `pin_unavailable`
   */
  reason?: string;
  extra?: Record<string, unknown>;
  /** 429 only */
  retryAfterMs?: number;
  backend?: "db" | "memory";
  /** something the admin should hear about: the route records it as an app event (warn) */
  event?: { code: string; message: string; meta?: Record<string, unknown> };
}
export type Outcome<T> = { ok: true; value: T } | Refusal;

const ok = <T>(value: T): Outcome<T> => ({ ok: true, value });
const refuse = (status: number, code: ApiErrorCode, message: string, reason?: string, extra?: Record<string, unknown>): Refusal => ({
  ok: false,
  status,
  code,
  message,
  ...(reason ? { reason, extra: { reason, ...(extra ?? {}) } } : extra ? { extra } : {}),
});

/** The server's words for each refusal (the app shows its own copy from `reason` where it has one). */
export const FAMILY_ERRORS = {
  kid: "A kid profile can't do that. Ask your grown-up.",
  noKid: "No kid in your family has that profile.",
  noOne: "No one in your family has that profile.",
  solo: "There's no other profile to switch to.",
  self: "You're already on that profile.",
  pinRequired: "Enter the grown-up's PIN.",
  noPin: "Your grown-up hasn't set a PIN yet. Ask them to sign in.",
  wrongPin: "That PIN isn't right.",
  setPinFirst: "Set a PIN first, so only you can get back to your profile.",
  tooMany: `A family can have up to ${MAX_KIDS} kids.`,
  gone: "That profile isn't there any more.",
  planRequired: "Start your free trial to add kids.",
  kidAddLimit: "You've added a lot of kids today. Try again tomorrow.",
  tooManyTries: "Too many tries.",
  pinLocked: "Too many wrong PINs today. The grown-up needs to sign in with their password.",
  pinUnavailable: "Couldn't check the PIN just now. Try again in a moment.",
} as const;

/** True when the caller is a kid profile: by their address, or by a family_members row. */
function isKid(caller: AuthedUser, links: FamilyLinks | null): boolean {
  return isKidEmail(caller.email) || (!!links && links.parentId !== caller.id);
}

/** GET /api/family */
export async function readFamily(store: FamilyStore, caller: AuthedUser, opts: { now: number; tzOffsetMinutes: number }): Promise<FamilyState> {
  const links = await store.links(caller.id);
  const ids = links ? [links.parentId, ...links.kids] : [caller.id];
  const [family, profiles] = await Promise.all([links ? store.family(links.parentId) : Promise.resolve(null), store.profiles(ids)]);
  const stats = links && links.parentId === caller.id && links.kids.length > 0 ? await store.stats(links.kids, opts.now, opts.tzOffsetMinutes) : undefined;
  return buildFamilyState({ me: caller.id, links, hasPin: !!family?.pinHash, profiles, stats });
}

/** POST /api/family/pin: set or change the grown-up's PIN (their own session is the proof). */
export async function setFamilyPin(store: FamilyStore, caller: AuthedUser, pin: string): Promise<Outcome<{ hasPin: true }>> {
  const links = await store.links(caller.id);
  if (isKid(caller, links)) return refuse(403, "invalid_request", FAMILY_ERRORS.kid, "kid");
  await store.setPin(caller.id, await hashPin(pin));
  return ok({ hasPin: true });
}

/** POST /api/family/kids */
export async function addKid(store: FamilyStore, caller: AuthedUser, input: AddKidInput): Promise<Outcome<FamilyMember>> {
  const links = await store.links(caller.id);
  if (isKid(caller, links)) return refuse(403, "invalid_request", FAMILY_ERRORS.kid, "kid");
  // Kids share the grown-up's plan and have no ink of their own: without it a kid could do nothing.
  if (!(await store.hasPlan(caller.id))) return refuse(409, "invalid_request", FAMILY_ERRORS.planRequired, "plan_required");
  const family = await store.family(caller.id);
  if (!family?.pinHash) return refuse(409, "invalid_request", FAMILY_ERRORS.setPinFirst, "pin_required");
  if ((links?.kids.length ?? 0) >= MAX_KIDS) return refuse(409, "invalid_request", FAMILY_ERRORS.tooMany, "too_many");
  // Counted last, so only an add that would happen spends the day's budget.
  const budget = await store.kidAddAttempt(caller.id);
  if (!budget.ok) {
    return { ...refuse(429, "rate_limited", FAMILY_ERRORS.kidAddLimit, "kid_add_limit"), retryAfterMs: budget.retryAfterMs, backend: "db" };
  }
  const me = (await store.profiles([caller.id])).get(caller.id);
  const kidId = await store.createKid(caller.id, input, me?.termsVersion ?? null);
  return ok({ userId: kidId, displayName: input.displayName, avatar: input.avatar, grade: input.grade, isParent: false, stats: { streak: 0, problemsThisWeek: 0, mastered: 0 } });
}

/** PATCH /api/family/kids/<id>: only the caller's own kid. */
export async function editKid(store: FamilyStore, caller: AuthedUser, kidId: string, patch: EditKidInput): Promise<Outcome<{ updated: true }>> {
  const links = await store.links(caller.id);
  if (isKid(caller, links)) return refuse(403, "invalid_request", FAMILY_ERRORS.kid, "kid");
  if (!ownsKid(links, caller.id, kidId)) return refuse(404, "not_found", FAMILY_ERRORS.noKid);
  await store.editKid(kidId, patch);
  return ok({ updated: true });
}

/** DELETE /api/family/kids/<id>: the kid's account and everything in it. */
export async function removeKid(store: FamilyStore, caller: AuthedUser, kidId: string): Promise<Outcome<{ removed: true; assetsError: string | null }>> {
  const links = await store.links(caller.id);
  if (isKid(caller, links)) return refuse(403, "invalid_request", FAMILY_ERRORS.kid, "kid");
  if (!ownsKid(links, caller.id, kidId)) return refuse(404, "not_found", FAMILY_ERRORS.noKid);
  const { assetsError } = await store.deleteKid(kidId);
  return ok({ removed: true, assetsError });
}

/**
 * DELETE /api/family: every kid's saved images, right before the grown-up's own account is deleted
 * (src/lib/billing/deleteAccount.ts). The kids' ACCOUNTS stay: delete_own_account() deletes them in
 * the same transaction as the grown-up's, so a deletion that is refused or fails keeps every kid.
 * Only the images go first because SQL cannot remove files. `removed` counts the kids whose images
 * were cleared. Nothing to do for a solo account; refused for a kid.
 */
export async function removeKidsImages(store: FamilyStore, caller: AuthedUser): Promise<Outcome<{ removed: number }>> {
  const links = await store.links(caller.id);
  if (isKid(caller, links)) return refuse(403, "invalid_request", FAMILY_ERRORS.kid, "kid");
  let removed = 0;
  for (const kidId of links?.kids ?? []) {
    await store.removeKidAssets(kidId);
    removed++;
  }
  return ok({ removed });
}

/**
 * POST /api/family/switch: a session for `to`, minted by the server. The caller's own session is
 * ended once the new one exists, so the profile left behind needs its way back (the grown-up's PIN).
 */
export async function switchProfile(store: FamilyStore, caller: AuthedUser, token: string, input: SwitchInput): Promise<Outcome<SwitchResult>> {
  const links = await store.links(caller.id);
  const decision = decideSwitch(links, caller.id, input.to);
  if (!decision.ok) {
    if (decision.reason === "self") return refuse(400, "invalid_request", FAMILY_ERRORS.self, "self");
    return refuse(404, "not_found", decision.reason === "solo" ? FAMILY_ERRORS.solo : FAMILY_ERRORS.noOne);
  }

  if (decision.needsPin) {
    if (!input.pin) return refuse(400, "invalid_request", FAMILY_ERRORS.pinRequired, "pin_required");
    const family = await store.family(decision.parentId);
    if (!family?.pinHash) return refuse(403, "invalid_request", FAMILY_ERRORS.noPin, "no_pin");
    // Counted BEFORE the check, so parallel guesses cannot all get in under the limit.
    const attempt = await store.pinAttempt(decision.parentId);
    if (!attempt.ok) {
      // No counter, no PIN check: a kid never gets tries nobody counted.
      if (attempt.reason === "unavailable") return refuse(503, "feature_unavailable", FAMILY_ERRORS.pinUnavailable, "pin_unavailable");
      if (attempt.reason === "locked") {
        return { ...refuse(429, "rate_limited", FAMILY_ERRORS.pinLocked, "pin_locked"), retryAfterMs: attempt.retryAfterMs, backend: "db" };
      }
      return { ok: false, status: 429, code: "rate_limited", message: FAMILY_ERRORS.tooManyTries, retryAfterMs: attempt.retryAfterMs, backend: "db" };
    }
    if (!(await verifyPin(input.pin, family.pinHash))) {
      if (!attempt.last) return refuse(403, "invalid_request", FAMILY_ERRORS.wrongPin, "wrong_pin", { triesLeft: attempt.remaining });
      // The day's last wrong PIN: switching to the grown-up is locked until they sign in themself.
      return {
        ...refuse(403, "invalid_request", FAMILY_ERRORS.wrongPin, "wrong_pin", { triesLeft: 0, locked: true }),
        event: {
          code: "pin_locked",
          message: `A family's PIN was locked after ${PIN_DAILY_LIMIT} wrong tries in a day`,
          meta: { parentId: decision.parentId, by: caller.id },
        },
      };
    }
    await store.pinForgive(decision.parentId, attempt.windowStart);
  }

  const email = await store.emailOf(input.to);
  if (!email) return refuse(404, "not_found", FAMILY_ERRORS.gone);
  const session = await store.mintSession(email);
  await store.revokeSession(token);
  return ok(session);
}
