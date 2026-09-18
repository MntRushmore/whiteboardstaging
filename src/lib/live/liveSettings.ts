"use client";

import { useCallback, useSyncExternalStore } from "react";

/** Per-device Live Math preferences (independent of the help-mode tabs). */
export type LiveSettings = {
  enabled: boolean;
  /** hide echoes/graphs/AI steps without deleting them */
  hideAiShapes: boolean;
  /**
   * The tutor writes worked steps as handwriting on the canvas instead of placing a typeset
   * math shape. Off falls back to the typeset steps, as does any line the hand engine cannot
   * draw (see `unsupported` in src/lib/hand).
   */
  handwriting: boolean;
};

export const DEFAULT_LIVE_SETTINGS: LiveSettings = { enabled: true, hideAiShapes: false, handwriting: true };

const STORAGE_KEY = "agathon.live.v1";
const listeners = new Set<() => void>();
let cached: LiveSettings | null = null;

function read(): LiveSettings {
  if (cached) return cached;
  if (typeof window === "undefined") return DEFAULT_LIVE_SETTINGS;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    cached = raw ? { ...DEFAULT_LIVE_SETTINGS, ...(JSON.parse(raw) as Partial<LiveSettings>) } : DEFAULT_LIVE_SETTINGS;
  } catch {
    cached = DEFAULT_LIVE_SETTINGS;
  }
  return cached;
}

function write(next: LiveSettings): void {
  cached = next;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    /* quota / private mode: keep in memory */
  }
  listeners.forEach((l) => l());
}

function subscribe(cb: () => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

export function getLiveSettings(): LiveSettings {
  return read();
}

export function updateLiveSettings(patch: Partial<LiveSettings>): void {
  write({ ...read(), ...patch });
}

export function useLiveSettings(): {
  settings: LiveSettings;
  update: (patch: Partial<LiveSettings>) => void;
} {
  const settings = useSyncExternalStore(subscribe, read, () => DEFAULT_LIVE_SETTINGS);
  const update = useCallback((patch: Partial<LiveSettings>) => updateLiveSettings(patch), []);
  return { settings, update };
}
