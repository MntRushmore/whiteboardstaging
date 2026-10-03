"use client";

import { useCallback, useEffect, useSyncExternalStore } from "react";
import { supabase } from "@/lib/supabase";
import { INK_SPENT_EVENT } from "@/lib/api-client";
import { useAuth } from "@/components/AuthProvider";
import { describeError } from "@/lib/errorMessage";
import { parseInkSummary, type InkSummary } from "@/lib/billing/inkSummary";
import type { CheckoutMark } from "@/lib/billing/checkout";
import { initialSection, sectionReducer, type SectionState } from "@/lib/billing/accountState";

export const INK_SUMMARY_FALLBACK = "Couldn't read your ink. Retry in a moment.";

/** How long to wait before the single retry of a transient auth failure. */
export const AUTH_RETRY_DELAY_MS = 700;

/**
 * True for the auth failures that resolve themselves: a token that was minted moments ago and
 * has not propagated yet (a fresh sign-in, or a background refresh), and PostgREST's PGRST303
 * "JWT issued at future" when its clock trails the auth server's. These used to surface as a
 * 401 in the console on every sign-in, which is noise, not information.
 */
export function isRetryableAuthError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const e = error as { code?: unknown; status?: unknown; message?: unknown };
  if (e.code === "PGRST303" || e.code === "PGRST301") return true;
  if (e.status === 401) return true;
  return typeof e.message === "string" && /\bjwt\b/i.test(e.message);
}

export type InkSummaryRpc = () => PromiseLike<{ data: unknown; error: unknown }>;
export type ReadInkSummaryResult = { summary: InkSummary } | { error: string };

/**
 * One ink-summary read, retried once when the failure is a transient auth error.
 * Pure apart from the injected rpc/sleep so it is unit-tested without a browser.
 */
export async function readInkSummary(
  rpc: InkSummaryRpc,
  opts: { retryDelayMs?: number; sleep?: (ms: number) => Promise<void> } = {},
): Promise<ReadInkSummaryResult> {
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const delay = opts.retryDelayMs ?? AUTH_RETRY_DELAY_MS;

  for (let attempt = 0; attempt < 2; attempt++) {
    const { data, error } = await rpc();
    if (error) {
      if (attempt === 0 && isRetryableAuthError(error)) {
        await sleep(delay);
        continue;
      }
      return { error: describeError(error, INK_SUMMARY_FALLBACK) };
    }
    const summary = parseInkSummary(data);
    if (summary) return { summary };
    return { error: INK_SUMMARY_FALLBACK };
  }
  return { error: INK_SUMMARY_FALLBACK };
}

/** Window event that makes every mounted useInkSummary re-read (ink bought, or spent elsewhere). */
export const INK_CHANGED_EVENT = "agathon:ink-changed";
/** localStorage key whose `storage` event tells the app's OTHER tabs to re-read (the board, after checkout). */
export const INK_CHANGED_KEY = "agathon:ink-changed";
/** Window event: a Payment Link was just opened, so watch for the ink to arrive. */
export const INK_CHECKOUT_EVENT = "agathon:ink-checkout";

/** After paid calls, one re-read this long after the last of a burst (2xx answers do not carry the balance). */
export const SPENT_REREAD_MS = 1_500;

/** After a buy button opens Stripe: re-read this often, for this long, until the balance grows. */
export const CHECKOUT_WATCH_MS = 3_000;
export const CHECKOUT_WATCH_FOR_MS = 10 * 60_000;

/**
 * Tell every ink surface on the page (and in the app's other tabs) to re-read: whoever saw the
 * balance change says so.
 */
export function notifyInkChanged(): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new Event(INK_CHANGED_EVENT));
  try {
    window.localStorage.setItem(INK_CHANGED_KEY, String(Date.now()));
  } catch {
    /* storage blocked: this tab still knows */
  }
}

/**
 * localStorage key of the checkout mark: which purchase was the newest when the student left for
 * checkout, so the return page knows the next one is theirs. localStorage, not sessionStorage: the
 * board opens Stripe in a noopener tab, which does not share the board tab's sessionStorage.
 */
export const INK_CHECKOUT_MARK_KEY = "agathon:ink-checkout";
/** An older mark is stale (checkout abandoned). */
export const CHECKOUT_MARK_MAX_AGE_MS = 6 * 60 * 60_000;

/**
 * A buy button opened a Payment Link: remember the purchase the student had (`lastPurchaseId`,
 * null for none) and watch for the new one's ink.
 */
export function watchInkCheckout(lastPurchaseId: number | null): void {
  if (typeof window === "undefined") return;
  try {
    const mark: CheckoutMark = { at: Date.now(), lastPurchaseId };
    window.localStorage.setItem(INK_CHECKOUT_MARK_KEY, JSON.stringify(mark));
  } catch {
    /* storage blocked: the return page falls back to a short time window */
  }
  window.dispatchEvent(new Event(INK_CHECKOUT_EVENT));
}

