import { atom } from "tldraw";
import { applyRemotePlan } from "./applyRemotePlan";
import { createDirtyTracker } from "./dirtyTracker";
import { mergeDocumentRecords } from "./mergeDocumentRecords";
import type { BuildResult, DirtyToken, PersistResult, SaveQueue, SaveQueueDeps, SyncState } from "./types";

export const DEFAULT_DEBOUNCE_MS = 2000;
/** delay before the unsaved-changes backup is written after a change */
export const BACKUP_DEBOUNCE_MS = 500;
/** retry delays after a failed persist; the last one repeats */
export const RETRY_BACKOFF_MS: readonly number[] = [2000, 5000, 15000, 60000];
/** a conflict round is fetch -> merge -> persist; after this many the user has to reload */
export const MAX_CONFLICT_ROUNDS = 3;

export const MSG_BOARD_GONE = "This board no longer exists";
export const MSG_MERGE_FAILED = "Could not merge changes made in another tab. Reload to continue.";
export const MSG_OFFLINE = "You're offline. Changes will be saved when the connection returns.";
export const MSG_SAVE_FAILED = "Saving failed. Retrying…";

export function backoffDelay(attempt: number): number {
  const index = Math.min(Math.max(attempt, 1), RETRY_BACKOFF_MS.length) - 1;
  return RETRY_BACKOFF_MS[index];
}

/** `whiteboards.data` is either a TLEditorSnapshot (`{ document: { store } }`) or a bare TLStoreSnapshot (`{ store }`). */
export function extractStoreMap(data: unknown): Record<string, unknown> | null {
  if (!data || typeof data !== "object") return null;
  const d = data as { store?: unknown; document?: { store?: unknown } };
  if (d.store && typeof d.store === "object" && !Array.isArray(d.store)) return d.store as Record<string, unknown>;
  const doc = d.document?.store;
  if (doc && typeof doc === "object" && !Array.isArray(doc)) return doc as Record<string, unknown>;
  return null;
}

/**
 * Debounced, retrying, conflict-aware autosave queue.
 *
 *  markDirty -> (debounce) -> cycle: begin dirty token -> buildUpdate -> persist(expectedVersion)
 *    ok          -> saved, version bumped, backup cleared; one follow-up save if edits arrived meanwhile
 *    conflict    -> merging: fetch the remote row, merge record-by-record (local edits win), adopt the
 *                   remote version and immediately persist again (max MAX_CONFLICT_ROUNDS rounds)
 *    offline/timeout/other -> dirty sets restored, retry with backoff (2 s, 5 s, 15 s, 60 s…)
 *    too-large / refused   -> refused; pending stays true and the next edit retries
 *    gone        -> error, stop
 *
 * Only one cycle runs at a time. Offline is detected up front so buildUpdate (thumbnail, offload)
 * is not paid for a write that cannot happen.
 */
