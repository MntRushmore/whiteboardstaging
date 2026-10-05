"use client";

import { useEffect, useSyncExternalStore } from "react";
import { supabase } from "@/lib/supabase";

/**
 * Is the signed-in user an admin? `is_admin()` (an RPC callable by authenticated), asked once per
 * user per tab session and remembered in sessionStorage, so a page load after the first costs
 * nothing. The app header asks lazily, once the page is idle, so the menu's "Admin" item never
 * delays anything a student sees; the /admin page asks at once.
 *
 * Only a hint for what to show: the overview route checks again on the server (a non-admin gets
 * 404 there whatever this says). A failed check (offline, the function missing) is not remembered
 * and reads as "not known" (null).
 */
const STORAGE_PREFIX = "agathon.isAdmin.";

const known = new Map<string, boolean>();
const pending = new Map<string, Promise<boolean | null>>();
const listeners = new Set<() => void>();

function readStored(userId: string): boolean | null {
  try {
    const v = window.sessionStorage.getItem(STORAGE_PREFIX + userId);
    return v === "1" ? true : v === "0" ? false : null;
  } catch {
    return null;
  }
}

function snapshot(userId: string | undefined): boolean | null {
  if (!userId) return null;
  const hit = known.get(userId);
  if (hit !== undefined) return hit;
  const stored = typeof window === "undefined" ? null : readStored(userId);
  if (stored !== null) known.set(userId, stored);
  return stored;
}

/** Asks `is_admin()` (once at a time per user) and remembers a real answer. */
export function checkIsAdmin(userId: string): Promise<boolean | null> {
  const hit = snapshot(userId);
  if (hit !== null) return Promise.resolve(hit);
  const inFlight = pending.get(userId);
  if (inFlight) return inFlight;
  const run = (async () => {
    try {
      const { data, error } = await supabase.rpc("is_admin");
      if (error || typeof data !== "boolean") return null;
      known.set(userId, data);
      try {
        window.sessionStorage.setItem(STORAGE_PREFIX + userId, data ? "1" : "0");
      } catch {
        // private mode: remembered for this page only
      }
      listeners.forEach((l) => l());
      return data;
    } catch {
      return null;
    } finally {
      pending.delete(userId);
    }
  })();
  pending.set(userId, run);
  return run;
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

type IdleWindow = Window & {
  requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => number;
  cancelIdleCallback?: (handle: number) => void;
};

/**
 * True or false once known, null before (and after a failed check). `lazy` waits for the page to
 * be idle (at most 4 s) before asking.
 */
export function useIsAdmin(userId: string | undefined, { lazy = true }: { lazy?: boolean } = {}): boolean | null {
  const value = useSyncExternalStore(
    subscribe,
    () => snapshot(userId),
    () => null,
  );

  useEffect(() => {
    if (!userId || snapshot(userId) !== null) return;
    if (!lazy) {
      void checkIsAdmin(userId);
      return;
    }
    const w = window as IdleWindow;
    if (w.requestIdleCallback && w.cancelIdleCallback) {
      const handle = w.requestIdleCallback(() => void checkIsAdmin(userId), { timeout: 4_000 });
      return () => w.cancelIdleCallback?.(handle);
    }
    const timer = window.setTimeout(() => void checkIsAdmin(userId), 1_500);
    return () => window.clearTimeout(timer);
  }, [userId, lazy]);

  return value;
}

/** Tests only. */
export function resetIsAdminCache(): void {
  known.clear();
  pending.clear();
}