/** The checkout mark, or null (none, unreadable, or older than CHECKOUT_MARK_MAX_AGE_MS). */
export function readCheckoutMark(now: number = Date.now()): CheckoutMark | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = JSON.parse(window.localStorage.getItem(INK_CHECKOUT_MARK_KEY) ?? "null") as Partial<CheckoutMark> | null;
    if (!raw || typeof raw.at !== "number" || now - raw.at > CHECKOUT_MARK_MAX_AGE_MS || now < raw.at - 60_000) return null;
    return { at: raw.at, lastPurchaseId: typeof raw.lastPurchaseId === "number" ? raw.lastPurchaseId : null };
  } catch {
    return null;
  }
}

/** Forget the mark once its purchase has arrived. */
export function clearCheckoutMark(): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(INK_CHECKOUT_MARK_KEY);
  } catch {
    /* nothing to do */
  }
}

export type UseInkSummaryOptions = {
  /** Re-read on an interval (ms). 0 / undefined = only on the events below and reload(). */
  pollMs?: number;
  /** Skip the request entirely (e.g. while the caller is not signed in). Default true. */
  enabled?: boolean;
};

/**
 * An answer this recent (or a read still in flight) serves a mount, a focus or a tab coming back
 * into view: the header, the account page and the board's meter mount together, a page that swaps
 * its layout remounts the header, and returning to a tab fires both `focus` and
 * `visibilitychange`. Each of those used to be its own `ink_summary` call.
 */
export const INK_FRESH_MS = 5_000;

export interface InkStore {
  subscribe(listener: () => void): () => void;
  getState(): SectionState<InkSummary>;
  /** the user the cached state belongs to (null before the first attach) */
  userId(): string | null;
  /** a consumer for `userId` mounted: read unless fresh; the returned function detaches it */
  attach(userId: string, pollMs?: number): () => void;
  /**
   * Read now unless the last answer is under INK_FRESH_MS old (one in flight is joined). `force`: the
   * balance changed, so always read (once more after one in flight, which may predate the change).
   */
  refresh(force?: boolean): Promise<void>;
  /** a paid call happened: a 402's `remaining` is shown at once, otherwise one re-read once a burst has settled */
  spent(remaining?: number): void;
  /** a buy button opened checkout: re-read every CHECKOUT_WATCH_MS until the balance grows (or CHECKOUT_WATCH_FOR_MS) */
  watchCheckout(): void;
}

export interface InkStoreDeps {
  read: () => Promise<ReadInkSummaryResult>;
  /** wires the window events to the store while anything is attached; returns the unbind */
  bind?: (store: InkStore) => () => void;
  now?: () => number;
}

/**
 * One ink summary per page, shared by every `useInkSummary`: one request in flight at a time, one
 * cached answer, one set of window listeners (installed while any consumer is mounted).
 */
export function createInkStore({ read, bind, now = Date.now }: InkStoreDeps): InkStore {
  let user: string | null = null;
  let state: SectionState<InkSummary> = initialSection<InkSummary>();
  /** bumped when the user changes: a read still in flight for the previous user is dropped */
  let gen = 0;
  let inFlight: Promise<void> | null = null;
  let again = false;
  let readAt = -Infinity;
  let attached = 0;
  let unbind: (() => void) | null = null;
  let spentTimer: ReturnType<typeof setTimeout> | null = null;
  let watch: ReturnType<typeof setInterval> | null = null;
  let watchUntil = 0;
  let watchFrom: number | null = null;
  const listeners = new Set<() => void>();

  const set = (next: SectionState<InkSummary>) => {
    state = next;
    for (const l of listeners) l();
  };
  const stopWatch = () => {
    if (watch) clearInterval(watch);
    watch = null;
    watchFrom = null;
  };
  const start = (): Promise<void> => {
    const g = gen;
    const p = read()
      .catch((): ReadInkSummaryResult => ({ error: INK_SUMMARY_FALLBACK }))
      .then((result) => {
        if (g !== gen) return;
        inFlight = null;
        // a failed read is not an answer: the next mount or focus tries again
        if ("error" in result) set(sectionReducer(state, { type: "failed", message: result.error }));
        else {
          readAt = now();
          set({ status: "ready", data: result.summary, error: null });
          // The checkout watch ends when the ink has arrived (or its time is up).
          if (watch && (now() > watchUntil || (watchFrom !== null && result.summary.balance > watchFrom))) stopWatch();
          if (watch && watchFrom === null) watchFrom = result.summary.balance;
        }
        if (again) {
          again = false;
          void start();
        }
      });
    inFlight = p;
    return p;
  };

  const store: InkStore = {
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    getState: () => state,
    userId: () => user,
    attach(userId, pollMs = 0) {
      if (userId !== user) {
        user = userId;
        gen++;
        inFlight = null;
        again = false;
        readAt = -Infinity;
        stopWatch();
        set(initialSection<InkSummary>());
      }
      if (attached++ === 0 && bind) unbind = bind(store);
      void store.refresh();
      const poll = pollMs > 0 ? setInterval(() => void store.refresh(true), pollMs) : null;
      return () => {
        if (poll) clearInterval(poll);
        if (--attached > 0) return;
        unbind?.();
        unbind = null;
        stopWatch();
        if (spentTimer) clearTimeout(spentTimer);
        spentTimer = null;
      };
    },
    refresh(force = false) {
      if (!user || attached === 0) return Promise.resolve();
      if (inFlight) {
        if (force) again = true;
        return inFlight;
      }
      if (!force && now() - readAt < INK_FRESH_MS) return Promise.resolve();
      return start();
    },
    spent(remaining) {
      const data = state.data;
      if (typeof remaining === "number" && data) {
        // a 402 carries the exact balance (read under the same lock as the refusal)
        set({ status: "ready", data: { ...data, balance: remaining, used: Math.max(0, data.granted - remaining) }, error: null });
        return;
      }
      if (spentTimer) clearTimeout(spentTimer);
      spentTimer = setTimeout(() => void store.refresh(true), SPENT_REREAD_MS);
    },
    watchCheckout() {
      watchUntil = now() + CHECKOUT_WATCH_FOR_MS;
      if (watch) return;
      watch = setInterval(() => void store.refresh(true), CHECKOUT_WATCH_MS);
      void store.refresh(true); // the balance before paying, to know when it grew
    },
  };
  return store;
}

