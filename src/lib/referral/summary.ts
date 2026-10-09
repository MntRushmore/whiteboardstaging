/**
 * The grown-up's referral card, as data: referral_summary()'s answer
 * (supabase/migrations/20261009110000_referrals.sql) checked and turned into the contract's
 * ReferralSummary, their invite link, and the lines the card shows. The link is built in the
 * browser from the deployment's address (NEXT_PUBLIC_SITE_URL, else the page's own origin), so a
 * preview deployment hands out links to itself and the database never needs to know the site.
 *
 * Pure (zod only): no React, no network, no browser API at module scope.
 */
import { z } from "zod";
import { isReferralCode, REFERRAL_COPY, type ReferralSummary } from "./contracts";
import { REFERRAL_CARD_COPY } from "./copy";

/** referral_summary()'s answer. */
export const ReferralSummaryRpcSchema = z.object({
  code: z.string().refine(isReferralCode, "a referral code"),
  signed_up: z.number().int().nonnegative(),
  paid: z.number().int().nonnegative(),
  months_earned: z.number().int().nonnegative(),
  months_pending: z.number().int().nonnegative(),
});
export type ReferralSummaryRpc = z.infer<typeof ReferralSummaryRpcSchema>;

/** A page on this machine (a dev server): its links should open on the same dev server. */
function isLocalOrigin(origin: string | null | undefined): boolean {
  try {
    return typeof origin === "string" && ["localhost", "127.0.0.1", "[::1]"].includes(new URL(origin).hostname);
  } catch {
    return false;
  }
}

/**
 * Where links point: NEXT_PUBLIC_SITE_URL when it is an absolute http(s) address (the canonical
 * site, whichever alias the grown-up is on), else the page's origin. A page on localhost uses its
 * own origin first, so a link made on a dev server can be tried there. Trailing slashes are
 * dropped. Null when neither is usable (no link is better than a broken one).
 */
export function siteBase(siteUrl: string | null | undefined, origin: string | null | undefined): string | null {
  const order = isLocalOrigin(origin) ? [origin, siteUrl] : [siteUrl, origin];
  for (const candidate of order) {
    if (typeof candidate !== "string" || !candidate.trim()) continue;
    try {
      const url = new URL(candidate.trim());
      if (url.protocol !== "https:" && url.protocol !== "http:") continue;
      return `${url.origin}${url.pathname.replace(/\/+$/, "")}`;
    } catch {
      // not a URL: try the next
    }
  }
  return null;
}

/** `https://agathon.app/?ref=<code>`: the home, which keeps the code in the visitor's attribution. */
export function referralUrl(code: string, base: string): string {
  return `${base}/?ref=${encodeURIComponent(code)}`;
}

/** The link as the card shows it: no `https://`, no `www.` (the copied link keeps both). */
export function shownLink(url: string): string {
  return url.replace(/^https?:\/\//, "").replace(/^www\./, "");
}

/** The contract's ReferralSummary from the RPC's answer and the site's address. */
export function toReferralSummary(rpc: ReferralSummaryRpc, base: string): ReferralSummary {
  return {
    code: rpc.code,
    link: referralUrl(rpc.code, base),
    signedUp: rpc.signed_up,
    paid: rpc.paid,
    monthsEarned: rpc.months_earned,
    monthsPending: rpc.months_pending,
  };
}

/**
 * The counts in one line: "2 friends joined · 1 free month earned", plus the months still to come
 * when there are some, or "Nobody has joined with your link yet." before anyone has. No "0 free
 * months": a friend who joined but has not paid yet is good news, not a zero.
 */
export function summaryLine(s: Pick<ReferralSummary, "signedUp" | "monthsEarned" | "monthsPending">): string {
  if (s.signedUp <= 0 && s.monthsEarned <= 0) return REFERRAL_CARD_COPY.nobodyYet;
  const parts = [REFERRAL_CARD_COPY.friendsJoined(s.signedUp)];
  if (s.monthsEarned > 0) parts.push(REFERRAL_CARD_COPY.monthsEarned(s.monthsEarned));
  if (s.monthsPending > 0) parts.push(REFERRAL_CARD_COPY.monthsPending(s.monthsPending));
  return parts.join(" · ");
}

export interface ReferralCardView {
  title: string;
  pitch: string;
  link: string;
  shown: string;
  /** what navigator.share sends with the link */
  shareText: string;
  line: string;
  /** the two numbers worth a glance */
  friends: number;
  months: number;
}

/**
 * Everything the card shows. `friendOffer`: the friend's free first month is on sale on this
 * deployment (referralLink() is set); without it the pitch and the share text promise the friend
 * nothing.
 */
export function referralCardView(s: ReferralSummary, friendOffer: boolean): ReferralCardView {
  return {
    title: REFERRAL_COPY.title,
    pitch: friendOffer ? REFERRAL_COPY.pitch : REFERRAL_CARD_COPY.pitchNoFriendOffer,
    link: s.link,
    shown: shownLink(s.link),
    shareText: friendOffer ? REFERRAL_CARD_COPY.shareTextWithOffer : REFERRAL_CARD_COPY.shareText,
    line: summaryLine(s),
    friends: s.signedUp,
    months: s.monthsEarned,
  };
}
