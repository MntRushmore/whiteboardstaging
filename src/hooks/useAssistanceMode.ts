"use client";

import { useCallback, useState } from "react";

/** The help-mode dial at the top of a board. */
export type AssistanceMode = "off" | "feedback" | "suggest" | "answer";

export const ASSISTANCE_MODES: readonly AssistanceMode[] = ["off", "feedback", "suggest", "answer"];

/** New boards start in Feedback: "off" makes Live look broken (no badges at all). */
export const DEFAULT_ASSISTANCE_MODE: AssistanceMode = "feedback";

type StorageLike = Pick<Storage, "getItem" | "setItem">;

export function isAssistanceMode(value: unknown): value is AssistanceMode {
  return typeof value === "string" && (ASSISTANCE_MODES as readonly string[]).includes(value);
}

export function assistanceModeKey(boardId: string): string {
  return `agathon.mode.${boardId}`;
}

export function readAssistanceMode(boardId: string, storage: StorageLike | null | undefined): AssistanceMode {
  try {
    const raw = storage?.getItem(assistanceModeKey(boardId));
    return isAssistanceMode(raw) ? raw : DEFAULT_ASSISTANCE_MODE;
  } catch {
    return DEFAULT_ASSISTANCE_MODE;
  }
}

export function writeAssistanceMode(
  boardId: string,
  mode: AssistanceMode,
  storage: StorageLike | null | undefined,
): void {
  try {
    storage?.setItem(assistanceModeKey(boardId), mode);
  } catch {
    /* quota / private mode: keep in memory only */
  }
}

function browserStorage(): StorageLike | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}

/** Help mode persisted per board on this device (localStorage `agathon.mode.<boardId>`). */
export function useAssistanceMode(boardId: string): [AssistanceMode, (mode: AssistanceMode) => void] {
  const [mode, setModeState] = useState<AssistanceMode>(() => readAssistanceMode(boardId, browserStorage()));
  const setMode = useCallback(
    (next: AssistanceMode) => {
      setModeState(next);
      writeAssistanceMode(boardId, next, browserStorage());
    },
    [boardId],
  );
  return [mode, setMode];
}
