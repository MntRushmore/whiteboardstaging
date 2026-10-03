"use client";

import { useCallback, useEffect, useState } from "react";
import { atom, getSnapshot, useValue, type Editor, type TLStoreSnapshot } from "tldraw";
import { toast } from "sonner";
import { supabase } from "@/lib/supabase";
import { logger } from "@/lib/logger";
import { decideSave, type SaveDecision, type SaveDecisionInput } from "@/lib/assets/savePolicy";
import type { OffloadResult } from "@/lib/assets/offloadSnapshotAssets";
import {
  createLocalStorageBackup,
  createSaveQueue,
  restoreBackupInto,
  type BuildResult,
  type PersistResult,
  type SaveQueue,
  type SyncState,
} from "@/lib/sync";
import { ASSET_COPY } from "@/components/live/copy";
import { SNAPSHOT_LIMITS, findInlineAssets, snapshotJsonBytes } from "../../scripts/lib/snapshotAssets.mjs";
import { isBoardEmpty, makeScreenThumbnail } from "@/lib/boards/thumbnail";
import { trackExitWrite } from "@/lib/boards/exitWrites";

/**
 * Board autosave. Every document change marks the board dirty in a `SaveQueue`
 * (`src/lib/sync`) which debounces ~2 s, builds the update (`buildSnapshotUpdate`: measure
 * -> offload inline images -> thumbnail) and persists it with optimistic concurrency
 * (`whiteboards.version`). The queue owns retry/backoff, offline replay, a localStorage
 * backup and the merge with another tab's write; this file owns the tldraw/Supabase glue:
 *
 *  - `buildSnapshotUpdate`   pure builder (returns the row update instead of persisting)
 *  - `resolvePersistResult`  Supabase response -> `PersistResult` (timeout/too-large/offline/
 *                            conflict/gone/other)
 *  - `runSnapshotSave`       legacy one-shot runner (build + persist) kept for its tests and
 *                            for callers that do not go through the queue
 *  - `useSnapshotSave`       the React hook wiring editor store <-> queue <-> Supabase
 */

/** Debounce between the last store change and the write. */
export const SAVE_DEBOUNCE_MS = 2000;
/** `whiteboards.preview` is constrained to 20000 chars in the database. */
export const MAX_PREVIEW_LENGTH = 20000;

/** Postgres error codes the autosave special-cases. */
export const PG_STATEMENT_TIMEOUT = "57014";
export const PG_CHECK_VIOLATION = "23514";

/** Student-facing strings owned by the autosave wiring (the pill's strings live in SaveStatus.tsx). */
export const SAVE_COPY = {
  restoredBackup: "Restored unsaved changes from this device",
  /** the editor could not produce a serializable snapshot (not a size problem) */
  cannotPrepare: "Couldn't prepare this board to save — try reloading",
} as const;

export type PgErrorLike = {
  code?: string | null;
  message?: string | null;
  details?: string | null;
  hint?: string | null;
  name?: string | null;
};

export type SaveErrorKind = "timeout" | "too-large" | "other";

/**
 * Map a PostgREST/Postgres error to how the autosave reacts:
 *  - `timeout`   statement timeout (57014) — non-fatal, often navigation away
 *  - `too-large` check-constraint violation (23514) — the row exceeds the DB size cap
 *  - `other`     anything else — logged loudly
 */
export function classifySaveError(error: PgErrorLike | null | undefined): SaveErrorKind {
  if (!error) return "other";
  const code = error.code ?? "";
  const message = error.message ?? "";
  if (code === PG_STATEMENT_TIMEOUT || /statement timeout/i.test(message)) return "timeout";
  if (code === PG_CHECK_VIOLATION) return "too-large";
  return "other";
}

const NETWORK_MESSAGE = /failed to fetch|network ?error|network request failed|load failed|fetch failed|econnrefused|enotfound|socket hang up/i;

/**
 * True when the failure is the transport, not the request: a thrown `TypeError` from
 * fetch, supabase-js's wrapped `"TypeError: Failed to fetch"`, or PostgREST reporting it
 * cannot reach the database (`PGRST0xx`). Request-level PostgREST errors (bad query,
 * expired JWT: `PGRST1xx`/`PGRST3xx`) are NOT network failures — retrying them blindly
 * would hide a real problem.
 */
