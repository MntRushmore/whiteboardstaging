"use client";

import { useEffect, useState } from "react";
import { atom, useValue } from "tldraw";
import type { SyncState } from "@/lib/sync";
import { ASSET_COPY } from "./copy";

/**
 * Small pill next to the Live pill that mirrors the autosave queue. Quiet by default:
 * nothing is shown while the board is saved (after a short "Saved" confirmation) or while
 * a save is merely debounced; it speaks up when work is unsaved because of the network,
 * a failed write (with a Retry), a merge with another tab, or a board too large to save.
 */

/** How long "Saved" stays visible after a successful write. */
export const SAVED_FADE_MS = 1500;

export const SAVE_STATUS_COPY = {
  saved: "Saved",
  saving: "Saving…",
  retrying: "Retrying…",
  offline: "Unsaved changes — offline",
  error: "Couldn't save",
  retry: "Retry",
  merging: "Merging changes from another tab…",
} as const;

export type SaveStatusTone = "neutral" | "amber" | "red" | "info";

export interface SaveStatusView {
  label: string;
  tone: SaveStatusTone;
  showRetry: boolean;
  /** hover text (the underlying error, when there is one) */
  title: string | null;
}

/**
 * Pure mapping: queue state -> what the pill shows, or null for "show nothing".
 * `savedVisible` is the fade window: `saved` is only shown for SAVED_FADE_MS after a write.
 */
export function saveStatusViewFor(state: SyncState, savedVisible: boolean): SaveStatusView | null {
  switch (state.status) {
    case "saved":
      if (!savedVisible || state.lastSavedAt === null) return null;
      return { label: SAVE_STATUS_COPY.saved, tone: "neutral", showRetry: false, title: null };
    case "dirty":
      // A debounced save is not worth a pill; a retry after a failure is.
      if (state.attempt > 0) return { label: SAVE_STATUS_COPY.retrying, tone: "neutral", showRetry: false, title: null };
      return null;
    case "saving":
      return { label: SAVE_STATUS_COPY.saving, tone: "neutral", showRetry: false, title: null };
    case "offline":
      return { label: SAVE_STATUS_COPY.offline, tone: "amber", showRetry: false, title: state.message };
    case "merging":
      return { label: SAVE_STATUS_COPY.merging, tone: "info", showRetry: false, title: null };
    case "error":
      return { label: SAVE_STATUS_COPY.error, tone: "red", showRetry: true, title: state.message };
    case "refused":
      return { label: state.message ?? ASSET_COPY.boardTooLarge, tone: "red", showRetry: false, title: state.message };
    default:
      return null;
  }
}

const TONE_CLASS: Record<SaveStatusTone, string> = {
  neutral: "border-gray-200 bg-white text-gray-600",
  amber: "border-amber-200 bg-amber-50 text-amber-800",
  red: "border-red-200 bg-red-50 text-red-700",
  info: "border-blue-200 bg-blue-50 text-blue-700",
};

/**
 * "Saved" lingers for SAVED_FADE_MS after each successful write, then disappears. Lives in
 * a tldraw atom (external store) so no React state is set synchronously inside an effect.
 */
function useSavedVisible(state: SyncState): boolean {
  const [shown] = useState(() => atom("save.savedShown", false));
  const { status, lastSavedAt } = state;
  useEffect(() => {
    if (status !== "saved" || lastSavedAt === null) {
      shown.set(false);
      return;
    }
    shown.set(true);
    const timer = setTimeout(() => shown.set(false), SAVED_FADE_MS);
    return () => clearTimeout(timer);
  }, [shown, status, lastSavedAt]);
  return useValue(shown);
}

export interface SaveStatusProps {
  sync: SyncState;
  onRetry: () => void;
}

export function SaveStatus({ sync, onRetry }: SaveStatusProps) {
  const savedVisible = useSavedVisible(sync);
  const view = saveStatusViewFor(sync, savedVisible);
  if (!view) return null;
  return (
    <span
      role="status"
      aria-live="polite"
      data-testid="save-status"
      data-status={sync.status}
      title={view.title ?? undefined}
      className={`inline-flex h-9 items-center gap-1.5 rounded-md border px-2.5 text-xs font-medium shadow-sm ${TONE_CLASS[view.tone]}`}
    >
      <span>{view.label}</span>
      {view.showRetry && (
        <button
          type="button"
          className="rounded bg-white/70 px-1.5 py-0.5 text-[11px] font-semibold text-red-700 hover:bg-white"
          onClick={onRetry}
        >
          {SAVE_STATUS_COPY.retry}
        </button>
      )}
    </span>
  );
}
