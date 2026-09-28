"use client";

import { atom } from "tldraw";
import type { RecognizeResponse } from "./contracts";

/**
 * Dev-only record of what the recognizer was sent and what it said, per line, for the Live
 * debug panel. Nothing here is read by the loop's decisions: it is a window onto them.
 */

export interface LiveDebugRecord {
  lineId: string;
  at: number;
  /** the stroke payload exactly as posted to /api/live/recognize (normalized ints) */
  sent: { x: number[][]; y: number[][]; w: number; h: number };
  /** true when the answer came from the client's content cache (no network) */
  cached: boolean;
  response: RecognizeResponse;
  /** the second reader, when a signal sent this line to it (`src/lib/live/readCheck.ts`) */
  reread?: LiveRereadRecord;
}

export interface LiveRereadRecord {
  /** why it was asked: `unreadable`, `low-confidence`, or the `suspiciousRead` rule */
  signal: string;
  /** Mathpix's LaTeX it was shown */
  mathpix: string;
  /** what the second reader returned ('' when the call failed) */
  latex: string;
  /** true when its LaTeX replaced Mathpix's on the board */
  accepted: boolean;
  model?: string;
  ms?: number;
  /** why there is no answer (no crop, network, upstream) */
  error?: string;
}

const STORAGE_KEY = "agathon.liveDebug";

/** On in development; in any build, `localStorage["agathon.liveDebug"] = "1"` turns it on too. */
export function liveDebugEnabled(): boolean {
  if (process.env.NODE_ENV !== "production") return true;
  try {
    return typeof window !== "undefined" && window.localStorage.getItem(STORAGE_KEY) === "1";
  } catch {
    return false;
  }
}

/** Newest record per line; capped so a long session does not grow without bound. */
export const liveDebugStore = atom<Record<string, LiveDebugRecord>>("live.debug", {});
const MAX_RECORDS = 200;

export function recordRecognition(rec: LiveDebugRecord): void {
  if (!liveDebugEnabled()) return;
  const next = { ...liveDebugStore.get(), [rec.lineId]: rec };
  const ids = Object.keys(next);
  if (ids.length > MAX_RECORDS) {
    for (const id of ids.sort((a, b) => next[a].at - next[b].at).slice(0, ids.length - MAX_RECORDS)) delete next[id];
  }
  liveDebugStore.set(next);
}

/** Adds the second reader's answer to the line's record (both reads stay visible in the panel). */
export function recordReread(lineId: string, reread: LiveRereadRecord): void {
  if (!liveDebugEnabled()) return;
  const cur = liveDebugStore.get()[lineId];
  if (!cur) return;
  liveDebugStore.set({ ...liveDebugStore.get(), [lineId]: { ...cur, reread } });
}