export function isNetworkFailure(error: unknown): boolean {
  if (!error) return false;
  if (error instanceof TypeError) return true;
  if (typeof error !== "object") return false;
  const e = error as PgErrorLike;
  if (e.name === "TypeError") return true;
  if (typeof e.code === "string" && /^PGRST0\d\d$/.test(e.code)) return true;
  return NETWORK_MESSAGE.test(e.message ?? "") || NETWORK_MESSAGE.test(e.details ?? "");
}

export type SaveUpdate = {
  data: unknown;
  updated_at: string;
  /** absent = keep the stored thumbnail; null = clear it (nothing left on the board) */
  preview?: string | null;
};

export type SaveOutcome =
  | { kind: "saved"; bytes: number; offloaded: boolean }
  | { kind: "skipped"; reason: "offline" | "no-snapshot" | "unserializable" }
  | { kind: "refused"; bytes: number; inlineAssets: number }
  | { kind: "timeout" }
  | { kind: "too-large" }
  | { kind: "error"; error: unknown };

/** What `buildSnapshotUpdate` produced (everything up to, but not including, the write). */
export type BuildOutcome =
  | { kind: "update"; update: SaveUpdate; snapshot: unknown; bytes: number; offloaded: boolean }
  | { kind: "skipped"; reason: "no-snapshot" | "unserializable" }
  | { kind: "refused"; bytes: number; inlineAssets: number }
  | { kind: "error"; error: unknown };

export interface SnapshotMeasure {
  bytes: number;
  inlineAssets: number;
}

export interface SnapshotBuildDeps {
  boardId: string;
  /** raw editor snapshot (`getSnapshot(editor.store)`); may throw or return nothing */
  takeSnapshot: () => unknown;
  /** moves inline images to Storage and rewrites their src in the store */
  offload: () => Promise<OffloadResult | void>;
  /** true while an offload started elsewhere (e.g. on mount) is still running */
  isOffloadInFlight?: () => boolean;
  /** small thumbnail of the current screen as a data URL, or null when none could be made */
  makePreview: () => Promise<string | null>;
  /** true when no screen has anything on it: the stored thumbnail is cleared instead */
  isEmpty?: () => boolean;
  /** injectable for tests; defaults to the shared `decideSave` policy */
  decide?: (input: SaveDecisionInput) => SaveDecision;
  /** injectable for tests; defaults to the shared snapshot helpers */
  measure?: (snapshot: unknown) => SnapshotMeasure;
  now?: () => Date;
}

export interface SnapshotSaveDeps extends SnapshotBuildDeps {
  isOnline: () => boolean;
  persist: (update: SaveUpdate) => Promise<{ error: PgErrorLike | null; rowCount: number }>;
}

export function measureSnapshot(snapshot: unknown): SnapshotMeasure {
  return {
    bytes: snapshotJsonBytes(snapshot),
    inlineAssets: findInlineAssets(snapshot).length,
  };
}

function errorInfo(error: unknown): Record<string, unknown> {
  const info: Record<string, unknown> = {
    errorType: typeof error,
    errorConstructor: (error as { constructor?: { name?: string } })?.constructor?.name,
  };
  if (error instanceof Error) {
    info.message = error.message;
    info.name = error.name;
    info.stack = error.stack;
  } else if (error && typeof error === "object") {
    const record = error as Record<string, unknown>;
    for (const key of Object.getOwnPropertyNames(error)) {
      try {
        info[key] = record[key];
      } catch {
        info[key] = "[Unable to access property]";
      }
    }
  } else {
    info.value = String(error);
  }
  return info;
}

/** JSON round-trip so the payload is exactly what Supabase will receive; null when it cannot be serialized. */
function toSafeSnapshot(snapshot: unknown, boardId: string): unknown | null {
  try {
    return JSON.parse(JSON.stringify(snapshot));
  } catch (e) {
    logger.error({ error: errorInfo(e), id: boardId }, "Failed to serialize board snapshot for auto-save");
    return null;
  }
}

/**
 * Build the `whiteboards` row update for the current editor state without writing it.
 * Never throws. Order matches the historical inline effect: snapshot -> serialize ->
 * (decide/offload) -> thumbnail.
 */
