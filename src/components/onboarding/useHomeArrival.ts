"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { clientMetric } from "@/lib/logger";
import { isUnlimitedReturn } from "@/lib/billing/unlimited";
import { useUnlimited } from "@/lib/billing/useUnlimited";
import { browserStorage, readPlanMarker, writePlanMarker } from "@/lib/onboarding/marker";
import { PLAN_COPY, PLAN_PATH, planDue, withoutUnlimitedReturn } from "@/lib/onboarding/plan";

/** how long the welcome-back confetti stays mounted (its animation is about a second) */
const CHEER_MS = 2400;

/**
 * What the boards home does on arrival, for onboarding's last two screens:
 *
 * - back from starting the free week (`/?unlimited=started`, the Payment Link's return): a warm
 *   toast and a burst of confetti, the subscription read again, and the parameter taken out of the
 *   URL so a reload does not cheer twice. Returns true while the confetti should show.
 * - the plan screen still due (the tour was finished but its finish card never got there, e.g. a
 *   reload on it): sends the student there, once (the screen marks itself seen).
 *
 * Call it after the home's own `toast.dismiss()` effect: effects run in order, and the welcome
 * toast must outlive the clean-up of the page before.
 */
export function useHomeArrival(userId: string | undefined): boolean {
  const router = useRouter();
  const { refresh } = useUnlimited();
  const [cheer, setCheer] = useState(false);
  const returned = useRef<boolean | null>(null);

  useEffect(() => {
    if (returned.current !== null) return;
    returned.current = isUnlimitedReturn(window.location.search);
    if (!returned.current) return;
    clientMetric("onboarding.plan.returned", {});
    const { pathname, search, hash } = window.location;
    window.history.replaceState(window.history.state, "", `${pathname}${withoutUnlimitedReturn(search)}${hash}`);
    toast.success(PLAN_COPY.started, { description: PLAN_COPY.startedHint, duration: 6000 });
    setCheer(true); // eslint-disable-line react-hooks/set-state-in-effect -- the URL is read once, after hydration (the server has none)
    refresh();
  }, [refresh]);

  useEffect(() => {
    if (!cheer) return;
    const timer = setTimeout(() => setCheer(false), CHEER_MS);
    return () => clearTimeout(timer);
  }, [cheer]);

  useEffect(() => {
    if (!userId || returned.current === null) return;
    const storage = browserStorage();
    if (returned.current) {
      writePlanMarker(storage, userId, "seen");
      return;
    }
    if (planDue(readPlanMarker(storage, userId))) router.replace(PLAN_PATH);
  }, [userId, router]);

  return cheer;
}
