/**
 * Sign in, then finish: /start answers this device still holds (`pending.ts`) are saved to the
 * account that signs in here, when that account has not been onboarded yet. That covers
 * "Already have an account? Sign in" on the account screen, a sign-up that needed its email
 * confirmed first, and a sign-up whose page closed while saving.
 *
 * An account that is onboarded already is left as it is (its grade, its name, its boards): the
 * answers are dropped. A profile that cannot be read leaves them for the next page.
 *
 * Loaded lazily by `StartResume` (root layout) only when something is pending. Steps injected, so
 * `__tests__/resume.test.ts` runs them against fakes.
 */
import { supabase } from "@/lib/supabase";
import type { OnboardingProfile } from "@/lib/onboarding/state";
import { fetchOnboardingProfile } from "@/lib/onboarding/storage";
import type { StartAnswers } from "./contracts";
import { asStartClient, finishStart, type FinishResult } from "./finish";
import { cleanStartAnswers } from "./link";
import { clearStartPending, readStartPending, startStorage, type StorageLike } from "./pending";
import { linkStartJourney } from "./record";

export interface ResumeDeps {
  storage: StorageLike | null;
  now: () => number;
  readProfile: (userId: string) => Promise<{ ok: true; value: OnboardingProfile | null } | { ok: false; error: string }>;
  linkJourney: (userId: string) => Promise<void>;
  finish: (userId: string, answers: StartAnswers) => Promise<FinishResult>;
}

/** What happened: finished (go to `next`), nothing to do, dropped (onboarded already), or wait (try again on the next page). */
export type ResumeOutcome = { kind: "finished"; next: string; result: FinishResult } | { kind: "none" } | { kind: "dropped" } | { kind: "wait" };

export async function resumeStart(userId: string, deps: ResumeDeps): Promise<ResumeOutcome> {
  const pending = readStartPending(deps.storage, userId, deps.now());
  if (!pending) return { kind: "none" };
  const answers = cleanStartAnswers(pending.answers);
  if (!answers) {
    clearStartPending(deps.storage);
    return { kind: "none" };
  }
  const profile = await deps.readProfile(userId);
  if (!profile.ok) return { kind: "wait" };
  if (profile.value?.onboarded_at) {
    clearStartPending(deps.storage);
    return { kind: "dropped" };
  }
  const [, result] = await Promise.all([deps.linkJourney(userId).catch(() => undefined), deps.finish(userId, answers)]);
  clearStartPending(deps.storage);
  return { kind: "finished", next: result.next, result };
}

/** `resumeStart` with the app's own client and device. */
export function resumeStartHere(userId: string): Promise<ResumeOutcome> {
  const client = asStartClient(supabase);
  return resumeStart(userId, {
    storage: startStorage(),
    now: Date.now,
    readProfile: (id) => fetchOnboardingProfile(client, id),
    linkJourney: linkStartJourney,
    finish: (id, answers) => finishStart(client, id, answers),
  });
}