export function createSaveQueue(deps: SaveQueueDeps): SaveQueue {
  const debounceMs = deps.debounceMs ?? DEFAULT_DEBOUNCE_MS;
  const now = deps.now ?? (() => Date.now());
  const timers = {
    set: (fn: () => void, ms: number): ReturnType<typeof setTimeout> =>
      deps.timers ? deps.timers.setTimeout(fn, ms) : globalThis.setTimeout(fn, ms),
    clear: (handle: ReturnType<typeof setTimeout> | null): void => {
      if (handle === null) return;
      if (deps.timers) deps.timers.clearTimeout(handle);
      else globalThis.clearTimeout(handle);
    },
  };

  const state = atom<SyncState>(`sync.state.${deps.boardId}`, {
    status: "saved",
    message: null,
    lastSavedAt: null,
    version: deps.initialVersion,
    pending: false,
    attempt: 0,
  });
  const tracker = createDirtyTracker(deps.store);

  let disposed = false;
  /** set by markDirty, consumed when a cycle begins */
  let dirty = false;
  /** no automatic retries any more (board gone, merge cap); a manual retry() lifts it */
  let halted = false;
  /** last value passed to setOnline; falls back to deps.isOnline() */
  let onlineHint: boolean | null = null;
  let inFlight: Promise<SyncState> | null = null;
  let inFlightToken: DirtyToken | null = null;
  let debounceTimer: ReturnType<typeof setTimeout> | null = null;
  let retryTimer: ReturnType<typeof setTimeout> | null = null;
  let backupTimer: ReturnType<typeof setTimeout> | null = null;

  const isOnline = (): boolean => onlineHint ?? deps.isOnline();
  const hasPending = (): boolean => dirty || tracker.hasPending();
  const patch = (p: Partial<SyncState>): SyncState => state.update((s) => ({ ...s, ...p }));

  function clearTimer(which: "debounce" | "retry" | "backup"): void {
    if (which === "debounce") {
      timers.clear(debounceTimer);
      debounceTimer = null;
    } else if (which === "retry") {
      timers.clear(retryTimer);
      retryTimer = null;
    } else {
      timers.clear(backupTimer);
      backupTimer = null;
    }
  }

  function scheduleRetry(attempt: number): void {
    clearTimer("retry");
    retryTimer = timers.set(() => {
      retryTimer = null;
      void run();
    }, backoffDelay(attempt));
  }

  function writeBackupNow(): boolean {
    if (disposed || !deps.backup) return false;
    const pending = tracker.peek();
    if (inFlightToken) {
      for (const id of inFlightToken.changed) if (!pending.removed.has(id)) pending.changed.add(id);
      for (const id of inFlightToken.removed) if (!pending.changed.has(id)) pending.removed.add(id);
    }
    if (pending.changed.size === 0 && pending.removed.size === 0) {
      deps.backup.clear(deps.boardId);
      return false;
    }
    try {
      return deps.backup.write(deps.boardId, {
        snapshot: deps.store.getStoreSnapshot("document"),
        baseVersion: state.get().version,
        changed: [...pending.changed],
        removed: [...pending.removed],
        at: now(),
      });
    } catch {
      return false;
    }
  }

  function scheduleBackup(): void {
    if (!deps.backup) return;
    clearTimer("backup");
    backupTimer = timers.set(() => {
      backupTimer = null;
      writeBackupNow();
    }, BACKUP_DEBOUNCE_MS);
  }

  function fail(token: DirtyToken, p: Partial<SyncState>): void {
    tracker.restore(token);
    dirty = true;
    patch({ ...p, pending: true });
  }

  async function cycle(): Promise<SyncState> {
    clearTimer("debounce");
    clearTimer("retry");
    if (!isOnline()) {
      const attempt = state.get().attempt + 1;
      patch({ status: "offline", message: MSG_OFFLINE, pending: hasPending(), attempt });
      if (hasPending()) scheduleRetry(attempt);
      return state.get();
    }
    patch({ status: "saving", message: null });

    for (let round = 0; ; round++) {
      const token = tracker.begin();
      inFlightToken = token;
      dirty = false;

      let built: BuildResult;
      try {
        built = await deps.buildUpdate();
      } catch (e) {
        built = { kind: "refused", message: e instanceof Error ? e.message : String(e) };
      }
      if (disposed) {
        tracker.restore(token);
        dirty = true;
        return state.get();
      }
      if (built.kind === "refused") {
        fail(token, { status: "refused", message: built.message });
        return state.get();
      }

      let result: PersistResult;
      try {
        result = await deps.persist(built.update, state.get().version);
      } catch (e) {
        result = { ok: false, kind: isOnline() ? "other" : "offline", message: e instanceof Error ? e.message : String(e) };
      }
      if (disposed) {
        tracker.restore(token);
        dirty = true;
        return state.get();
      }

      if (result.ok) {
        inFlightToken = null;
        patch({
          status: "saved",
          message: null,
          version: result.version,
          lastSavedAt: now(),
          attempt: 0,
          pending: hasPending(),
        });
        if (!hasPending()) deps.backup?.clear(deps.boardId);
        return state.get();
      }

      switch (result.kind) {
        case "conflict": {
          patch({ status: "merging", message: null });
          let remote: { data: unknown; version: number } | null;
          try {
            remote = await deps.fetchRemote();
          } catch (e) {
            fail(token, {
              status: isOnline() ? "error" : "offline",
              message: e instanceof Error ? e.message : MSG_SAVE_FAILED,
              attempt: state.get().attempt + 1,
            });
            scheduleRetry(state.get().attempt);
            return state.get();
          }
          if (disposed) {
            tracker.restore(token);
            dirty = true;
            return state.get();
          }
          if (remote === null) {
            halted = true;
            fail(token, { status: "error", message: MSG_BOARD_GONE });
            return state.get();
          }
          const remoteStore = extractStoreMap(remote.data);
          if (!remoteStore || round >= MAX_CONFLICT_ROUNDS) {
            halted = true;
            fail(token, { status: "error", message: MSG_MERGE_FAILED });
            return state.get();
          }
          // Local edits made during this round are still unsaved: they win too.
          const pending = tracker.peek();
          const changed = new Set([...token.changed, ...pending.changed]);
          const removed = new Set([...token.removed, ...pending.removed]);
          for (const id of pending.changed) removed.delete(id);
          const plan = mergeDocumentRecords({ local: built.snapshot.store, remote: remoteStore, changed, removed });
          applyRemotePlan(deps.store, plan);
          // The merge only adopted remote records; ours are still unsaved -> keep them dirty.
          tracker.restore(token);
          inFlightToken = null;
          patch({ status: "saving", version: remote.version });
          continue;
        }
        case "too-large":
          fail(token, { status: "refused", message: result.message ?? "This board is too large to save." });
          return state.get();
        case "gone":
          halted = true;
          fail(token, { status: "error", message: result.message ?? MSG_BOARD_GONE });
          return state.get();
        case "offline":
        case "timeout":
        case "other": {
          const attempt = state.get().attempt + 1;
          const offline = result.kind === "offline" || !isOnline();
          fail(token, {
            status: offline ? "offline" : "error",
            message: offline ? MSG_OFFLINE : result.message ?? MSG_SAVE_FAILED,
            attempt,
          });
          scheduleRetry(attempt);
          return state.get();
        }
      }
    }
  }

  function run(): Promise<SyncState> {
    if (inFlight) return inFlight;
    if (disposed) return Promise.resolve(state.get());
    const p = (async () => {
      try {
        return await cycle();
      } finally {
        inFlight = null;
        inFlightToken = null;
        const s = state.get();
        // Edits that arrived while saving: exactly one immediate follow-up save.
        if (!disposed && !halted && s.status === "saved" && hasPending()) void run();
      }
    })();
    inFlight = p;
    return p;
  }

  function markDirty(): void {
    if (disposed) return;
    dirty = true;
    scheduleBackup();
    if (halted) {
      patch({ pending: true });
      return;
    }
    if (inFlight) {
      patch({ pending: true });
      return;
    }
    if (!isOnline()) {
      patch({ status: "offline", message: MSG_OFFLINE, pending: true });
    } else if (retryTimer !== null) {
      // A backoff retry is already scheduled and will pick this change up; keep the error visible.
      patch({ pending: true });
      return;
    } else {
      patch({ status: "dirty", message: null, pending: true });
    }
    clearTimer("debounce");
    debounceTimer = timers.set(() => {
      debounceTimer = null;
      void run();
    }, debounceMs);
  }

  return {
    state,
    markDirty,
    async flush() {
      clearTimer("debounce");
      if (inFlight) await inFlight;
      if (!disposed && !halted && hasPending()) await run();
      return state.get();
    },
    async retry() {
      clearTimer("retry");
      halted = false;
      patch({ attempt: 0 });
      if (inFlight) await inFlight;
      return run();
    },
    setOnline(online) {
      if (disposed) return;
      onlineHint = online;
      if (online) {
        if (hasPending() && !inFlight && !halted) {
          clearTimer("retry");
          void run();
        } else if (!hasPending() && state.get().status === "offline") {
          patch({ status: "saved", message: null });
        }
      } else if (hasPending() && !inFlight) {
        patch({ status: "offline", message: MSG_OFFLINE, pending: true });
      }
    },
    writeBackupNow,
    dispose() {
      disposed = true;
      clearTimer("debounce");
      clearTimer("retry");
      clearTimer("backup");
      tracker.dispose();
    },
  };
}