export async function buildSnapshotUpdate(deps: SnapshotBuildDeps): Promise<BuildOutcome> {
  const { boardId } = deps;
  const decide = deps.decide ?? decideSave;
  const measure = deps.measure ?? measureSnapshot;
  const now = deps.now ?? (() => new Date());

  try {
    let snapshot = deps.takeSnapshot();
    // (each outcome below is logged once, through `logger`, which also writes to the console)
    if (!snapshot) return { kind: "skipped", reason: "no-snapshot" };
    let safeSnapshot = toSafeSnapshot(snapshot, boardId);
    if (safeSnapshot === null) return { kind: "skipped", reason: "unserializable" };

    let measured = measure(safeSnapshot);
    const decision = decide({ ...measured, offloadInFlight: deps.isOffloadInFlight?.() ?? false });
    let offloaded = false;

    if (decision.level !== "ok") {
      const log = decision.level === "error" ? logger.warn.bind(logger) : logger.info.bind(logger);
      log({ id: boardId, ...measured, action: decision.action }, decision.reason);
    }

    if (decision.action === "refuse") {
      return { kind: "refused", bytes: measured.bytes, inlineAssets: measured.inlineAssets };
    }

    if (decision.action === "offload-then-save") {
      try {
        const result = await deps.offload();
        offloaded = true;
        if (result && result.failed.length > 0) {
          logger.warn(
            { id: boardId, migrated: result.migrated, failed: result.failed, aborted: result.aborted },
            "Asset offload left some images inline",
          );
        }
      } catch (e) {
        // Fall through and save what we have; the DB size check is the backstop.
        logger.warn({ id: boardId, error: errorInfo(e) }, "Asset offload failed before auto-save");
      }
      snapshot = deps.takeSnapshot();
      if (!snapshot) return { kind: "skipped", reason: "no-snapshot" };
      safeSnapshot = toSafeSnapshot(snapshot, boardId);
      if (safeSnapshot === null) return { kind: "skipped", reason: "unserializable" };
      measured = measure(safeSnapshot);
      // The offload was the only way to shrink the board; if it is still over the hard
      // limit (uploads failed, or the bulk is not inline images) refuse instead of
      // letting the DB size constraint be the first thing the user hears about it.
      if (measured.bytes > SNAPSHOT_LIMITS.hardBytes) {
        logger.warn({ id: boardId, ...measured, hardBytes: SNAPSHOT_LIMITS.hardBytes }, "Snapshot still over the hard limit after offload; refusing to save");
        return { kind: "refused", bytes: measured.bytes, inlineAssets: measured.inlineAssets };
      }
    }

    // An empty board clears its thumbnail, so the card shows the empty placeholder rather
    // than ink that has since been erased. A failed or oversized thumbnail keeps the old one.
    const empty = deps.isEmpty?.() ?? false;
    let previewUrl: string | null = null;
    if (!empty) {
      try {
        previewUrl = await deps.makePreview();
      } catch (e) {
        logger.warn({ error: errorInfo(e), id: boardId }, "Thumbnail generation failed, continuing without preview");
      }
    }

    const update: SaveUpdate = {
      data: safeSnapshot,
      updated_at: now().toISOString(),
    };

    if (empty) {
      update.preview = null;
    } else if (previewUrl) {
      if (previewUrl.length > MAX_PREVIEW_LENGTH) {
        logger.warn(
          { id: boardId, length: previewUrl.length, maxLength: MAX_PREVIEW_LENGTH },
          "Preview too large, skipping storing preview in database",
        );
      } else {
        update.preview = previewUrl;
      }
    }

    return { kind: "update", update, snapshot: safeSnapshot, bytes: measured.bytes, offloaded };
  } catch (error) {
    const info = { id: boardId, ...errorInfo(error) };
    logger.error({ error: info, id: boardId }, "Error preparing board auto-save");
    return { kind: "error", error };
  }
}

/**
 * `whiteboards.data` holds the full editor snapshot (`{ document, session }`); the sync
 * layer only cares about the document half (`{ store, schema }`). Older rows that stored
 * a bare store snapshot are passed through unchanged.
 */
export function storeSnapshotOf(snapshot: unknown): TLStoreSnapshot {
  const s = snapshot as { document?: unknown; store?: unknown } | null;
  if (s && typeof s === "object" && s.document && typeof s.document === "object") return s.document as TLStoreSnapshot;
  return snapshot as TLStoreSnapshot;
}

/** Above this a board that saves is told it is nearly full (80 % of the size the client refuses). */
export const NEARLY_FULL_BYTES = SNAPSHOT_LIMITS.hardBytes * 0.8;

