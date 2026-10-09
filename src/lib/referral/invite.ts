/**
 * The friend's side of a referral: whether the visitor came through an invite link, for the line on
 * the sign-up page ("A friend invited you to Agathon"), and whether an account was referred, for the
 * plan screen's choice of Payment Link (src/lib/billing/planChoice.ts `planLink({ referred })`).
 *
 * The invite is read from what the device keeps (the funnel's capture keeps `?ref=` from the first
 * page, src/lib/funnel/capture.ts) or from the address itself, and only until the device has saved
 * its attribution to an account. It never says whose code it is: the code is a stranger's to the
 * visitor, and a page that named people from a code would let anyone look names up by guessing.
 *
 * Pure: no React, no network, no browser API at module scope.
 */
import type { StoredAttribution } from "@/lib/funnel/capture";
import { isReferralCode } from "./contracts";
import { REFERRAL_INVITE_COPY } from "./copy";

/** A code as typed in a link: trimmed and upper-cased, or null when it cannot be one. */
export function normalizeReferralCode(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const code = value.trim().toUpperCase();
  return isReferralCode(code) ? code : null;
}

/**
 * The invite this visitor arrived with: the device's kept `ref` (while not yet saved to an account),
 * else the page's own `?ref=`. Null when there is none, it is not a code, or the device's
 * attribution has already gone to an account (that visitor is signing in, not joining).
 */
export function inviteCode(stored: StoredAttribution | null, href: string | null | undefined): string | null {
  if (stored?.sentAt) return null;
  const kept = normalizeReferralCode(stored?.attribution.ref);
  if (kept) return kept;
  if (!href) return null;
  try {
    return normalizeReferralCode(new URL(href).searchParams.get("ref"));
  } catch {
    return null;
  }
}

export interface InviteView {
  title: string;
  /** "Your first month is free." only when the friend's free-month link is on sale; else null */
  freeMonth: string | null;
}

/** The sign-up page's lines for an invited visitor; null for everyone else. */
export function inviteView(code: string | null, friendOffer: boolean): InviteView | null {
  if (!code) return null;
  return { title: REFERRAL_INVITE_COPY.title, freeMonth: friendOffer ? REFERRAL_INVITE_COPY.freeMonth : null };
}

/**
 * Whether an account was referred, from its own `profiles.attribution` (owner-readable). The
 * database keeps `ref` there only when it recorded a referral for the account
 * (profiles_record_referral in 20261009110000_referrals.sql drops any other), so a made-up code in
 * a link never unlocks the friend's free month.
 */
export function referredFromAttribution(attribution: unknown): boolean {
  if (!attribution || typeof attribution !== "object" || Array.isArray(attribution)) return false;
  return isReferralCode((attribution as { ref?: unknown }).ref);
}
