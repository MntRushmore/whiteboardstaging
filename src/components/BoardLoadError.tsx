"use client";

import Link from "next/link";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";

/**
 * Full-page states for the board route before <Tldraw> mounts. The editor is only mounted
 * once the row loaded AND its snapshot restored on a probe store; every other outcome lands
 * here, so an empty editor can never autosave over a board we failed to read.
 */

export const BOARD_LOAD_COPY = {
  loading: "Loading your canvas…",
  retrying: "Trying again…",
  errorTitle: "Couldn't load this board",
  errorBody: "Your work is still saved. Check your connection and try again.",
  notFoundTitle: "This board doesn't exist or you don't have access",
  notFoundBody: "It may have been deleted, or it belongs to another account.",
  restoreTitle: "Couldn't restore this board's contents",
  restoreBody: "The saved drawing could not be read. Nothing has been changed; try again or come back later.",
  retry: "Retry",
  back: "Back to my whiteboards",
} as const;

/** Postgres/PostgREST error shape as returned by supabase-js. */
export interface LoadErrorLike {
  code?: string | null;
  message?: string | null;
  details?: string | null;
}

export type BoardLoadState =
  | { kind: "ready"; message: "" }
  | { kind: "not-found"; message: string; detail?: string }
  | { kind: "error"; message: string; detail?: string };

export interface LoadStateInput {
  /** the `error` half of the supabase response, or a thrown Error mapped to `{ message }` */
  error?: LoadErrorLike | null;
  /** the row (any non-null value counts as found) */
  row?: unknown;
  /** set when `loadSnapshot` threw for this row's data */
  restoreError?: unknown;
}

/** PostgREST: `.single()` found zero rows (also what an RLS-hidden row looks like). */
const NO_ROWS_CODE = "PGRST116";

function detailOf(e: unknown): string | undefined {
  if (e instanceof Error) return e.message || undefined;
  if (e && typeof e === "object" && "message" in e) {
    const m = (e as { message?: unknown }).message;
    return typeof m === "string" && m ? m : undefined;
  }
  return typeof e === "string" && e ? e : undefined;
}

/**
 * Pure decision for the board route:
 *   restoreError            -> error   (snapshot unreadable; never mount an empty editor)
 *   error PGRST116 / 0 rows -> not-found
 *   any other error         -> error
 *   no row                  -> not-found
 *   row                     -> ready
 */
export function loadStateFor(input: LoadStateInput): BoardLoadState {
  if (input.restoreError !== undefined && input.restoreError !== null) {
    return { kind: "error", message: BOARD_LOAD_COPY.restoreTitle, detail: detailOf(input.restoreError) };
  }
  const { error, row } = input;
  if (error) {
    const zeroRows = error.code === NO_ROWS_CODE || /0 rows/i.test(error.details ?? "");
    if (zeroRows) return { kind: "not-found", message: BOARD_LOAD_COPY.notFoundTitle };
    return { kind: "error", message: BOARD_LOAD_COPY.errorTitle, detail: detailOf(error) };
  }
  if (row === null || row === undefined) {
    return { kind: "not-found", message: BOARD_LOAD_COPY.notFoundTitle };
  }
  return { kind: "ready", message: "" };
}

export function BoardLoading({ label = BOARD_LOAD_COPY.loading }: { label?: string }) {
  return (
    <div className="flex h-screen items-center justify-center bg-gray-50" role="status" aria-live="polite">
      <div className="flex flex-col items-center gap-4">
        <Loader2 className="w-8 h-8 animate-spin text-blue-600" />
        <p className="text-gray-500 font-medium animate-pulse">{label}</p>
      </div>
    </div>
  );
}

interface BoardLoadErrorProps {
  state: Exclude<BoardLoadState, { kind: "ready" }>;
  onRetry: () => void;
}

export function BoardLoadError({ state, onRetry }: BoardLoadErrorProps) {
  const body =
    state.kind === "not-found"
      ? BOARD_LOAD_COPY.notFoundBody
      : state.message === BOARD_LOAD_COPY.restoreTitle
        ? BOARD_LOAD_COPY.restoreBody
        : BOARD_LOAD_COPY.errorBody;

  return (
    <div className="flex h-screen items-center justify-center bg-gray-50 px-4" role="alert">
      <div className="w-full max-w-md rounded-xl border bg-white p-6 shadow-sm text-center">
        <h1 className="text-lg font-semibold text-gray-900">{state.message}</h1>
        <p className="mt-2 text-sm text-gray-600">{body}</p>
        {state.detail && (
          <p className="mt-2 text-xs text-gray-400 break-words" title={state.detail}>
            {state.detail}
          </p>
        )}
        <div className="mt-6 flex flex-col-reverse sm:flex-row items-center justify-center gap-2">
          <Button asChild variant="outline">
            <Link href="/">{BOARD_LOAD_COPY.back}</Link>
          </Button>
          <Button onClick={onRetry}>{BOARD_LOAD_COPY.retry}</Button>
        </div>
      </div>
    </div>
  );
}
