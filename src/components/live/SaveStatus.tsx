"use client";

import { useEffect, useState } from "react";
import { Check, LoaderCircle } from "lucide-react";
import { atom, useValue } from "tldraw";
import type { UserErrorInput } from "@/lib/clientErrors";
import { reportUserError } from "@/lib/reportAppError";
import { MSG_BOARD_GONE, MSG_MERGE_FAILED, MSG_SAVE_FAILED, MSG_SAVE_TIMEOUT, type SyncState } from "@/lib/sync";
import { ASSET_COPY } from "./copy";

/**
 * Small pill at the end of the board bar that mirrors the autosave queue. Quiet by default:
 * nothing is shown while the board is saved (after a short "Saved" confirmation) or while
 * a save is merely debounced; it speaks up when work is unsaved because of the network,
 * a failed write (with a Retry), a merge with another tab, or a board too large to save.
 * It is the bar's last item, so appearing never moves the other controls; on a board under
 * 1024 px (the bar's `@5xl/bar` container query) the routine states (Saving… / Saved /
 * Retrying…) are an icon (the words stay for screen readers and as its tooltip), so an upright
 * iPad keeps the bar on one row while a save runs.
 */

/** How long "Saved" stays visible after a successful write. */
export const SAVED_FADE_MS = 1500;

export const SAVE_STATUS_COPY = {
  saved: "Saved",
  saving: "Saving…",
  retrying: "Retrying…",
  offline: "Unsaved changes — offline",
  /** offline, and the backup on this device could not be written either (its storage is full) */
  offlineNotBackedUp: "Unsaved changes — offline, not backed up on this device",
  notBackedUp: "Not backed up on this device either: its storage is full.",
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
  // A nearly full board says so for as long as it is merely saving normally.
  const notice: SaveStatusView | null = state.notice ? { label: state.notice, tone: "amber", showRetry: false, title: null } : null;
  switch (state.status) {
    case "saved":
      if (!savedVisible || state.lastSavedAt === null) return notice;
      return { label: SAVE_STATUS_COPY.saved, tone: "neutral", showRetry: false, title: null };
    case "dirty":
      // A debounced save is not worth a pill; a retry after a failure is.
      if (state.attempt > 0) return { label: SAVE_STATUS_COPY.retrying, tone: "neutral", showRetry: false, title: null };
      return notice;
    case "saving":
      // a retry after a failure (a hung or refused write) is not an ordinary save
      return { label: state.attempt > 0 ? SAVE_STATUS_COPY.retrying : SAVE_STATUS_COPY.saving, tone: "neutral", showRetry: false, title: null };
    case "offline":
      if (state.backupFailed) return { label: SAVE_STATUS_COPY.offlineNotBackedUp, tone: "red", showRetry: false, title: SAVE_STATUS_COPY.notBackedUp };
      return { label: SAVE_STATUS_COPY.offline, tone: "amber", showRetry: false, title: state.message };
    case "merging":
      return { label: SAVE_STATUS_COPY.merging, tone: "info", showRetry: false, title: null };
    case "error":
      return {
        label: SAVE_STATUS_COPY.error,
        tone: "red",
        showRetry: true,
        title: state.backupFailed ? [state.message, SAVE_STATUS_COPY.notBackedUp].filter(Boolean).join(" ") : state.message,
      };
    case "refused":
      return { label: state.message ?? ASSET_COPY.boardTooLarge, tone: "red", showRetry: false, title: state.message };
    default:
      return null;
  }
}

/** The save queue's own words for a failed write -> its code for the admin page. */
const SAVE_FAILURE_CODES: ReadonlyArray<[string, string]> = [
  [MSG_SAVE_TIMEOUT, "timeout"],
  [MSG_BOARD_GONE, "gone"],
  [MSG_MERGE_FAILED, "merge_failed"],
  [MSG_SAVE_FAILED, "save_failed"],
];
/** What a refused save says (`refused`), when it is our own copy -> its code. */
const SAVE_REFUSED_CODES: ReadonlyArray<[string, string]> = [
  [ASSET_COPY.boardTooLarge, "too_large"],
  [ASSET_COPY.boardFull, "board_full"],
  ["This board is too large to save.", "too_large"],
];

