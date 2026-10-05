"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/components/AuthProvider";
import { checkIsAdmin } from "@/components/admin/useIsAdmin";
import { clientMetric } from "@/lib/logger";
import { gateNeedsAdmin, markCheckoutReturn, planGate, returnedFromCheckout, type PlanGate } from "@/lib/billing/planGate";
import { isUnlimitedReturn, unlimitedLink } from "@/lib/billing/unlimited";
import { useUnlimited } from "@/lib/billing/useUnlimited";
import { PLAN_PATH } from "@/lib/onboarding/planMarker";

function sessionStore(): Storage | null {
  try {
    return typeof window === "undefined" ? null : window.sessionStorage;
  } catch {
    return null;
  }
}

/**
 * The paywall on a signed-in page (`planGate`): a student without Agathon Unlimited is sent to the
 * plan screen, once the plan has been read. `enabled: false` leaves the page alone (the welcome,
 * the guided first board). Returns the gate, so a page can hold back what it would only flash.
 *
 * The plan is part of the ink summary every page reads already (one shared request). `is_admin()`
 * is asked only when the answer would lock someone out, and remembered for the tab.
 */
export function usePlanGate({ enabled = true, page }: { enabled?: boolean; page: string }): PlanGate {
  const router = useRouter();
  const { user } = useAuth();
  const { state, known } = useUnlimited();
  const userId = user?.id;
  // Back from checkout: read on the first render, before the home takes `?unlimited=started` out
  // of the address (useHomeArrival), and kept for the tab so the boards stay open meanwhile too.
  const [justPaid] = useState(() => {
    const storage = sessionStore();
    if (typeof window !== "undefined" && isUnlimitedReturn(window.location.search)) markCheckoutReturn(storage, Date.now());
    return returnedFromCheckout(storage, Date.now());
  });
  const [admin, setAdmin] = useState<{ userId: string; value: boolean } | null>(null);

  const input = { enabled: enabled && Boolean(userId), checkoutOpen: unlimitedLink() !== null, known, state, justPaid };
  const needsAdmin = gateNeedsAdmin(input);
  const gate = planGate({ ...input, admin: admin && admin.userId === userId ? admin.value : null });

  useEffect(() => {
    if (!needsAdmin || !userId) return;
    let live = true;
    // a failed check is "not an admin": someone without a plan goes to the plan screen either way
    void checkIsAdmin(userId).then((value) => {
      if (live) setAdmin({ userId, value: value === true });
    });
    return () => {
      live = false;
    };
  }, [needsAdmin, userId]);

  useEffect(() => {
    if (gate !== "locked") return;
    clientMetric("plan.gate.locked", { page, status: state.status });
    router.replace(PLAN_PATH);
  }, [gate, page, state.status, router]);

  return gate;
}
