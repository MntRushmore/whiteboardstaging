/**
 * What the share sheet adds to a page's numbers when the page did not pass them: the student's
 * picture and, when the account has one, its referral link ("Give a month, get a month",
 * `profiles.referral_code`, made by the referral part). Read from the student's own profile row
 * (the owner's select policy) after the tap, never on the page's first load.
 */
import { supabase } from "@/lib/supabase";
import { isReferralCode } from "@/lib/referral/contracts";

export interface ShareExtras {
  /** an AVATARS id, or null */
  avatar: string | null;
  /** `<site>/?ref=<code>`, or null without a code */
  link: string | null;
}

const NONE: ShareExtras = { avatar: null, link: null };

/** This deployment's address: NEXT_PUBLIC_SITE_URL when it is an absolute http(s) URL, else the page's origin. */
export function siteUrl(): string {
  const env = process.env.NEXT_PUBLIC_SITE_URL;
  if (env && /^https?:\/\/[^/]+/i.test(env)) return env.replace(/\/+$/, "");
  return typeof window === "undefined" ? "https://agathon.app" : window.location.origin;
}

/** A referral code's link on this deployment, as `ReferralSummary.link` is made. */
export function referralLink(code: string): string {
  return `${siteUrl()}/?ref=${encodeURIComponent(code)}`;
}

/**
 * The student's picture and referral link. Never throws: without the profile (or before the
 * referral column exists) the card has no picture or link and says agathon.app.
 */
export async function readShareExtras(userId: string): Promise<ShareExtras> {
  try {
    const full = await supabase.from("profiles").select("avatar, referral_code").eq("user_id", userId).maybeSingle();
    const res = full.error ? await supabase.from("profiles").select("avatar").eq("user_id", userId).maybeSingle() : full;
    if (res.error || !res.data) return NONE;
    const row = res.data as { avatar?: unknown; referral_code?: unknown };
    return {
      avatar: typeof row.avatar === "string" ? row.avatar : null,
      link: isReferralCode(row.referral_code) ? referralLink(row.referral_code) : null,
    };
  } catch {
    return NONE;
  }
}
