"use client";

import { useEffect, useSyncExternalStore } from "react";
import { supabase } from "@/lib/supabase";

/**
 * The dot on the app header's Report a bug: how many of our replies the signed-in user has not
 * opened (my_bug_unread_count(), 20261009160000_bug_replies.sql). Asked once the page is idle and
 * again when the tab comes back into view, at most every REFRESH_MS; never for a signed-out visitor
 * (no user id: nothing is asked). /reports sets it to 0 once it has marked the replies read.
 *
 * Small on purpose, and only the app header imports it: the header is on every platform page, and
 * the board's own Report a bug never loads it. A failed ask (offline, the function missing) leaves
 * the last count as it was: the dot is a hint, never an error.
 */

/** How often the count may be asked again (focus, a page change), per user. */
export const REFRESH_MS = 60_000;

type Kept = { userId: string; count: number; at: number };

let kept: Kept | null = null;
let inFlight: { userId: string; run: Promise<number | null> } | null = null;
const listeners = new Set<() => void>();

const announce = () => listeners.forEach((l) => l());

/** The RPC call, as the store makes it (tests pass their own). */
export type UnreadAsk = () => PromiseLike<{ data: unknown; error: unknown }>;

const askSupabase: UnreadAsk = () => supabase.rpc("my_bug_unread_count");

/**
 * Asks how many replies `userId` has not opened, unless it was asked less than REFRESH_MS ago.
 * Null without a user (nothing is asked) or when the answer is unusable.
 */
export async function refreshBugUnread(userId: string | null | undefined, ask: UnreadAsk = askSupabase, now: number = Date.now()): Promise<number | null> {
  if (!userId) return null;
  if (kept?.userId === userId && now - kept.at < REFRESH_MS) return kept.count;
  if (inFlight?.userId === userId) return inFlight.run;
  const run = (async () => {
    // after inFlight is set below, whatever `ask` does
    await Promise.resolve();
    try {
      const { data, error } = await ask();
      if (error || typeof data !== "number" || !Number.isFinite(data) || data < 0) return null;
      kept = { userId, count: Math.round(data), at: now };
      announce();
      return kept.count;
    } catch {
      return null;
    } finally {
      inFlight = null;
    }
  })();
  inFlight = { userId, run };
  return run;
}

/** Set the count at once (/reports: 0, once the replies are marked read). */
export function setBugUnread(userId: string, count: number, now: number = Date.now()): void {
  kept = { userId, count: Math.max(0, Math.round(count)), at: now };
  announce();
}

/** The count known for `userId`, 0 when nothing is known (or no user). */
export function bugUnreadSnapshot(userId: string | null | undefined): number {
  return userId && kept?.userId === userId ? kept.count : 0;
}

type IdleWindow = Window & { requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => number; cancelIdleCallback?: (handle: number) => void };

/** The count for the header's dot: 0 until known, and always 0 signed out. */
export function useBugUnread(userId: string | null | undefined): number {
  const count = useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => bugUnreadSnapshot(userId),
    () => 0,
  );

  useEffect(() => {
    if (!userId) return;
    const ask = () => void refreshBugUnread(userId);
    const onVisible = () => {
      if (document.visibilityState === "visible") ask();
    };
    const w = window as IdleWindow;
    const idle = w.requestIdleCallback?.(ask, { timeout: 4_000 });
    const timer = idle === undefined ? window.setTimeout(ask, 1_500) : undefined;
    window.addEventListener("focus", ask);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      if (idle !== undefined) w.cancelIdleCallback?.(idle);
      if (timer !== undefined) window.clearTimeout(timer);
      window.removeEventListener("focus", ask);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [userId]);

  return count;
}

/** Tests only. */
export function resetBugUnread(): void {
  kept = null;
  inFlight = null;
}
