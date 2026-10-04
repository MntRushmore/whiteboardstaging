"use client";

import { atom } from "tldraw";
import type { LiveLineState, LiveStatus, OpenHint, RecognizerKind, Rect } from "./contracts";

/** A drawing on the screen as the dev panel shows it (`src/lib/live/diagrams.ts`). */
export interface LiveDiagram {
  id: string;
  kinds: string[];
  bounds: Rect;
  strokes: number;
  labels: number;
  /** its labels as the recognizer read them, one per label; null until read */
  read: string[] | null;
}

/** Which network/model call of the Live layer failed. */
export type LiveErrorKind = "capabilities" | "recognize" | "check" | "solve";
/** Why it failed, mapped from the transport / API error contract. */
export type LiveErrorCode = "network" | "unauthorized" | "rate_limited" | "ink" | "upstream" | "timeout" | "unknown";

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
  /** optional second line under the message */
  detail?: string;
  lineId?: string;
  /** rate_limited: how long after `at` a retry makes sense */
  retryAfterMs?: number;
  /** check/solve: the student asked for this (badge tap / More help / Solve steps) */
  userAsked?: boolean;
  /** ink (402): what the refused call costs (the 402's `cost`), so the error stays until it is affordable */
  inkNeeded?: number;
  at: number;
}

/** Reactive client state of the Live layer (tldraw atoms; read with useValue). */
export const liveStore = {
  status: atom<LiveStatus>("live.status", "idle"),
  recognizer: atom<RecognizerKind>("live.recognizer", "unknown"),
  lines: atom<Record<string, LiveLineState>>("live.lines", {}),
  /** the drawings on the screen: never recognized or marked; their labels are read as context */
  diagrams: atom<LiveDiagram[]>("live.diagrams", []),
  openHints: atom<OpenHint[]>("live.openHints", []),
  liveShapeCount: atom<number>("live.shapeCount", 0),
  /** lines whose recognition is waiting for the network to come back */
  offlineQueued: atom<number>("live.offlineQueued", 0),
  /** the most recent failed call, until retried, superseded or dismissed */
  lastError: atom<LiveError | null>("live.lastError", null),
  /** number of open solve streams (status stays 'checking'; the pill says "Solving…") */
  solving: atom<number>("live.solving", 0),
  /**
   * The ink left as the board's meter last read it (Infinity with Agathon Unlimited), null until
   * it has: Auto spends nothing while it is 0 (`noteInkBalance`).
   */
  inkBalance: atom<number | null>("live.inkBalance", null),
  /**
   * Lines just read (by line id, when): their typeset readback shows for `LIVE_TIMING.readbackMs`
   * even with the pen in hand — the sign the tutor saw the line (`MathShapeUtil`).
   */
  readbacks: atom<Record<string, number>>("live.readbacks", {}),
  /**
   * Retry entry point installed by the running loop (LiveController is frozen, so the
   * UI reaches the loop through the store). null when no loop is mounted.
   */
  retryHandler: atom<(() => void) | null>("live.retryHandler", null),
  /**
   * Finishes every pen of the tutor's in place, installed by the running loop: deleting a screen
   * calls it first so a step half written there is neither carried to the next screen nor brought
   * back half written by Undo (`deleteScreen`). null when no loop is mounted.
   */
  finishWriting: atom<(() => void) | null>("live.finishWriting", null),
};

let errorSeq = 0;

export function setLiveError(err: Omit<LiveError, "id" | "at"> & { at?: number }): LiveError {
  const full: LiveError = { ...err, id: `e_${++errorSeq}`, at: err.at ?? Date.now() };
  liveStore.lastError.set(full);
  return full;
}

/**
 * The board's meter saw the balance: an "out of ink" error goes once the balance covers the call
 * that was refused (its `inkNeeded`; 1 when the server did not say). A balance of 5 does not
 * clear a refused worked solution (10).
 *
 * Ink being back also does what was refused, once, through the running loop's retry: the line
 * written while the student had none is read (and checked) now, and a Solve or Help they asked
 * for runs. Before, it stayed unread after they bought ink, until they wrote it out again.
 */
export function clearInkErrorIfAffordable(balance: number): void {
  const current = liveStore.lastError.get();
  if (current?.code !== "ink" || balance < Math.max(1, current.inkNeeded ?? 1)) return;
  liveStore.retryHandler.get()?.();
  // the retry may already have replaced the error with its own outcome; otherwise it goes now
  if (liveStore.lastError.get()?.id === current.id) liveStore.lastError.set(null);
}

/**
 * The board's meter read the balance: Auto knows whether it may spend (an unasked model call with
 * no ink would only open the ink dialog unasked), and an "out of ink" error goes once it is covered.
 */
export function noteInkBalance(balance: number): void {
  liveStore.inkBalance.set(balance);
  clearInkErrorIfAffordable(balance);
}

export function clearLiveError(code?: LiveErrorCode): void {
  const current = liveStore.lastError.get();
  if (current !== null && (code === undefined || current.code === code)) liveStore.lastError.set(null);
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

export function resetLiveStore(): void {
  liveStore.status.set("idle");
  liveStore.recognizer.set("unknown");
  liveStore.lines.set({});
  liveStore.diagrams.set([]);
  liveStore.openHints.set([]);
  liveStore.liveShapeCount.set(0);
  liveStore.offlineQueued.set(0);
  liveStore.lastError.set(null);
  liveStore.solving.set(0);
  liveStore.readbacks.set({});
}
