"use client";

/**
 * The family features' calls to /api/family, from the browser, and the switch itself. The reader
 * (`loadFamily`) never throws: a family it cannot read is `null`, and the app bar then shows no
 * switcher rather than an error. The writers throw ApiError (src/lib/api-client.ts) so the Family
 * page can say what went wrong.
 *
 * The family is kept for the tab (memory, and sessionStorage for reloads) for FAMILY_CACHE_MS, keyed
 * by the signed-in user: the app bar's switcher reads it on every page, and a family rarely changes.
 * The Family page's writes drop it and say so (FAMILY_CHANGED_EVENT), so the app bar's switcher
 * appears with the first kid; every switch drops it too.
 *
 * Switching: the server mints the other profile's session (POST /api/family/switch), the browser
 * takes it with `supabase.auth.setSession`, and the page reloads at `to` (the home by default): every
 * read the old profile made (boards, the plan, the learning record) belongs to someone else now, and
 * a full load is the one state that can be trusted. The session is shared by every tab, so every
 * other open tab leaves for the home too (AuthProvider, src/lib/authUserChange.ts).
 */
import { apiErrorFromResponse, authedFetch } from "@/lib/api-client";
import { markProfileSwitch } from "@/lib/authUserChange";
import { supabase } from "@/lib/supabase";
import type { AddKidInput, FamilyMember, FamilyState, SwitchResult } from "./contracts";
import { parseFamilyState } from "./members";
import type { EditKidInput } from "./schemas";

export const FAMILY_API = "/api/family";
export const FAMILY_PATH = "/family";
export const FAMILY_CACHE_MS = 5 * 60_000;
const CACHE_KEY = "agathon.family.v1";

type Cached = { userId: string; at: number; state: FamilyState };
let memory: Cached | null = null;
let inFlight: { userId: string; promise: Promise<FamilyState | null> } | null = null;

function session(): Storage | null {
  try {
    return typeof sessionStorage === "undefined" ? null : sessionStorage;
  } catch {
    return null;
  }
}

function fresh(c: Cached | null, userId: string, now: number): FamilyState | null {
  return c && c.userId === userId && now - c.at < FAMILY_CACHE_MS ? c.state : null;
}

/** The family kept for this tab, if fresh (no network). */
export function cachedFamily(userId: string, now = Date.now()): FamilyState | null {
  const hit = fresh(memory, userId, now);
  if (hit) return hit;
  try {
    const raw = session()?.getItem(CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { userId?: unknown; at?: unknown; state?: unknown };
    const state = parseFamilyState(parsed.state);
    if (!state || typeof parsed.userId !== "string" || typeof parsed.at !== "number") return null;
    memory = { userId: parsed.userId, at: parsed.at, state };
    return fresh(memory, userId, now);
  } catch {
    return null;
  }
}

/** Window event after the family changed (a kid added, edited or removed, the PIN set): readers re-read. */
export const FAMILY_CHANGED_EVENT = "agathon:family-changed";

function clearKept(): void {
  memory = null;
  inFlight = null;
  try {
    session()?.removeItem(CACHE_KEY);
  } catch {
    /* private mode */
  }
}

/** Forget the kept family after a write, and tell every reader on the page to read it again. */
export function forgetFamily(): void {
  clearKept();
  if (typeof window !== "undefined") {
    try {
      window.dispatchEvent(new Event(FAMILY_CHANGED_EVENT));
    } catch {
      /* no Event(): the next page load reads it */
    }
  }
}

function keep(userId: string, state: FamilyState): void {
  memory = { userId, at: Date.now(), state };
  try {
    session()?.setItem(CACHE_KEY, JSON.stringify(memory));
  } catch {
    /* private mode: memory only */
  }
}

/**
 * The signed-in user's family: the kept one when fresh (unless `force`), else GET /api/family.
 * Null when it cannot be read. One request at a time per user.
 */
export async function loadFamily(userId: string, opts: { force?: boolean } = {}): Promise<FamilyState | null> {
  if (!opts.force) {
    const hit = cachedFamily(userId);
    if (hit) return hit;
    if (inFlight?.userId === userId) return inFlight.promise;
  }
  const promise = read(userId);
  const entry = { userId, promise };
  inFlight = entry;
  void promise.finally(() => {
    if (inFlight === entry) inFlight = null;
  });
  return promise;
}

async function read(userId: string): Promise<FamilyState | null> {
  try {
    const res = await authedFetch(`${FAMILY_API}?tz=${new Date().getTimezoneOffset()}`, { cache: "no-store" });
    if (!res.ok) return null;
    const state = parseFamilyState(await res.json());
    if (!state || state.me !== userId) return null;
    keep(userId, state);
    return state;
  } catch {
    return null;
  }
}

async function send<T>(path: string, method: string, body?: unknown): Promise<T> {
  const res = await authedFetch(path, {
    method,
    headers: body === undefined ? undefined : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!res.ok) throw await apiErrorFromResponse(res);
  forgetFamily();
  return (await res.json()) as T;
}

/** Set or change the grown-up's PIN. */
export function savePin(pin: string): Promise<{ hasPin: true }> {
  return send(`${FAMILY_API}/pin`, "POST", { pin });
}

/** Add a kid profile; the new member. */
export function addKid(input: AddKidInput): Promise<FamilyMember> {
  return send(`${FAMILY_API}/kids`, "POST", input);
}

export function editKid(kidId: string, patch: EditKidInput): Promise<{ updated: true }> {
  return send(`${FAMILY_API}/kids/${encodeURIComponent(kidId)}`, "PATCH", patch);
}

/** Delete a kid's profile and everything in it. */
export function removeKid(kidId: string): Promise<{ removed: true }> {
  return send(`${FAMILY_API}/kids/${encodeURIComponent(kidId)}`, "DELETE");
}

/** Delete every kid of the caller's family (the first step of deleting the grown-up's account). */
export function removeAllKids(): Promise<{ removed: number }> {
  return send(FAMILY_API, "DELETE");
}

/**
 * Become `to` (a member of the signed-in user's family), with the grown-up's PIN when `to` is the
 * grown-up, then load `dest`. Throws ApiError for a refusal (wrong PIN: status 403 with
 * `body.reason === "wrong_pin"` and `body.triesLeft`; too many tries: 429) or the session's error.
 * Resolves only when the page is about to reload.
 */
export async function switchProfile(to: string, opts: { pin?: string; dest?: string } = {}): Promise<void> {
  const res = await authedFetch(`${FAMILY_API}/switch`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ to, ...(opts.pin ? { pin: opts.pin } : {}) }),
  });
  if (!res.ok) throw await apiErrorFromResponse(res);
  const tokens = (await res.json()) as SwitchResult;
  // the page reloads as `to`: nothing on it should read the family again as the old profile
  clearKept();
  // Every other open tab sees the new session and leaves for the home (AuthProvider,
  // src/lib/authUserChange.ts); this one is marked so it goes to `dest` instead.
  markProfileSwitch(true);
  try {
    const { error } = await supabase.auth.setSession({ access_token: tokens.access_token, refresh_token: tokens.refresh_token });
    if (error) throw error;
  } catch (err) {
    markProfileSwitch(false);
    throw err;
  }
  window.location.assign(safeDest(opts.dest));
}

/** Only this app's own paths: never a full URL from anywhere. */
export function safeDest(dest: string | undefined): string {
  return dest && dest.startsWith("/") && !dest.startsWith("//") ? dest : "/";
}