/**
 * The window events the ink surfaces react to, bound once per page: focus / the tab coming back
 * (the student returns from the Stripe tab), INK_CHANGED_EVENT and the other tabs' storage ping,
 * the board's paid calls (INK_SPENT_EVENT from authedFetch) and a buy button opening checkout.
 */
export function bindInkEvents(store: InkStore, win: EventTarget = window, doc: Pick<Document, "visibilityState"> & EventTarget = document): () => void {
  const fresh = () => void store.refresh();
  const changed = () => void store.refresh(true);
  const on: Array<[EventTarget, string, (e: Event) => void]> = [
    [win, "focus", fresh],
    [doc, "visibilitychange", () => doc.visibilityState === "visible" && fresh()],
    [win, INK_CHANGED_EVENT, changed],
    [win, "storage", (e) => (e as StorageEvent).key === INK_CHANGED_KEY && changed()],
    [win, INK_SPENT_EVENT, (e) => store.spent((e as CustomEvent<{ remaining?: number }>).detail?.remaining)],
    [win, INK_CHECKOUT_EVENT, () => store.watchCheckout()],
  ];
  for (const [t, name, fn] of on) t.addEventListener(name, fn);
  return () => {
    for (const [t, name, fn] of on) t.removeEventListener(name, fn);
  };
}

const inkStore = createInkStore({ read: () => readInkSummary(() => supabase.rpc("ink_summary")), bind: (s) => bindInkEvents(s) });
const SIGNED_OUT = initialSection<InkSummary>();

/**
 * The signed-in user's ink via the SECURITY DEFINER RPC `ink_summary()`, read with the user's own
 * JWT. Nothing here can add ink; that happens server-side.
 *
 * Every mounted instance shares one store (`createInkStore`): one request at a time and one cached
 * answer. It is read when the first instance mounts (or one mounts more than INK_FRESH_MS after the
 * last read), on reload(), when the window regains focus or the tab becomes visible again (both
 * deduped by INK_FRESH_MS), on INK_CHANGED_EVENT and the other tabs' storage ping, every `pollMs`
 * when set, and every CHECKOUT_WATCH_MS for up to CHECKOUT_WATCH_FOR_MS after a buy button opened
 * checkout (the webhook usually lands within seconds of paying, often after the student is back),
 * so bought ink appears without a reload. After the board's paid calls (INK_SPENT_EVENT from
 * authedFetch) it re-reads once a burst has settled, and a 402's own `remaining` is shown at once.
 */
export function useInkSummary(options: UseInkSummaryOptions = {}) {
  const { session } = useAuth();
  const enabled = options.enabled !== false && !!session?.access_token;
  const userId = session?.user?.id ?? null;
  const pollMs = options.pollMs ?? 0;

  const shared = useSyncExternalStore(inkStore.subscribe, inkStore.getState, () => SIGNED_OUT);
  // Another account's cached answer is never shown (the store resets when the user changes).
  const state = enabled && inkStore.userId() === userId ? shared : SIGNED_OUT;

  useEffect(() => {
    if (!enabled || !userId) return;
    return inkStore.attach(userId, pollMs);
  }, [enabled, userId, pollMs]);

  const reload = useCallback(() => void inkStore.refresh(true), []);

  return {
    /** Raw section state, for accountPageStateFor(). */
    state,
    summary: state.data,
    /** True until the first read settles (or after reload() until it settles again). */
    loading: enabled && state.status === "loading",
    error: state.status === "error" ? state.error : null,
    reload,
  };
}
