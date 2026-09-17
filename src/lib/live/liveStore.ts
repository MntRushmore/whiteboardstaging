"use client";

import { atom } from "tldraw";
import type { LiveBurst, LiveLineState, LiveStatus, OpenHint, RecognizerKind } from "./contracts";

/** Which network/model call of the Live layer failed. */
export type LiveErrorKind = "capabilities" | "recognize" | "check" | "solve";
/** Why it failed, mapped from the transport / API error contract. */
export type LiveErrorCode = "network" | "unauthorized" | "rate_limited" | "credits" | "upstream" | "timeout" | "unknown";

/**
 * The one visible Live error. It never clears on a timer: only a successful retry, a
 * rewrite of the failed line, a drop of that line, or the student's Dismiss removes it.
 */
export interface LiveError {
  id: string;
  kind: LiveErrorKind;
  code: LiveErrorCode;
  /** student-facing, second person, calm */
  message: string;
  lineId?: string;
  /** rate_limited: how long after `at` a retry makes sense */
  retryAfterMs?: number;
  /** check/solve: the student asked for this (badge tap / More help / Solve steps) */
  userAsked?: boolean;
  at: number;
}

/** Reactive client state of the Live layer (tldraw atoms; read with useValue). */
export const liveStore = {
  status: atom<LiveStatus>("live.status", "idle"),
  recognizer: atom<RecognizerKind>("live.recognizer", "unknown"),
  lines: atom<Record<string, LiveLineState>>("live.lines", {}),
  openHints: atom<OpenHint[]>("live.openHints", []),
  lastBurst: atom<LiveBurst | null>("live.lastBurst", null),
  liveShapeCount: atom<number>("live.shapeCount", 0),
  /** lines whose recognition is waiting for the network to come back */
  offlineQueued: atom<number>("live.offlineQueued", 0),
  /** the most recent failed call, until retried, superseded or dismissed */
  lastError: atom<LiveError | null>("live.lastError", null),
  /** number of open solve streams (status stays 'checking'; the pill says "Solving…") */
  solving: atom<number>("live.solving", 0),
  /**
   * Retry entry point installed by the running loop (LiveController is frozen, so the
   * UI reaches the loop through the store). null when no loop is mounted.
   */
  retryHandler: atom<(() => void) | null>("live.retryHandler", null),
};

let errorSeq = 0;

export function setLiveError(err: Omit<LiveError, "id" | "at"> & { at?: number }): LiveError {
  const full: LiveError = { ...err, id: `e_${++errorSeq}`, at: err.at ?? Date.now() };
  liveStore.lastError.set(full);
  return full;
}

export function clearLiveError(): void {
  if (liveStore.lastError.get() !== null) liveStore.lastError.set(null);
}

/** Runs the loop's retry for the current error (no-op without a loop or an error). */
export function retryLiveError(): void {
  if (!liveStore.lastError.get()) return;
  liveStore.retryHandler.get()?.();
}

export function setLine(id: string, patch: Partial<LiveLineState>): void {
  const all = liveStore.lines.get();
  const prev = all[id];
  if (!prev && !patch.line) return;
  liveStore.lines.set({
    ...all,
    [id]: { ...(prev as LiveLineState), ...patch, updatedAt: Date.now() },
  });
}

export function removeLine(id: string): void {
  const { [id]: _gone, ...rest } = liveStore.lines.get();
  void _gone;
  liveStore.lines.set(rest);
  liveStore.openHints.set(liveStore.openHints.get().filter((h) => h.lineId !== id));
  const err = liveStore.lastError.get();
  if (err?.lineId === id) liveStore.lastError.set(null);
}

export function markBurst(state: LiveBurst["state"]): void {
  liveStore.lastBurst.set({ at: Date.now(), state });
}

/** true when the legacy image pipeline should stay silent for the current idle window */
export function legacyShouldSkip(idleMs: number): boolean {
  const b = liveStore.lastBurst.get();
  return !!b && Date.now() - b.at <= idleMs + 1000 && b.state !== "unhandled";
}

export function resetLiveStore(): void {
  liveStore.status.set("idle");
  liveStore.recognizer.set("unknown");
  liveStore.lines.set({});
  liveStore.openHints.set([]);
  liveStore.lastBurst.set(null);
  liveStore.liveShapeCount.set(0);
  liveStore.offlineQueued.set(0);
  liveStore.lastError.set(null);
  liveStore.solving.set(0);
}