/**
 * A save failure the pill shows in red, as the admin page hears of it (`live.save`), or null for
 * anything else (saved, saving, merging, plain offline: the student's own connection, not ours).
 * Only our own words are sent: the queue's message for a failed write can be the database's raw
 * error, so it becomes a code — the queue's known failures by name, a PostgREST/Postgres error by
 * its code (`pg_42501`, `pg_pgrst301`), anything else `save_failed` — under the pill's "Couldn't save".
 */
export function saveErrorReport(state: Pick<SyncState, "status" | "message" | "backupFailed">): UserErrorInput | null {
  const message = state.message ?? "";
  switch (state.status) {
    case "error": {
      const known = SAVE_FAILURE_CODES.find(([m]) => m === message)?.[1];
      const pg = /\(code: ([\w.-]{1,30})\)$/.exec(message)?.[1];
      const code = known ?? (pg ? `pg_${pg}` : "save_failed");
      return { kind: "live.save", code: state.backupFailed ? `${code}_no_backup` : code, message: SAVE_STATUS_COPY.error };
    }
    case "refused": {
      const known = SAVE_REFUSED_CODES.find(([m]) => m === message);
      return known ? { kind: "live.save", code: known[1], message: known[0] } : { kind: "live.save", code: "refused", message: SAVE_STATUS_COPY.error };
    }
    case "offline":
      // offline is the student's connection; offline with no backup on the device (its storage is
      // full) puts their work at risk
      return state.backupFailed ? { kind: "live.save", code: "offline_no_backup", message: SAVE_STATUS_COPY.offlineNotBackedUp, level: "warn" } : null;
    default:
      return null;
  }
}

/** Reports each red state of the pill once as it appears (and the reporter's dedupe holds repeats to one a minute). */
function useReportSaveError({ status, message, backupFailed }: SyncState): void {
  useEffect(() => {
    const report = saveErrorReport({ status, message, backupFailed });
    if (report) reportUserError(report);
  }, [status, message, backupFailed]);
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

/**
 * The icon a routine state shrinks to on a board under 1024 px ("saved": a tick, "busy": a spinner), or null
 * for the states that must be read (offline, failed, merging, too large, a notice): those keep
 * their words at every width.
 */
export function saveStatusIcon(view: SaveStatusView): "saved" | "busy" | null {
  if (view.tone !== "neutral") return null;
  if (view.label === SAVE_STATUS_COPY.saved) return "saved";
  if (view.label === SAVE_STATUS_COPY.saving || view.label === SAVE_STATUS_COPY.retrying) return "busy";
  return null;
}

export function SaveStatus({ sync, onRetry }: SaveStatusProps) {
  const savedVisible = useSavedVisible(sync);
  useReportSaveError(sync);
  const view = saveStatusViewFor(sync, savedVisible);
  if (!view) return null;
  const icon = saveStatusIcon(view);
  return (
    <span
      role="status"
      aria-live="polite"
      data-testid="save-status"
      data-status={sync.status}
      title={view.title ?? (icon ? view.label : undefined)}
      className={`inline-flex h-9 items-center gap-1.5 rounded-md border text-xs font-medium shadow-sm ${icon ? "px-2 @5xl/bar:px-2.5" : "px-2.5"} ${TONE_CLASS[view.tone]}`}
    >
      {icon === "saved" && <Check className="size-4 @5xl/bar:hidden" aria-hidden />}
      {icon === "busy" && <LoaderCircle className="size-4 animate-spin motion-reduce:animate-none @5xl/bar:hidden" aria-hidden />}
      <span className={icon ? "sr-only @5xl/bar:not-sr-only" : undefined}>{view.label}</span>
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
