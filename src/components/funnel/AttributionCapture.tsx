"use client";

import { useEffect } from "react";
import { useAuth } from "@/components/AuthProvider";
import { attributionDecision, browserStorage, captureAttribution, markAttributionSent, readStoredAttribution } from "@/lib/funnel/capture";

/** How long after the page settles the save is made: never in the way of the page's own first requests. */
const SAVE_DELAY_MS = 2_000;

/**
 * Sign-up attribution (src/lib/funnel/capture.ts), mounted once in the root layout. Renders nothing.
 * On the first visit it keeps where the visitor came from on this device; once someone is signed in
 * (the session AuthProvider already reads: no lookup of its own), it saves that to their profile
 * once, a moment after the page has loaded, with the Supabase call in a lazy chunk.
 */
export function AttributionCapture() {
  const { user } = useAuth();
  const userId = user?.id ?? null;
  const email = user?.email ?? null;
  const createdAt = user?.created_at ?? null;

  useEffect(() => {
    captureAttribution(browserStorage(), { href: window.location.href, referrer: document.referrer }, new Date());
  }, []);

  useEffect(() => {
    if (!userId) return;
    const storage = browserStorage();
    const decision = attributionDecision(readStoredAttribution(storage), { id: userId, email, created_at: createdAt });
    if (decision.kind === "skip") {
      markAttributionSent(storage, new Date());
      return;
    }
    if (decision.kind !== "send") return;
    let cancelled = false;
    const timer = window.setTimeout(() => {
      void Promise.all([import("@/lib/funnel/save"), import("@/lib/supabase")])
        .then(async ([{ saveAttribution }, { supabase }]) => {
          if (cancelled) return;
          const result = await saveAttribution(supabase, decision.attribution);
          if (result.done) markAttributionSent(storage, new Date());
        })
        .catch(() => {
          // a chunk that failed to load: the next page tries again
        });
    }, SAVE_DELAY_MS);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [userId, email, createdAt]);

  return null;
}