/** `BuildOutcome` -> the `SaveQueue` contract. Anything that cannot produce a row is `refused`. */
export function toBuildResult(outcome: BuildOutcome): BuildResult {
  switch (outcome.kind) {
    case "update": {
      const notice = outcome.bytes > NEARLY_FULL_BYTES ? ASSET_COPY.boardNearlyFull : undefined;
      return { kind: "update", update: outcome.update, snapshot: storeSnapshotOf(outcome.snapshot), bytes: outcome.bytes, notice };
    }
    case "refused":
      // Only images can be moved out of the row; a board of ink is simply full.
      return { kind: "refused", message: outcome.inlineAssets > 0 ? ASSET_COPY.boardTooLarge : ASSET_COPY.boardFull };
    case "skipped":
    case "error":
      return { kind: "refused", message: SAVE_COPY.cannotPrepare };
  }
}

/**
 * One autosave attempt (build + persist, no concurrency check). Never throws; the outcome
 * says what happened so a caller can surface the blocked state.
 */
export async function runSnapshotSave(deps: SnapshotSaveDeps): Promise<SaveOutcome> {
  const { boardId } = deps;

  if (!deps.isOnline()) {
    logger.warn({ id: boardId }, "Skipping auto-save while offline");
    return { kind: "skipped", reason: "offline" };
  }

  const built = await buildSnapshotUpdate(deps);
  if (built.kind !== "update") return built;

  try {
    logger.debug({ id: boardId }, "Attempting to save board");
    const { error, rowCount } = await deps.persist(built.update);

    if (error) {
      const kind = classifySaveError(error);
      if (kind === "timeout") {
        // Often the user navigated away mid-request or the DB is briefly under load.
        console.warn("Supabase auto-save timed out, skipping noisy error log.", {
          id: boardId,
          code: error.code,
          message: error.message,
        });
        logger.warn(
          { id: boardId, code: error.code, message: error.message },
          "Supabase auto-save timed out (often due to navigation away); ignoring.",
        );
        return { kind: "timeout" };
      }
      if (kind === "too-large") {
        console.warn("Supabase rejected the board snapshot as too large.", {
          id: boardId,
          code: error.code,
          message: error.message,
          bytes: built.bytes,
        });
        logger.warn(
          { id: boardId, code: error.code, message: error.message, bytes: built.bytes },
          "Auto-save rejected by the database size constraint",
        );
        return { kind: "too-large" };
      }
      const details = { message: error.message, code: error.code, details: error.details, hint: error.hint, ...errorInfo(error) };
      console.error("Supabase update error:", details);
      throw new Error(`Supabase error: ${error.message || "Unknown error"} (code: ${error.code || "N/A"})`);
    }

    if (rowCount === 0) {
      console.warn("No rows updated - board may not exist:", boardId);
    }

    logger.info({ id: boardId, bytes: built.bytes, offloaded: built.offloaded }, "Board auto-saved successfully");
    return { kind: "saved", bytes: built.bytes, offloaded: built.offloaded };
  } catch (error) {
    const info = { id: boardId, ...errorInfo(error) };
    console.error("Error auto-saving board:", info);
    logger.error({ error: info, id: boardId }, "Error auto-saving board");
    return { kind: "error", error };
  }
}

// ---------------------------------------------------------------------------
// Supabase response -> PersistResult
// ---------------------------------------------------------------------------

/** What `update(...).eq(...).select('version')` came back with. `rows` is the `data` array. */
export interface PersistResponse {
  error: PgErrorLike | null;
  rows: unknown;
}

export interface PersistContext {
  /** the version the update was conditioned on; null = unconditional */
  expectedVersion: number | null;
  /** `navigator.onLine` at response time */
  online: boolean;
  /** does the row still exist (and is visible to us)? asked only when zero rows matched */
  exists: () => Promise<boolean>;
}

/** A PostgREST error (no rows) -> PersistResult. */
export function persistErrorResult(error: PgErrorLike, online: boolean): PersistResult {
  if (!online || isNetworkFailure(error)) return { ok: false, kind: "offline" };
  const kind = classifySaveError(error);
  if (kind === "timeout") return { ok: false, kind: "timeout" };
  if (kind === "too-large") return { ok: false, kind: "too-large" };
  const code = error.code ? ` (code: ${error.code})` : "";
  return { ok: false, kind: "other", message: `${error.message || "Unknown error"}${code}` };
}

