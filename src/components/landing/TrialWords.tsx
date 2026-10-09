"use client";

import { useSyncExternalStore } from "react";
import { referralLink } from "@/lib/billing/planChoice";
import { browserStorage, readStoredAttribution, type StoredAttribution } from "@/lib/funnel/capture";
import { inviteCode } from "@/lib/referral/invite";

/**
 * The one island on /parents: the free trial's words, swapped for a friend's free first month for a
 * visitor whose invite link brought them here (`agathon.app/?ref=…`; a signed-out `/` sends them on
 * with the query). Swapped only when checkout will give that month: the device holds an invite (the
 * funnel's capture of `?ref=`, or the address's own, not yet saved to an account: `inviteCode`) and
 * this build has the friend's Payment Link (`referralLink`, NEXT_PUBLIC_UNLIMITED_REFERRAL_LINK,
 * inlined at build time). Everyone else, the server's HTML and a search engine get `usual`, so the
 * page stays static. Text only: the server components keep their links and headings around it.
 */
export function TrialWords({ usual, invited }: { usual: string; invited: string }) {
  const friend = useSyncExternalStore(subscribeNever, friendOfferOnThisDevice, () => false);
  return <>{friend ? invited : usual}</>;
}

const subscribeNever = () => () => {};

/** The friend's free month applies: an invite (a well-formed code) and its Payment Link. Pure. */
export function friendOffer(stored: StoredAttribution | null, href: string | null | undefined, link: string | null): boolean {
  return link !== null && inviteCode(stored, href) !== null;
}

/** `friendOffer` for this visitor: what this device keeps, the address they are on, this build's link. */
export function friendOfferOnThisDevice(): boolean {
  const link = referralLink();
  // no link on this build (the usual case until the owner makes it): nothing to read
  return link !== null && friendOffer(readStoredAttribution(browserStorage()), window.location.href, link);
}
