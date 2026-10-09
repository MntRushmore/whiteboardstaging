"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { AuthErrorBanner, useAuth } from "@/components/AuthProvider";
import { AppHeader } from "@/components/app/AppHeader";
import { clientMetric } from "@/lib/logger";
import { trialEndsOn, unlimitedCheckoutUrl } from "@/lib/billing/unlimited";
import { planCheckoutUrl, referralApplies, trialDaysOf } from "@/lib/billing/planChoice";
import { useReferred } from "@/lib/billing/useReferred";
import { useUnlimited } from "@/lib/billing/useUnlimited";
import { isKidEmail } from "@/lib/family/contracts";
import { browserStorage } from "@/lib/onboarding/marker";
import { HOME_PATH, writePlanMarker } from "@/lib/onboarding/planMarker";
import { chargeDateText, planView } from "@/lib/onboarding/plan";
import { PlanOffer } from "./PlanOffer";
import styles from "./plan.module.css";

/**
 * /welcome/plan: the plan screen the guided board's finish card opens, once, before the home.
 * Signed-in only (like the home). A subscriber (trialing or paid up) never sees it: they go
 * straight on to the home. It counts as shown the moment it shows — the device marker turns to
 * "seen" — so the home never sends the student back here; the page itself stays reachable.
 *
 * Start the free trial opens the plan's Stripe Payment Link for this account (its checkout
 * reference, `unlimitedCheckoutUrl`) in this tab; its return
 * lands on the home (`/?unlimited=started`), which welcomes them. There is no free plan, so no
 * Maybe later: the home, the boards and Progress send a student without a plan back here
 * (`usePlanGate`).
 *
 * A family a friend invited (its own profile's attribution, `useReferred`) is sent to the referral
 * Payment Link instead, its first month free, when that link is set (src/lib/billing/planChoice.ts);
 * the screen waits for that read so the offer never changes under them. A plan that ended is started
 * again without it.
 */
export function PlanScreen() {
  const router = useRouter();
  const { user, loading: authLoading, authError } = useAuth();
  const unlimited = useUnlimited();
  const referral = useReferred(user?.id);
  const [starting, setStarting] = useState(false);
  // the day the free trial would end if it started now (client only: the card shows once signed in)
  const [now] = useState(() => new Date());
  // The account's checkout reference comes with the plan's own read (never the user id): until it
  // lands the screen is still "checking", so the button never opens a checkout without it. Whether
  // there is a checkout at all is the monthly link's, as always.
  const payer = user ? { checkoutRef: unlimited.state.checkoutRef, email: user.email } : null;
  const view = planView({
    loading: unlimited.loading || authLoading || !user || !referral.known,
    unlimited: unlimited.state,
    checkoutUrl: payer ? unlimitedCheckoutUrl(payer) : null,
  });
  // a friend's free month is for a first plan only
  const choice = { referred: referral.referred && view === "offer" };
  const checkout = payer ? planCheckoutUrl(payer, choice) : null;
  const userId = user?.id;

  useEffect(() => {
    if (!authLoading && !user && !authError) router.replace("/login");
  }, [user, authLoading, authError, router]);

  useEffect(() => {
    if (!userId || view === "checking") return;
    writePlanMarker(browserStorage(), userId, view === "soon" ? "soon" : "seen");
    if (view === "skip") {
      router.replace(HOME_PATH);
      return;
    }
    clientMetric("onboarding.plan.shown", { view });
  }, [userId, view, router]);

  if (!user && authError) {
    return (
      <div className={styles.page}>
        <main className={styles.main}>
          <AuthErrorBanner />
        </main>
      </div>
    );
  }

  return (
    <div className={styles.page}>
      <AppHeader />
      <main className={styles.main}>
        {view === "offer" || view === "restart" || view === "soon" ? (
          <PlanOffer
            view={view}
            // a kid profile shares the grown-up's plan and never sees billing (src/lib/family)
            kid={isKidEmail(user?.email)}
            chargeDate={chargeDateText(trialEndsOn(now, trialDaysOf(choice)))}
            friendMonth={referralApplies(choice)}
            starting={starting}
            onStart={() => {
              if (!checkout) return;
              setStarting(true);
              clientMetric("onboarding.plan.start", { view, referred: referralApplies(choice) });
              window.location.assign(checkout);
            }}
            onContinue={() => {
              clientMetric("onboarding.plan.continue", { view });
              router.replace(HOME_PATH);
            }}
          />
        ) : (
          <div aria-hidden className={styles.placeholder} />
        )}
      </main>
    </div>
  );
}