/** Something `await`ing the Supabase call threw (fetch itself failed, or a bug). */
export function persistResultFromThrown(error: unknown, online: boolean): PersistResult {
  if (!online || isNetworkFailure(error)) return { ok: false, kind: "offline" };
  return { ok: false, kind: "other", message: error instanceof Error ? error.message : String(error) };
}

/**
 * Map the response of a conditional update to the queue's `PersistResult`:
 *  - error 57014 -> timeout, 23514 -> too-large, transport/PGRST0xx or offline -> offline
 *  - no error, no rows -> the version filter missed: `conflict` if the row still exists,
 *    `gone` if it does not (deleted, or RLS hides it)
 *  - a row -> ok with the version the trigger just bumped to
 */
export async function resolvePersistResult(resp: PersistResponse, ctx: PersistContext): Promise<PersistResult> {
  if (resp.error) return persistErrorResult(resp.error, ctx.online);
  const rows = Array.isArray(resp.rows) ? (resp.rows as Array<{ version?: unknown }>) : [];
  if (rows.length === 0) {
    if (ctx.expectedVersion === null) return { ok: false, kind: "gone" };
    let exists = false;
    try {
      exists = await ctx.exists();
    } catch {
      // Could not tell: treat as a conflict so the queue re-fetches instead of giving up.
      return { ok: false, kind: "conflict" };
    }
    return exists ? { ok: false, kind: "conflict" } : { ok: false, kind: "gone" };
  }
  const version = rows[0]?.version;
  if (typeof version === "number") return { ok: true, version };
  if (typeof version === "string" && /^\d+$/.test(version)) return { ok: true, version: Number(version) };
  return { ok: false, kind: "other", message: "Save succeeded but the database returned no version" };
}

function navigatorOnline(): boolean {
  return typeof navigator === "undefined" || typeof navigator.onLine !== "boolean" || navigator.onLine;
}

/** Row still there and visible? Selects only `version` — never the multi-MB `data`. */
async function boardExists(boardId: string): Promise<boolean> {
  const { data, error } = await supabase.from("whiteboards").select("version").eq("id", boardId).maybeSingle();
  if (error) throw error;
  return data !== null;
}

/**
 * Conditional write: `UPDATE whiteboards SET ... WHERE id = $1 AND version = $expected
 * RETURNING version`. The version is bumped by the `whiteboards_bump_version` trigger, never
 * by the client. Only `version` is selected back: echoing `data` would download the whole
 * multi-MB row on every save.
 */
export async function persistBoardUpdate(
  boardId: string,
  update: Record<string, unknown>,
  expectedVersion: number | null,
  signal?: AbortSignal,
): Promise<PersistResult> {
  if (!navigatorOnline()) return { ok: false, kind: "offline" };
  try {
    let query = supabase.from("whiteboards").update(update).eq("id", boardId);
    if (expectedVersion !== null) query = query.eq("version", expectedVersion);
    const select = query.select("version");
    // The queue aborts a write that hangs (then retries it); see PERSIST_TIMEOUT_MS.
    const { data, error } = await (signal ? select.abortSignal(signal) : select);
    return resolvePersistResult(
      { error, rows: data },
      { expectedVersion, online: navigatorOnline(), exists: () => boardExists(boardId) },
    );
  } catch (e) {
    return persistResultFromThrown(e, navigatorOnline());
  }
}

/** The other tab's row, for the merge. */
export async function fetchRemoteBoard(boardId: string, signal?: AbortSignal): Promise<{ data: unknown; version: number } | null> {
  const query = supabase.from("whiteboards").select("data, version").eq("id", boardId);
  const { data, error } = await (signal ? query.abortSignal(signal) : query).maybeSingle();
  if (error) throw error;
  if (!data) return null;
  const row = data as { data: unknown; version: unknown };
  return { data: row.data, version: typeof row.version === "number" ? row.version : Number(row.version) };
}

// ---------------------------------------------------------------------------
// Editor-side helpers
// ---------------------------------------------------------------------------

export interface SingleFlight<T> {
  /** start the work, or join the run already in progress */
  run: () => Promise<T>;
  isRunning: () => boolean;
}

/** Wrap an async function so concurrent callers share one in-flight promise. */
export function singleFlight<T>(fn: () => Promise<T>): SingleFlight<T> {
  let inFlight: Promise<T> | null = null;
  return {
    run: () => {
      if (!inFlight) {
        inFlight = fn().finally(() => {
          inFlight = null;
        });
      }
      return inFlight;
    },
    isRunning: () => inFlight !== null,
  };
}

