"use client";

import { atom } from "tldraw";
import type { LiveBurst, LiveLineState, LiveStatus, OpenHint, RecognizerKind } from "./contracts";

/** Reactive client state of the Live layer (tldraw atoms; read with useValue). */
export const liveStore = {
  status: atom<LiveStatus>("live.status", "idle"),
  recognizer: atom<RecognizerKind>("live.recognizer", "unknown"),
  lines: atom<Record<string, LiveLineState>>("live.lines", {}),
  openHints: atom<OpenHint[]>("live.openHints", []),
  lastBurst: atom<LiveBurst | null>("live.lastBurst", null),
  liveShapeCount: atom<number>("live.shapeCount", 0),
};

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
  liveStore.lines.set({});
  liveStore.openHints.set([]);
  liveStore.lastBurst.set(null);
  liveStore.liveShapeCount.set(0);
}
