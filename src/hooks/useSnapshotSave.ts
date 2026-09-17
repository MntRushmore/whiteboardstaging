"use client";

import { useEffect, useRef, useState, type RefObject } from "react";
import { getSnapshot, type Editor } from "tldraw";
import { toast } from "sonner";
import { supabase } from "@/lib/supabase";
import { logger } from "@/lib/logger";
import { decideSave, type SaveDecision, type SaveDecisionInput } from "@/lib/assets/savePolicy";
import { offloadEditorAssets, type OffloadResult } from "@/lib/assets/offloadSnapshotAssets";
import { ASSET_COPY } from "@/components/live/copy";
import { SNAPSHOT_LIMITS, findInlineAssets, snapshotJsonBytes } from "../../scripts/lib/snapshotAssets.mjs";

/**
 * Board autosave: every store change schedules a save ~2 s later that writes the whole
 * tldraw snapshot to `whiteboards.data`. Before the write the snapshot is measured and
 * `decideSave` picks one of: save as-is, offload inline (data: URL) images to Storage
 * first, or refuse (too large even without inline images).
 *
 * The pure runner (`runSnapshotSave`) is separated from the React/Supabase wiring so the
 * decision flow and error mapping are unit-testable without a DOM.
 */

/** Debounce between the last store change and the write. */
export const SAVE_DEBOUNCE_MS = 2000;
/** `whiteboards.preview` is constrained to 20000 chars in the database. */
export const MAX_PREVIEW_LENGTH = 20000;

/** Postgres error codes the autosave special-cases. */
export const PG_STATEMENT_TIMEOUT = "57014";
export const PG_CHECK_VIOLATION = "23514";

export type PgErrorLike = {
  code?: string | null;
  message?: string | null;
  details?: string | null;
  hint?: string | null;
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

export type SaveUpdate = {
  data: unknown;
  updated_at: string;
  preview?: string;
};

export type SaveOutcome =
  | { kind: "saved"; bytes: number; offloaded: boolean }
  | { kind: "skipped"; reason: "offline" | "no-snapshot" | "unserializable" }
  | { kind: "refused"; bytes: number; inlineAssets: number }
  | { kind: "timeout" }
  | { kind: "too-large" }
  | { kind: "error"; error: unknown };

export interface SnapshotMeasure {
  bytes: number;
  inlineAssets: number;
}

export interface SnapshotSaveDeps {
  boardId: string;
  isOnline: () => boolean;
  /** raw editor snapshot (`getSnapshot(editor.store)`); may throw or return nothing */
  takeSnapshot: () => unknown;
  /** moves inline images to Storage and rewrites their src in the store */
  offload: () => Promise<OffloadResult | void>;
  /** true while an offload started elsewhere (e.g. on mount) is still running */
  isOffloadInFlight?: () => boolean;
  /** small JPEG thumbnail as a data URL, or null when none could be made */
  makePreview: () => Promise<string | null>;
  persist: (update: SaveUpdate) => Promise<{ error: PgErrorLike | null; rowCount: number }>;
  /** injectable for tests; defaults to the shared `decideSave` policy */
  decide?: (input: SaveDecisionInput) => SaveDecision;
  /** injectable for tests; defaults to the shared snapshot helpers */
  measure?: (snapshot: unknown) => SnapshotMeasure;
  now?: () => Date;
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
    console.error("Failed to serialize board snapshot:", e);
    logger.error({ error: errorInfo(e), id: boardId }, "Failed to serialize board snapshot for auto-save");
    return null;
  }
}

/**
 * One autosave attempt. Never throws; the outcome says what happened so the hook can
 * surface the blocked state. Order matches the historical inline effect: snapshot ->
 * serialize -> (decide/offload) -> thumbnail -> update.
 */
