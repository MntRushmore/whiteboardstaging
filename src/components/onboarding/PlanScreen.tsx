"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { AuthErrorBanner, useAuth } from "@/components/AuthProvider";
import { AppHeader } from "@/components/app/AppHeader";
import { clientMetric } from "@/lib/logger";
import { trialEndsOn, unlimitedCheckoutUrl } from "@/lib/billing/unlimited";
import { useUnlimited } from "@/lib/billing/useUnlimited";
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
 * Start the free week opens the plan's Stripe Payment Link for this account (its checkout
 * reference, `unlimitedCheckoutUrl`) in this tab; its return
 * lands on the home (`/?unlimited=started`), which welcomes them. There is no free plan, so no
 * Maybe later: the home, the boards and Progress send a student without a plan back here
 * (`usePlanGate`).
 */
export function PlanScreen() {
  const router = useRouter();
  const { user, loading: authLoading, authError } = useAuth();
  const unlimited = useUnlimited();
  const [starting, setStarting] = useState(false);
  // the day the free week would end if it started now (client only: the card shows once signed in)
  const [now] = useState(() => new Date());
  // The account's checkout reference comes with the plan's own read (never the user id): until it
  // lands the screen is still "checking", so the button never opens a checkout without it.
  const checkout = user ? unlimitedCheckoutUrl({ checkoutRef: unlimited.state.checkoutRef, email: user.email }) : null;
  const view = planView({ loading: unlimited.loading || authLoading || !user, unlimited: unlimited.state, checkoutUrl: checkout });
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
            chargeDate={chargeDateText(trialEndsOn(now))}
            starting={starting}
            onStart={() => {
              if (!checkout) return;
              setStarting(true);
              clientMetric("onboarding.plan.start", { view });
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
