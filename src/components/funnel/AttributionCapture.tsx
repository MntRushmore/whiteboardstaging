"use client";

import { useEffect } from "react";
import { useAuth } from "@/components/AuthProvider";

/** How long after the page settles the save is made: never in the way of the page's own first requests. */
const SAVE_DELAY_MS = 2_000;

type CaptureModule = typeof import("@/lib/funnel/capture");
let loading: Promise<CaptureModule> | null = null;

/**
 * The capture's rules (`src/lib/funnel/capture.ts`): a dynamic import, so no page carries them in its
 * first load (docs/BUNDLE.md). One promise, so what is chained on it runs in the order it was asked
 * for: the visit is kept before a signed-in user's decision is read.
 */
function loadCapture(): Promise<CaptureModule> {
  loading ??= import("@/lib/funnel/capture").catch((err: unknown) => {
    loading = null; // a chunk that failed to load: the next page tries again
    throw err;
  });
  return loading;
}

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
    // where the visitor is, read now: the module that keeps it arrives a moment later
    const page = { href: window.location.href, referrer: document.referrer };
    const now = new Date();
    loadCapture()
      .then(({ browserStorage, captureAttribution }) => {
        captureAttribution(browserStorage(), page, now);
      })
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    if (!userId) return;
    let cancelled = false;
    let timer: number | undefined;
    loadCapture()
      .then(({ attributionDecision, browserStorage, markAttributionSent, readStoredAttribution }) => {
        if (cancelled) return;
        const storage = browserStorage();
        const decision = attributionDecision(readStoredAttribution(storage), { id: userId, email, created_at: createdAt });
        if (decision.kind === "skip") {
          markAttributionSent(storage, new Date());
          return;
        }
        if (decision.kind !== "send") return;
        timer = window.setTimeout(() => {
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
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [userId, email, createdAt]);

  return null;
}
