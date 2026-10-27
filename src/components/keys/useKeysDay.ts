"use client";

import { useEffect, useState } from "react";
import { localDay } from "@/lib/daily/contracts";
import { dailySeed } from "@/lib/daily/plan";
import { dueComebacks } from "@/lib/keys/comebacks";
import { generateMixed, isKeysSkill, type KeysSkill } from "@/lib/keys/generate";
import type { MathItem } from "@/lib/keys/item";
import { planKeysSet, type KeysPlan } from "@/lib/keys/plan";

export interface KeysDay {
  day: string;
  seed: number;
  items: MathItem[];
  plan: KeysPlan;
}

/**
 * Today's practice on Keys for the signed-in kid (docs/KEYS.md, Phase 4): the day's set from their
 * grade path, weak spots and record (`loadDailyPlanInput` + `planDailySet`, as the board's), made into
 * Keys skills with a due comeback first (`planKeysSet`), drawn with the day's seed. One read of the
 * record serves both. Null when there is no kid or the read fails: the page then gives the day's
 * adding set, as in Phase 1.
 */
export async function loadKeysDay(userId: string, now: number = Date.now()): Promise<KeysDay | null> {
  try {
    const day = localDay(new Date(now));
    const [{ loadDailyPlanInput }, { planDailySet }, { loadAttempts }] = await Promise.all([
      import("@/lib/daily/inputs"),
      import("@/lib/daily/plan"),
      import("@/lib/learning/store"),
    ]);
    const [input, attempts] = await Promise.all([loadDailyPlanInput(userId, day, now), loadAttempts().catch(() => [])]);
    const comebacks = dueComebacks(attempts, { now, tzOffsetMinutes: new Date(now).getTimezoneOffset(), canWrite: isKeysSkill, limit: 1 });
    const plan = planKeysSet(planDailySet(input), comebacks, input.path);
    const seed = dailySeed(userId, day, "keys");
    const items = generateMixed(seed, plan.skills as KeysSkill[]);
    return items.length ? { day, seed, items, plan } : null;
  } catch {
    return null;
  }
}

export type KeysDayState = { status: "loading" } | { status: "ready"; day: KeysDay | null };

/** `loadKeysDay` for the page: loading until it answers (or there is no kid to load for). */
export function useKeysDay(userId: string | null, wanted: boolean, authLoading: boolean): KeysDayState {
  const [state, setState] = useState<{ key: string; day: KeysDay | null } | null>(null);
  const key = `${userId ?? ""}:${wanted}`;
  useEffect(() => {
    if (!wanted || authLoading || !userId) return;
    let live = true;
    void loadKeysDay(userId).then((day) => live && setState({ key, day }));
    return () => {
      live = false;
    };
  }, [userId, wanted, authLoading, key]);
  if (!wanted) return { status: "ready", day: null };
  if (authLoading) return { status: "loading" };
  if (!userId) return { status: "ready", day: null };
  return state?.key === key ? { status: "ready", day: state.day } : { status: "loading" };
}
