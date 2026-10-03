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
 * Start the free week opens the plan's Stripe Payment Link for this user in this tab; its return
 * lands on the home (`/?unlimited=started`), which welcomes them. Maybe later goes home.
 */
export function PlanScreen() {
  const router = useRouter();
  const { user, loading: authLoading, authError } = useAuth();
  const unlimited = useUnlimited();
  const [starting, setStarting] = useState(false);
  // the day the free week would end if it started now (client only: the card shows once signed in)
  const [now] = useState(() => new Date());
  const checkout = user ? unlimitedCheckoutUrl({ userId: user.id, email: user.email }) : null;
  const view = planView({ loading: unlimited.loading || authLoading || !user, unlimited: unlimited.state, checkoutUrl: checkout });
  const userId = user?.id;

  useEffect(() => {
    if (!authLoading && !user && !authError) router.replace("/login");
  }, [user, authLoading, authError, router]);

  useEffect(() => {
    if (!userId || view === "checking") return;
    writePlanMarker(browserStorage(), userId, "seen");
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
        {view === "offer" || view === "soon" ? (
          <PlanOffer
            view={view}
            chargeDate={chargeDateText(trialEndsOn(now))}
            starting={starting}
            onStart={() => {
              if (!checkout) return;
              setStarting(true);
              clientMetric("onboarding.plan.start", {});
              window.location.assign(checkout);
            }}
            onLater={() => {
              clientMetric("onboarding.plan.later", { view });
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
