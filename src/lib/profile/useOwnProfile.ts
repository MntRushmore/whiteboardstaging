"use client";

import { useEffect, useSyncExternalStore } from "react";
import { supabase } from "@/lib/supabase";
import { parseOwnProfile, PROFILE_CHANGED_EVENT, type OwnProfile, type ProfileChange } from "./displayName";

/**
 * The signed-in user's own profile (display name and picture) for the app bar: one small read of
 * `profiles` per page load, kept for the tab (memory, and sessionStorage so a reload shows the name
 * at once while it reads again), keyed by the user. The header remounts on every page; the read
 * does not repeat. ProfileCard's save says so (PROFILE_CHANGED_EVENT) and the kept copy takes the
 * new name at once.
 *
 * `undefined` until the first read lands (nothing kept), `null` when it could not be read (the
 * header falls back: src/lib/profile/displayName.ts `headerName`).
 */

type Kept = { userId: string; profile: OwnProfile | null; fresh: boolean; failed: boolean };

const CACHE_KEY = "agathon.profile.v1";
const RETRY_MS = 700;

let kept: Kept | null = null;
let inFlight: string | null = null;
const listeners = new Set<() => void>();

function session(): Storage | null {
  try {
    return typeof sessionStorage === "undefined" ? null : sessionStorage;
  } catch {
    return null;
  }
}

function fromSession(userId: string): OwnProfile | null {
  try {
    const raw = JSON.parse(session()?.getItem(CACHE_KEY) ?? "null") as { userId?: unknown; profile?: unknown } | null;
    if (!raw || raw.userId !== userId) return null;
    const p = raw.profile as Record<string, unknown> | null;
    return p && typeof p === "object" ? parseOwnProfile({ display_name: p.displayName, avatar: p.avatar }) : null;
  } catch {
    return null;
  }
}

function keep(next: Kept): void {
  kept = next;
  if (next.profile) {
    try {
      session()?.setItem(CACHE_KEY, JSON.stringify({ userId: next.userId, profile: next.profile }));
    } catch {
      /* storage blocked: memory still has it */
    }
  }
  for (const listener of listeners) listener();
}

/** What the store says for `userId` now (a stable reference between changes). */
function snapshot(userId: string | null | undefined): OwnProfile | null | undefined {
  if (!userId) return undefined;
  if (kept?.userId !== userId) {
    // a reload in this tab: the copy kept from before, shown while the fresh read is under way
    const cached = fromSession(userId);
    if (!cached) return undefined;
    kept = { userId, profile: cached, fresh: false, failed: false };
  }
  return kept.failed && !kept.profile ? null : kept.profile;
}

const pause = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

async function readProfile(userId: string): Promise<OwnProfile | null> {
  const select = (columns: string) => supabase.from("profiles").select(columns).eq("user_id", userId).maybeSingle();
  let res = await select("display_name, avatar");
  // a database without profiles.avatar yet (20261009000000_kids_come_back.sql): the name alone
  if (res.error && (res.error as { code?: string }).code === "42703") res = await select("display_name");
  // a token minted moments ago (a fresh sign-in) can be refused once; the second ask is fine
  else if (res.error) {
    await pause(RETRY_MS);
    res = await select("display_name, avatar");
  }
  if (res.error) return null;
  return parseOwnProfile(res.data);
}

function ensureRead(userId: string): void {
  if (inFlight === userId) return;
  if (kept?.userId === userId && kept.fresh && !kept.failed) return;
  inFlight = userId;
  void readProfile(userId).then((profile) => {
    if (inFlight === userId) inFlight = null;
    const before = kept?.userId === userId ? kept.profile : null;
    keep(profile ? { userId, profile, fresh: true, failed: false } : { userId, profile: before, fresh: true, failed: true });
  });
}

function onChange(event: Event): void {
  const change = (event as CustomEvent<ProfileChange>).detail;
  if (!change || typeof change.userId !== "string") return;
  const base: OwnProfile = (kept?.userId === change.userId ? kept.profile : null) ?? { displayName: null, avatar: null };
  const profile = parseOwnProfile({
    display_name: change.displayName !== undefined ? change.displayName : base.displayName,
    avatar: change.avatar !== undefined ? change.avatar : base.avatar,
  });
  keep({ userId: change.userId, profile, fresh: kept?.userId === change.userId ? kept.fresh : false, failed: false });
}

function subscribe(listener: () => void): () => void {
  if (listeners.size === 0) window.addEventListener(PROFILE_CHANGED_EVENT, onChange);
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) window.removeEventListener(PROFILE_CHANGED_EVENT, onChange);
  };
}

/** The signed-in user's own profile: see the module comment. */
export function useOwnProfile(userId: string | null | undefined): OwnProfile | null | undefined {
  const profile = useSyncExternalStore(
    subscribe,
    () => snapshot(userId),
    () => undefined,
  );
  useEffect(() => {
    if (userId) ensureRead(userId);
  }, [userId]);
  return profile;
}