export async function runSnapshotSave(deps: SnapshotSaveDeps): Promise<SaveOutcome> {
  const { boardId } = deps;
  const decide = deps.decide ?? decideSave;
  const measure = deps.measure ?? measureSnapshot;
  const now = deps.now ?? (() => new Date());

  if (!deps.isOnline()) {
    logger.warn({ id: boardId }, "Skipping auto-save while offline");
    return { kind: "skipped", reason: "offline" };
  }

  try {
    let snapshot = deps.takeSnapshot();
    if (!snapshot) {
      console.warn("Failed to get snapshot from editor");
      return { kind: "skipped", reason: "no-snapshot" };
    }
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
      console.warn("Auto-save refused: board snapshot too large.", { id: boardId, ...measured });
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
        console.warn("Auto-save refused: board snapshot still too large after asset offload.", { id: boardId, ...measured });
        logger.warn({ id: boardId, ...measured, hardBytes: SNAPSHOT_LIMITS.hardBytes }, "Snapshot still over the hard limit after offload; refusing to save");
        return { kind: "refused", bytes: measured.bytes, inlineAssets: measured.inlineAssets };
      }
    }

    let previewUrl: string | null = null;
    try {
      previewUrl = await deps.makePreview();
    } catch (e) {
      console.warn("Thumbnail generation failed:", e);
      logger.warn({ error: errorInfo(e), id: boardId }, "Thumbnail generation failed, continuing without preview");
    }

    const updateData: SaveUpdate = {
      data: safeSnapshot,
      updated_at: now().toISOString(),
    };

    if (previewUrl) {
      if (previewUrl.length > MAX_PREVIEW_LENGTH) {
        console.warn(`Preview too large (${previewUrl.length} bytes), skipping`);
        logger.warn(
          { id: boardId, length: previewUrl.length, maxLength: MAX_PREVIEW_LENGTH },
          "Preview too large, skipping storing preview in database",
        );
      } else {
        updateData.preview = previewUrl;
      }
    }

    console.log(`Attempting to save board ${boardId}...`);
    const { error, rowCount } = await deps.persist(updateData);

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
          bytes: measured.bytes,
        });
        logger.warn(
          { id: boardId, code: error.code, message: error.message, bytes: measured.bytes },
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

    logger.info({ id: boardId, bytes: measured.bytes, offloaded }, "Board auto-saved successfully");
    return { kind: "saved", bytes: measured.bytes, offloaded };
  } catch (error) {
    const info = { id: boardId, ...errorInfo(error) };
    console.error("Error auto-saving board:", info);
    logger.error({ error: info, id: boardId }, "Error auto-saving board");
    return { kind: "error", error };
  }
}

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

function offloadFlightFor(editor: Editor): SingleFlight<OffloadResult> {
  let flight = offloadByEditor.get(editor);
  if (!flight) {
    flight = singleFlight(() => offloadEditorAssets(editor));
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

async function makeEditorPreview(editor: Editor): Promise<string | null> {
  const shapeIds = editor.getCurrentPageShapeIds();
  if (shapeIds.size === 0) return null;
  const viewportBounds = editor.getViewportPageBounds();
  // Quarter scale, lossy: the DB caps `preview` at 20000 chars.
  const { blob } = await editor.toImage([...shapeIds], {
    format: "jpeg",
    quality: 0.6,
    bounds: viewportBounds,
    background: true,
    scale: 0.25,
  });
  if (!blob) return null;
  return new Promise<string>((resolve) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(reader.result as string);
    reader.readAsDataURL(blob);
  });
}

export interface UseSnapshotSaveResult {
  /** non-null while the board cannot be persisted (too large); cleared by the next successful save */
  blockedMessage: string | null;
}

/**
 * Debounced autosave of the editor snapshot to `whiteboards.data`.
 * `skipWhile` mirrors the historical `isUpdatingImageRef` guard: changes made while it is
 * true (overlay bookkeeping) do not schedule a save.
 */
export function useSnapshotSave(
  editor: Editor | null,
  boardId: string,
  skipWhile: RefObject<boolean>,
): UseSnapshotSaveResult {
  const [blockedMessage, setBlockedMessage] = useState<string | null>(null);
  const blockedRef = useRef<string | null>(null);

  useEffect(() => {
    if (!editor) return;

    let saveTimeout: ReturnType<typeof setTimeout> | undefined;
    let disposed = false;

    const handleChange = () => {
      // Don't save during image updates
      if (skipWhile.current) return;

      clearTimeout(saveTimeout);
      saveTimeout = setTimeout(async () => {
        // Validate editor state
        if (!editor || !editor.store) {
          console.warn("Editor or store not available for auto-save");
          return;
        }
        const outcome = await runSnapshotSave({
          boardId,
          isOnline: () => typeof window === "undefined" || !window.navigator || window.navigator.onLine,
          takeSnapshot: () => getSnapshot(editor.store),
          offload: () => offloadAssetsOnce(editor),
          isOffloadInFlight: () => isOffloadRunning(editor),
          makePreview: () => makeEditorPreview(editor),
          persist: async (update) => {
            const { error, data } = await supabase.from("whiteboards").update(update).eq("id", boardId).select();
            return { error, rowCount: data?.length ?? 0 };
          },
        });
        if (disposed) return;
        const next = blockedMessageFor(outcome, blockedRef.current);
        if (next !== blockedRef.current) {
          blockedRef.current = next;
          setBlockedMessage(next);
        }
      }, SAVE_DEBOUNCE_MS);
    };

    // source 'all' so Live's mergeRemoteChanges writes (echoes, graphs, AI steps) are
    // persisted too; the skipWhile guard above still skips overlay bookkeeping.
    const dispose = editor.store.listen(handleChange, {
      source: "all",
      scope: "document",
    });

    return () => {
      disposed = true;
      clearTimeout(saveTimeout);
      dispose();
    };
  }, [editor, boardId, skipWhile]);

  return { blockedMessage };
}
