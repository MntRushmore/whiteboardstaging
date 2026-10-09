"use client";

import { useCallback, useEffect, useSyncExternalStore } from "react";
import {
  gradeFromProfile,
  needsGrade,
  parseSimpleBoardStore,
  rememberChoice,
  rememberGrade,
  SIMPLE_BOARD_KEY,
  simpleBoardOn,
  type SimpleBoardStore,
} from "./simpleBoard";

/**
 * The simple board's device store (`simpleBoard.ts`): localStorage behind an external store, so the
 * board's bar and tldraw's slots (the kid dock, the screen strip, the pen's style panel), which
 * React renders apart, all read one answer and change together when the switch moves. Small and
 * dependency-free: it is in the board's first load; the kid dock itself is loaded lazily.
 */

const listeners = new Set<() => void>();
let cached: SimpleBoardStore | null = null;

function read(): SimpleBoardStore {
  if (cached) return cached;
  if (typeof window === "undefined") return {};
  try {
    cached = parseSimpleBoardStore(window.localStorage.getItem(SIMPLE_BOARD_KEY));
  } catch {
    cached = {};
  }
  return cached;
}

function write(next: SimpleBoardStore): void {
  if (next === cached) return;
  cached = next;
  try {
    window.localStorage.setItem(SIMPLE_BOARD_KEY, JSON.stringify(next));
  } catch {
    /* quota / private mode: kept in memory for this tab */
  }
  listeners.forEach((l) => l());
}

/** Another tab moved the switch: read the key again. */
function onStorage(e: StorageEvent): void {
  if (e.key !== SIMPLE_BOARD_KEY && e.key !== null) return;
  cached = null;
  listeners.forEach((l) => l());
}

function subscribe(cb: () => void): () => void {
  if (listeners.size === 0 && typeof window !== "undefined") window.addEventListener("storage", onStorage);
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
    if (listeners.size === 0 && typeof window !== "undefined") window.removeEventListener("storage", onStorage);
  };
}

/**
 * Is the board simple for this user? `null` while neither their choice nor their grade is known on
 * this device (`simpleBoardOn`): the board shows the grown-up bar meanwhile.
 */
export function useSimpleBoard(userId: string | undefined): boolean | null {
  const snapshot = useCallback(() => (userId ? simpleBoardOn(read()[userId]) : null), [userId]);
  return useSyncExternalStore(subscribe, snapshot, () => null);
}

/** The switch (Board options, More): the user's own choice, remembered on this device. */
export function setSimpleBoard(userId: string, on: boolean): void {
  write(rememberChoice(read(), userId, on));
}

/**
 * Reads the student's grade for the simple board's default, once per board and only while they have
 * not made a choice. Lazily: the profile module is a dynamic import (it is not otherwise in the
 * board's first load) and nothing waits on it; the board page starts it beside its own load.
 */
export function useSimpleBoardGrade(userId: string | undefined): void {
  useEffect(() => {
    if (!userId || !needsGrade(read()[userId])) return;
    void import("@/lib/learning/profile")
      .then(({ readLearnerProfile }) => readLearnerProfile(userId))
      .then((profile) => {
        const grade = gradeFromProfile(profile);
        if (grade !== "unknown") write(rememberGrade(read(), userId, grade));
      })
      .catch(() => {
        /* a chunk that would not load: the bar stays as it is */
      });
  }, [userId]);
}
