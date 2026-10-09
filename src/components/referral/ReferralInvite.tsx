"use client";

import { useSyncExternalStore } from "react";
import { Gift } from "lucide-react";
import { referralLink } from "@/lib/billing/planChoice";
import { browserStorage, readStoredAttribution } from "@/lib/funnel/capture";
import { inviteCode, inviteView } from "@/lib/referral/invite";
import styles from "./referral.module.css";

/** The friend's free first month is on sale on this build (its Payment Link is set). */
const FRIEND_OFFER = referralLink() !== null;

const subscribeNever = () => () => {};

/** The invite this device arrived with (read once the page is in the browser; none on the server). */
export function readInvite(): string | null {
  return inviteCode(readStoredAttribution(browserStorage()), window.location.href);
}

/**
 * On the sign-in / sign-up page, for a visitor who came through a friend's invite link: "A friend
 * invited you to Agathon", and "Your first month is free." only when the friend's free-month
 * Payment Link is set. It never says whose code it is. Nothing on the server's HTML (the invite
 * lives on the device), so the page renders the same for everyone until it is in the browser.
 */
export function ReferralInvite() {
  const code = useSyncExternalStore(subscribeNever, readInvite, () => null);
  const view = inviteView(code, FRIEND_OFFER);
  if (!view) return null;
  return (
    <div className={styles.invite} role="note" data-testid="referral-invite">
      <span className={styles.inviteBadge} aria-hidden>
        <Gift size={18} strokeWidth={1.8} />
      </span>
      <div className={styles.inviteText}>
        <p className={styles.inviteTitle}>{view.title}</p>
        {view.freeMonth && <p className={styles.inviteSub}>{view.freeMonth}</p>}
      </div>
    </div>
  );
}