const offloadByEditor = new WeakMap<Editor, SingleFlight<OffloadResult>>();

/** Only boards saved before the asset store shipped still hold images as data: URLs. */
export function hasInlineImages(editor: Pick<Editor, "getAssets">): boolean {
  return editor.getAssets().some((a) => !!a.props.src?.startsWith("data:"));
}

function offloadFlightFor(editor: Editor): SingleFlight<OffloadResult> {
  let flight = offloadByEditor.get(editor);
  if (!flight) {
    // The offloader is fetched for a board that needs it, not on every board's first load.
    flight = singleFlight(async () =>
      hasInlineImages(editor)
        ? (await import("@/lib/assets/offloadSnapshotAssets")).offloadEditorAssets(editor)
        : { migrated: 0, failed: [], bytesBefore: 0, bytesAfter: 0, aborted: false },
    );
    offloadByEditor.set(editor, flight);
  }
  return flight;
}

/**
 * `offloadEditorAssets(editor)` guarded so the on-mount run and an autosave-triggered run
 * never overlap for the same editor (they would race on the same asset records).
 */
export function offloadAssetsOnce(editor: Editor): Promise<OffloadResult> {
  return offloadFlightFor(editor).run();
}

export function isOffloadRunning(editor: Editor): boolean {
  return offloadByEditor.get(editor)?.isRunning() ?? false;
}

let inlineFallbackWarned = false;

/** Toast once per page load when an upload fell back to an inline data: URL. */
export function warnInlineAssetFallbackOnce(): boolean {
  if (inlineFallbackWarned) return false;
  inlineFallbackWarned = true;
  toast.warning(ASSET_COPY.inlineFallback);
  return true;
}

/** test hook */
export function resetInlineAssetFallbackWarning(): void {
  inlineFallbackWarned = false;
}

/** Whether a save outcome leaves the board in the "cannot be saved" state. */
export function blockedMessageFor(outcome: SaveOutcome, previous: string | null): string | null {
  switch (outcome.kind) {
    case "refused":
    case "too-large":
      return ASSET_COPY.boardTooLarge;
    case "saved":
      return null;
    default:
      // offline / timeout / other errors: keep whatever was shown before
      return previous;
  }
}

/** The blocked badge text for a queue state: only `refused` (too large / unserializable) blocks. */
export function blockedMessageForSync(state: SyncState): string | null {
  return state.status === "refused" ? state.message ?? ASSET_COPY.boardTooLarge : null;
}

/** `buildUpdate` for the queue, bound to a live editor. */
export function buildEditorUpdate(editor: Editor, boardId: string): Promise<BuildResult> {
  return buildSnapshotUpdate({
    boardId,
    takeSnapshot: () => getSnapshot(editor.store),
    offload: () => offloadAssetsOnce(editor),
    isOffloadInFlight: () => isOffloadRunning(editor),
    // The current screen, sized and encoded to fit the column (src/lib/boards/thumbnail.ts).
    makePreview: () => makeScreenThumbnail(editor, MAX_PREVIEW_LENGTH),
    isEmpty: () => isBoardEmpty(editor),
  }).then(toBuildResult);
}

/** State shown before the queue exists (editor not mounted yet). */
export function idleSyncState(version: number | null): SyncState {
  return { status: "saved", message: null, notice: null, lastSavedAt: null, version, pending: false, attempt: 0 };
}

export interface UseSnapshotSaveResult {
  /** live queue state for the SaveStatus pill (a board that cannot be saved is `refused`, see blockedMessageForSync) */
  sync: SyncState;
  /** re-run a failed save now (Retry button) */
  retry: () => Promise<SyncState>;
}

/**
 * Autosave of the editor snapshot to `whiteboards.data` through a `SaveQueue`.
 *
 * Every document change (`source: 'all'`, so Live echoes, graphs and the tutor's
 * handwriting are included) marks the queue dirty.
 *
 * On mount the localStorage backup left by a previous session (offline, crash, closed tab
 * mid-save) is merged over the loaded board — this effect runs after tldraw's `onMount`
 * (layout effect of the parent `Layout`) has run `loadSnapshot`, so the restore never gets
 * overwritten by the load.
 */
