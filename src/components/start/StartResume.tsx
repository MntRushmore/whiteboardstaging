"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/components/AuthProvider";
import { writeLocalDone } from "@/lib/onboarding/marker";
import { readStartPending, startStorage } from "@/lib/start/pending";

/** /start's own pages: the account screen finishes its own sign-up there. */
const START_PAGES = /^\/start(?:\/|$)/;

/**
 * Sign in, then finish (src/lib/start/resume.ts), mounted once in the root layout. Renders nothing.
 * Once someone is signed in on a page other than /start, and this device holds /start answers for
 * them (`pending.ts`: "Already have an account? Sign in", a sign-up that waited for its email, a
 * page closed while saving), the answers are saved to that account if it has not been onboarded,
 * and the plan screen opens.
 *
 * The check is synchronous and tiny (one localStorage read); the rest is a lazy chunk, loaded only
 * when something is waiting. The old welcome is marked done on this device at once, so the home
 * never flashes it while the answers are being saved.
 */
export function StartResume() {
  const router = useRouter();
  const { user } = useAuth();
  const userId = user?.id ?? null;

  useEffect(() => {
    if (!userId || START_PAGES.test(window.location.pathname)) return;
    const storage = startStorage();
    if (!readStartPending(storage, userId, Date.now())) return;
    writeLocalDone(storage, userId);
    let live = true;
    void import("@/lib/start/resume")
      .then(({ resumeStartHere }) => resumeStartHere(userId))
      .then((outcome) => {
        if (live && outcome.kind === "finished") router.replace(outcome.next);
      })
      .catch(() => {
        // a chunk that failed to load: the answers wait for the next page
      });
    return () => {
      live = false;
    };
  }, [userId, router]);

  return null;
}
