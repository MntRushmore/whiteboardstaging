"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/components/AuthProvider";
import { checkIsAdmin } from "@/components/admin/useIsAdmin";
import { clientMetric } from "@/lib/logger";
import { gateNeedsAdmin, markCheckoutReturn, planGate, returnedFromCheckout, type PlanGate, type PlanGateInput } from "@/lib/billing/planGate";
import { isUnlimitedReturn, unlimitedLink, type UnlimitedState } from "@/lib/billing/unlimited";
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
 * What the paywall decides on (`PlanGateInput`), as a signed-in page knows it: the plan (the ink
 * summary every page reads already: one shared request), the checkout link, the return from
 * checkout, and `is_admin()` — asked only when the answer would hold someone (`gateNeedsAdmin`),
 * and remembered for the tab. Shared by `usePlanGate` and `useFreeBoard`.
 */
export function usePlanInput(enabled: boolean): { input: PlanGateInput; userId: string | undefined; state: UnlimitedState } {
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

  const base = { enabled: enabled && Boolean(userId), checkoutOpen: unlimitedLink() !== null, known, state, justPaid };
  const needsAdmin = gateNeedsAdmin(base);

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

  return { input: { ...base, admin: admin && admin.userId === userId ? admin.value : null }, userId, state };
}

/**
 * The paywall on a signed-in page (`planGate`): a student without Agathon Unlimited is sent to the
 * plan screen, once the plan has been read. `enabled: false` leaves the page alone (the welcome,
 * the guided first board). Returns the gate, so a page can hold back what it would only flash.
 * The home and the boards use `useFreeBoard` instead: the same paywall with the free board.
 */
export function usePlanGate({ enabled = true, page }: { enabled?: boolean; page: string }): PlanGate {
  const router = useRouter();
  const { input, state } = usePlanInput(enabled);
  const gate = planGate(input);

  useEffect(() => {
    if (gate !== "locked") return;
    clientMetric("plan.gate.locked", { page, status: state.status });
    router.replace(PLAN_PATH);
  }, [gate, page, state.status, router]);

  return gate;
}
