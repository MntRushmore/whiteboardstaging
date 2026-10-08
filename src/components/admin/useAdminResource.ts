"use client";

import { useCallback, useEffect, useSyncExternalStore } from "react";
import type { ZodType, ZodTypeDef } from "zod";
import { readAdmin } from "./adminData";

/** What a page knows about one admin route's answer. */
export interface ResourceState<T> {
  data: T | null;
  /** a read is in flight (the first, or a refresh: the last answer stays on screen) */
  loading: boolean;
  /** the last read failed (with data from before, the page keeps it and says so) */
  error: string | null;
  /** the server says this does not exist for this user (not an admin; or no such record) */
  notFound: boolean;
  /** signed out under us: the page goes to /login */
  signedOut: boolean;
  /** when the last good answer arrived (ms) */
  readAt: number | null;
}

const UNREAD: ResourceState<never> = { data: null, loading: true, error: null, notFound: false, signedOut: false, readAt: null };

interface Entry {
  state: ResourceState<unknown>;
  inFlight: Promise<void> | null;
  listeners: Set<() => void>;
  /** bumped by every local change: a read that started before one does not overwrite it */
  generation: number;
}

/**
 * One shared copy of each route's answer per tab, keyed by URL: the nav's counts and the bug inbox
 * read the same list once, a change made on one page shows on every other at once, and going back
 * to a page shows what it had while it reads again.
 */
const entries = new Map<string, Entry>();

function entryFor(url: string): Entry {
  let e = entries.get(url);
  if (!e) {
    e = { state: UNREAD, inFlight: null, listeners: new Set(), generation: 0 };
    entries.set(url, e);
  }
  return e;
}

function update(e: Entry, patch: Partial<ResourceState<unknown>>) {
  e.state = { ...e.state, ...patch };
  e.listeners.forEach((l) => l());
}

/** Reads `url` (one read at a time per URL; a second ask joins the first). */
export function loadResource<T>(url: string, schema: ZodType<T, ZodTypeDef, unknown>): Promise<void> {
  const e = entryFor(url);
  if (e.inFlight) return e.inFlight;
  const startedAt = e.generation;
  const run = (async () => {
    update(e, { loading: true });
    const res = await readAdmin(url, schema);
    // changed here while the read was out: the local change is newer than this answer
    if (e.generation !== startedAt && res.kind === "data") return update(e, { loading: false });
    if (res.kind === "data") update(e, { data: res.data, error: null, notFound: false, signedOut: false, loading: false, readAt: Date.now() });
    else if (res.kind === "notFound") update(e, { notFound: true, error: null, loading: false });
    else if (res.kind === "signedOut") update(e, { signedOut: true, error: null, loading: false });
    else update(e, { error: res.error, loading: false });
  })().finally(() => {
    e.inFlight = null;
  });
  e.inFlight = run;
  return run;
}

/** Reads `url` again from scratch: after any read already out (which may predate a change on the server). */
export async function reloadResource<T>(url: string, schema: ZodType<T, ZodTypeDef, unknown>): Promise<void> {
  const out = entries.get(url)?.inFlight;
  if (out) await out;
  await loadResource(url, schema);
}

/**
 * Changes every loaded answer whose URL `match`es, at once (an optimistic update, or putting it
 * back). Reads already out when this runs keep their answers to themselves.
 */
export function mutateResources<T>(match: (url: string) => boolean, change: (data: T) => T): void {
  for (const [url, e] of entries) {
    if (!match(url) || e.state.data === null) continue;
    e.generation += 1;
    update(e, { data: change(e.state.data as T) });
  }
}

/** What is known of `url` right now (outside React). */
export function peekResource<T>(url: string): ResourceState<T> {
  return (entries.get(url)?.state ?? UNREAD) as ResourceState<T>;
}

/** Tests only. */
export function resetResources(): void {
  entries.clear();
}

/** A read this recent is fresh enough to show without reading again on mount. */
const FRESH_MS = 15_000;

/**
 * An admin route's answer for the page: read when the page opens (unless a fresh copy is already
 * here), every `pollMs` while the tab is visible, at once when the tab comes back after longer than
 * that, and on `refresh`. `url` null waits (not signed in yet, or not allowed). `pollMs` 0: no
 * polling.
 */
export function useAdminResource<T>(
  url: string | null,
  schema: ZodType<T, ZodTypeDef, unknown>,
  { pollMs = 60_000 }: { pollMs?: number } = {},
): ResourceState<T> & { refresh: () => void } {
  const subscribe = useCallback(
    (listener: () => void) => {
      if (!url) return () => {};
      const e = entryFor(url);
      e.listeners.add(listener);
      return () => {
        e.listeners.delete(listener);
      };
    },
    [url],
  );
  const state = useSyncExternalStore(
    subscribe,
    () => (url ? (entries.get(url)?.state ?? UNREAD) : UNREAD),
    () => UNREAD,
  ) as ResourceState<T>;

  useEffect(() => {
    if (!url) return;
    const e = entryFor(url);
    const age = () => (e.state.readAt === null ? Infinity : Date.now() - e.state.readAt);
    const first = window.setTimeout(() => {
      if (age() >= Math.min(FRESH_MS, pollMs || FRESH_MS) || e.state.error) void loadResource(url, schema);
    }, 0);
    const timer =
      pollMs > 0
        ? window.setInterval(() => {
            if (document.visibilityState === "visible") void loadResource(url, schema);
          }, pollMs)
        : 0;
    const onVisible = () => {
      if (document.visibilityState === "visible" && pollMs > 0 && age() >= pollMs) void loadResource(url, schema);
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.clearTimeout(first);
      if (timer) window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [url, schema, pollMs]);

  const refresh = useCallback(() => {
    if (url) void loadResource(url, schema);
  }, [url, schema]);

  return { ...state, refresh };
}