export function useSnapshotSave(
  editor: Editor | null,
  boardId: string,
  initialVersion: number | null = null,
): UseSnapshotSaveResult {
  // The queue is created in an effect (it needs the editor) but read reactively during
  // render, so it lives in a tldraw atom rather than React state (no setState in effects).
  const [queueAtom] = useState(() => atom<SaveQueue | null>("save.queue", null));

  useEffect(() => {
    if (!editor) return;
    const store = editor.store;
    const backup = createLocalStorageBackup();
    const queue = createSaveQueue({
      boardId,
      store,
      initialVersion,
      buildUpdate: () => buildEditorUpdate(editor, boardId),
      persist: (update, expectedVersion, signal) => persistBoardUpdate(boardId, update, expectedVersion, signal),
      fetchRemote: (signal) => fetchRemoteBoard(boardId, signal),
      backup,
      isOnline: navigatorOnline,
      debounceMs: SAVE_DEBOUNCE_MS,
    });
    queueAtom.set(queue);

    // Unsaved work from a previous session on this device: local edits win over the loaded row.
    try {
      const pending = backup.read(boardId);
      if (pending) {
        const { applied } = restoreBackupInto(store, pending, initialVersion);
        logger.info({ id: boardId, applied, baseVersion: pending.baseVersion }, "Restored autosave backup");
        if (applied > 0) toast.info(SAVE_COPY.restoredBackup);
        queue.markDirty();
        // Replaces the old backup with what is still unsaved now (nothing: it is cleared), at
        // once: clearing it and waiting for the next backup would leave a window with none.
        queue.writeBackupNow();
      }
    } catch (e) {
      logger.warn({ id: boardId, error: errorInfo(e) }, "Could not restore autosave backup");
      backup.clear(boardId);
    }

    const disposeListener = store.listen(() => queue.markDirty(), { source: "all", scope: "document" });

    const onOnline = () => queue.setOnline(true);
    const onOffline = () => queue.setOnline(false);
    // Navigation/close can't wait for a request; the backup is synchronous and survives it.
    const onPageHide = () => {
      queue.writeBackupNow();
    };
    // Switching app or tab is often the last event a page gets (iPadOS suspends a hidden tab's
    // timers, then may discard it without pagehide): back up and save now, not after the
    // debounce. Back in view, a save waiting out a backoff is tried again at once.
    const onVisibility = () => {
      if (document.visibilityState === "hidden") {
        queue.writeBackupNow();
        void queue.flush();
      } else {
        queue.setOnline(navigatorOnline());
      }
    };
    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);
    window.addEventListener("pagehide", onPageHide);
    window.addEventListener("beforeunload", onPageHide);
    document.addEventListener("visibilitychange", onVisibility);

    if (process.env.NODE_ENV !== "production") {
      // Dev-only handle for the verifier / devtools.
      (window as unknown as { __agathonSaveQueue?: SaveQueue }).__agathonSaveQueue = queue;
    }

    return () => {
      window.removeEventListener("online", onOnline);
      window.removeEventListener("offline", onOffline);
      window.removeEventListener("pagehide", onPageHide);
      window.removeEventListener("beforeunload", onPageHide);
      document.removeEventListener("visibilitychange", onVisibility);
      disposeListener();
      if (queueAtom.get() === queue) queueAtom.set(null);
      if (process.env.NODE_ENV !== "production") {
        const w = window as unknown as { __agathonSaveQueue?: SaveQueue };
        if (w.__agathonSaveQueue === queue) delete w.__agathonSaveQueue;
      }
      // Fire and forget: a pending debounced save must not be discarded on unmount.
      // The backup is written first so nothing is lost even if the flush never completes.
      queue.writeBackupNow();
      // Tracked so the dashboard can wait for it: otherwise its first read races this write
      // and shows the board's previous thumbnail.
      trackExitWrite(
        queue
          .flush()
          .catch((e) => logger.warn({ id: boardId, error: errorInfo(e) }, "Flush on unmount failed"))
          .finally(() => queue.dispose()),
      );
    };
  }, [editor, boardId, initialVersion, queueAtom]);

  const sync = useValue("save.sync", () => queueAtom.get()?.state.get() ?? idleSyncState(initialVersion), [
    queueAtom,
    initialVersion,
  ]);

  const retry = useCallback(
    () => queueAtom.get()?.retry() ?? Promise.resolve(idleSyncState(initialVersion)),
    [queueAtom, initialVersion],
  );
  return { sync, retry };
}
