"use client";

import { useCallback, useSyncExternalStore } from "react";

/**
 * Whether the board chat's panel is open, per device. In the board's first load (the page lays the
 * panel out); the panel itself is not (`BoardChatPanel`, a dynamic import).
 */

const OPEN_KEY = "agathon.chat.open.v1";
const openListeners = new Set<() => void>();
let openCache: boolean | null = null;

function readOpen(): boolean {
  if (openCache !== null) return openCache;
  if (typeof window === "undefined") return false;
  try {
    openCache = window.localStorage.getItem(OPEN_KEY) === "1";
  } catch {
    openCache = false;
  }
  return openCache;
}

/** The panel is off by default; opening or closing it is remembered on this device. */
export function useChatOpen(): [boolean, (open: boolean) => void] {
  const open = useSyncExternalStore(
    (cb) => {
      openListeners.add(cb);
      return () => openListeners.delete(cb);
    },
    readOpen,
    () => false,
  );
  const setOpen = useCallback((next: boolean) => {
    openCache = next;
    try {
      window.localStorage.setItem(OPEN_KEY, next ? "1" : "0");
    } catch {
      /* private mode: this session only */
    }
    openListeners.forEach((l) => l());
  }, []);
  return [open, setOpen];
}
