"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import { isReferredAttribution, referralLink } from "@/lib/billing/planChoice";

/**
 * Whether a friend invited this account: its OWN `profiles.attribution` (the owner's select policy;
 * saved once after sign-up from the device's `?ref=`, src/lib/funnel/save.ts) holds a well-formed
 * referral code. The plan screen and the account's Billing card then offer the friend's free first
 * month on the monthly plan (planChoice.ts `referralApplies`).
 *
 * Read once per account, and only when the referral Payment Link is set: without it the answer
 * changes nothing, so no request is made and the answer is known (false) at once. `known` is false
 * while the read is out, so the plan screen can wait for it rather than show the usual trial and
 * then swap in the free month. Any failure is "not referred", known: the usual 7-day trial is what
 * that account would get anyway, and a read that failed must never hold the screen up.
 */
export function useReferred(userId: string | null | undefined): { referred: boolean; known: boolean } {
  const wanted = Boolean(userId) && referralLink() !== null;
  const [answer, setAnswer] = useState<{ userId: string; referred: boolean } | null>(null);

  useEffect(() => {
    if (!wanted || !userId) return;
    let live = true;
    void readReferred(userId).then((referred) => {
      if (live) setAnswer({ userId, referred });
    });
    return () => {
      live = false;
    };
  }, [wanted, userId]);

  if (!wanted) return { referred: false, known: true };
  // an answer for another account (a switch of profile) is no answer
  if (!answer || answer.userId !== userId) return { referred: false, known: false };
  return { referred: answer.referred, known: true };
}

/** One read of the account's own attribution; false on any failure. Never throws. */
export async function readReferred(userId: string): Promise<boolean> {
  try {
    const { data, error } = await supabase.from("profiles").select("attribution").eq("user_id", userId).maybeSingle();
    if (error || !data) return false;
    return isReferredAttribution((data as { attribution?: unknown }).attribution);
  } catch {
    return false;
  }
}
