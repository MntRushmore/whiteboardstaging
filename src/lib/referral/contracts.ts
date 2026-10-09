/**
 * Referrals (2026-10-09, Phase 2 "parents recommend it"): "Give a friend a free month, get a free
 * month." Every grown-up has a short code; their link is `https://agathon.app/?ref=<code>`. The
 * funnel's capture keeps `?ref=` in the visitor's attribution (src/lib/funnel/capture.ts), and when
 * it is saved to a new account the database records the referral (`referrals`,
 * supabase/migrations/20261009100000_parents_recommend.sql).
 *
 * The rewards need Stripe objects only the owner can make (the app has no Stripe secret key):
 *  - the friend's free first month: a Payment Link with a 30-day trial,
 *    NEXT_PUBLIC_UNLIMITED_REFERRAL_LINK; without it the friend gets the usual 7-day trial;
 *  - the referrer's free month: a credit the owner applies in Stripe when the friend's first
 *    payment succeeds; the admin console lists referrals due one and marks them rewarded.
 *
 * Shared contract for Phase 2 (docs/KIDS-COME-BACK.md).
 */

/** A referral code: 6–10 characters from an alphabet with no look-alikes (no 0/O, 1/I/L). */
export const REFERRAL_CODE_PATTERN = /^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{6,10}$/;

export function isReferralCode(value: unknown): value is string {
  return typeof value === "string" && REFERRAL_CODE_PATTERN.test(value);
}

/** How far a referral got (`referrals.status`), in order. */
export const REFERRAL_STATUSES = ["signed_up", "trialing", "paid", "rewarded", "void"] as const;
export type ReferralStatus = (typeof REFERRAL_STATUSES)[number];

export interface ReferralSummary {
  code: string;
  /** `https://agathon.app/?ref=<code>` on this deployment (NEXT_PUBLIC_SITE_URL) */
  link: string;
  /** friends who signed up with it, and how many of them now pay */
  signedUp: number;
  paid: number;
  /** free months earned (rewarded) and waiting to be applied (paid, not yet rewarded) */
  monthsEarned: number;
  monthsPending: number;
}

export const REFERRAL_COPY = {
  title: "Give a month, get a month",
  pitch: "Share Agathon with another family. When they join, they get their first month free, and you get a free month too.",
} as const;
