"use client";

import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import { clientMetric } from "@/lib/logger";
import type { CourseId } from "@/lib/onboarding/courses";
import { browserStorage, readLocalDone, writeLocalDone } from "@/lib/onboarding/marker";
import { needsProfile, welcomeDecision, type OnboardingProfile, type WelcomeDecision } from "@/lib/onboarding/state";
import { asOnboardingClient, fetchOnboardingProfile, saveOnboarding } from "@/lib/onboarding/storage";

const client = asOnboardingClient(supabase);

/**
 * Whether the boards home shows the welcome (see `welcomeDecision`): only for a student with no
 * boards whose profile says onboarding is not done. The profile is read only in that case — a
 * student with boards never pays for the extra request — and a device that already recorded the
 * welcome as done does not ask again.
 */
export function useWelcome(userId: string | undefined, boards: "loading" | "error" | number): {
  decision: WelcomeDecision;
  /** Skip: stores the course (when chosen) and completion; the home shows its empty state */
  skip: (course: CourseId | null, step: number) => void;
} {
  const [skipped, setSkipped] = useState(false);
  // read on render: the first client render has no user yet, so SSR and hydration agree
  const localDone = skipped || readLocalDone(browserStorage(), userId);
  const [read, setRead] = useState<{ userId: string; value: "error" | OnboardingProfile | null } | null>(null);
  const wanted = Boolean(userId) && needsProfile({ boards, localDone });

  useEffect(() => {
    if (!wanted || !userId) return;
    let cancelled = false;
    void fetchOnboardingProfile(client, userId).then((res) => {
      if (!cancelled) setRead({ userId, value: res.ok ? res.value : "error" });
    });
    return () => {
      cancelled = true;
    };
  }, [wanted, userId]);

  const profile = read && read.userId === userId ? read.value : "loading";
  const decision = welcomeDecision({ boards, profile, localDone });

  useEffect(() => {
    if (decision === "show") clientMetric("onboarding.welcome.shown", {});
  }, [decision]);

  const skip = useCallback(
    (course: CourseId | null, step: number) => {
      if (!userId) return;
      clientMetric("onboarding.welcome.skip", { step, course });
      writeLocalDone(browserStorage(), userId);
      setSkipped(true);
      void saveOnboarding(client, { course, complete: true }).then((res) => {
        if (!res.ok) clientMetric("onboarding.save.failed", { error: res.error });
      });
    },
    [userId],
  );

  return { decision, skip };
}
