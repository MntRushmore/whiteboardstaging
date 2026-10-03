import { atom, type TLRecord, type TLStoreSnapshot } from "tldraw";
import { applyRemotePlan } from "./applyRemotePlan";
import { createDirtyTracker } from "./dirtyTracker";
import { deepEqual } from "./deepEqual";
import { mergeDocumentRecords } from "./mergeDocumentRecords";
import type { BuildResult, DirtyToken, PersistResult, SaveQueue, SaveQueueDeps, SyncState } from "./types";

export const DEFAULT_DEBOUNCE_MS = 2000;
/** delay before the unsaved-changes backup is written after a change */
export const BACKUP_DEBOUNCE_MS = 500;
/**
 * The debounces restart on every change, so edits that never pause (steady writing, the tutor's
 * hand drawing) would otherwise never be saved or backed up: these cap how long a burst waits.
 */
export const MAX_SAVE_WAIT_MS = 10_000;
export const MAX_BACKUP_WAIT_MS = 2_000;
/** retry delays after a failed persist; the last one repeats */
export const RETRY_BACKOFF_MS: readonly number[] = [2000, 5000, 15000, 60000];
/** a conflict round is fetch -> merge -> persist; after this many the user has to reload */
export const MAX_CONFLICT_ROUNDS = 3;
/**
 * A write (or the conflict fetch) with no answer after this long, plus 1 ms per
 * PERSIST_TIMEOUT_BYTES_PER_MS bytes written (a 4 MB board gets ~200 s more: a 20 KB/s link), is
 * treated as hung: aborted and retried. Without it a stalled request leaves "Saving…" up forever
 * and blocks every later save.
 */
export const PERSIST_TIMEOUT_MS = 30_000;
export const PERSIST_TIMEOUT_BYTES_PER_MS = 20;

export const MSG_BOARD_GONE = "This board no longer exists";
export const MSG_MERGE_FAILED = "Could not merge changes made in another tab. Reload to continue.";
export const MSG_OFFLINE = "You're offline. Changes will be saved when the connection returns.";
export const MSG_SAVE_FAILED = "Saving failed. Retrying…";
export const MSG_SAVE_TIMEOUT = "Save timed out. Retrying…";

export function backoffDelay(attempt: number): number {
  const index = Math.min(Math.max(attempt, 1), RETRY_BACKOFF_MS.length) - 1;
  return RETRY_BACKOFF_MS[index];
}

export function persistTimeoutMs(bytes = 0): number {
  return PERSIST_TIMEOUT_MS + Math.max(0, bytes) / PERSIST_TIMEOUT_BYTES_PER_MS;
}

const TIMED_OUT = Symbol("timed out");

const has = (o: object, id: string): boolean => Object.prototype.hasOwnProperty.call(o, id);

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
 *    ok          -> saved, version bumped, backup cleared; edits that arrived meanwhile wait for the debounce
 *    conflict    -> merging: fetch the remote row, merge record-by-record (local edits win), adopt the
 *                   remote version and immediately persist again (max MAX_CONFLICT_ROUNDS rounds)
 *    offline/timeout/other -> dirty sets restored, retry with backoff (2 s, 5 s, 15 s, 60 s…)
 *                             (a write with no answer after persistTimeoutMs is a timeout)
 *    too-large / refused   -> refused; pending stays true and the next edit retries
 *    gone        -> error, stop
 *
 * Only one cycle runs at a time. Offline is detected up front so buildUpdate (thumbnail, offload)
 * is not paid for a write that cannot happen. The debounce never holds a burst of edits longer
 * than MAX_SAVE_WAIT_MS (MAX_BACKUP_WAIT_MS for the backup).
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
    notice: null,
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
  /** the document records the write in flight sent (null when none is) */
  let inFlightSent: Record<string, unknown> | null = null;
  /**
   * Writes whose outcome is unknown (timed out, cut off, an unexplained error), newest last: one of
   * them may have landed. What they sent goes into backups (`sent`) until a write or a merge settles
   * what the server holds.
   */
  let unacked: Array<{ sent: Record<string, unknown>; ids: Set<string> }> = [];
  /**
   * Whether `persisted` is known to be what the server holds. False after an ambiguous failure (the
   * write may have landed), so the "nothing to save" shortcut cannot leave a landed stroke the
   * student has since erased on the server.
   */
  let serverKnown = true;
  let debounceTimer: ReturnType<typeof setTimeout> | null = null;
  let retryTimer: ReturnType<typeof setTimeout> | null = null;
  let backupTimer: ReturnType<typeof setTimeout> | null = null;
  /** when the edits the debounce / backup timer is waiting on started */
  let saveBurstAt: number | null = null;
  let backupBurstAt: number | null = null;
  /** the document records as the server has them at `state.version` (as loaded, persisted or merged in) */
  let persisted = deps.store.getStoreSnapshot("document").store as Record<string, unknown>;

  const isOnline = (): boolean => onlineHint ?? deps.isOnline();
  const hasPending = (): boolean => dirty || tracker.hasPending();
  const patch = (p: Partial<SyncState>): SyncState => state.update((s) => ({ ...s, ...p }));
  /** `wait` after the latest edit, but never more than `max` after the first one of the burst */
  const burstDelay = (since: number, wait: number, max: number): number => Math.max(0, Math.min(wait, since + max - now()));

  /** Run `task` with an abort signal; resolves to TIMED_OUT (and aborts it) after `ms`. */
  function withTimeout<T>(task: (signal?: AbortSignal) => Promise<T>, ms: number): Promise<T | typeof TIMED_OUT> {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | null = null;
    const expired = new Promise<typeof TIMED_OUT>((resolve) => {
      timer = timers.set(() => {
        controller.abort();
        resolve(TIMED_OUT);
      }, ms);
    });
    return Promise.race([task(controller.signal), expired]).finally(() => timers.clear(timer));
  }

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
    // What a write that may land, or may have landed, sent for an id still unsaved (the write in
    // flight first, then those whose outcome is unknown, newest first): if the tab dies, the restore
    // must not mistake this device's own write on the server for another device's change.
    let sent: Record<string, unknown> | undefined;
    const writes = [...(inFlightToken && inFlightSent ? [{ sent: inFlightSent, ids: new Set([...inFlightToken.changed, ...inFlightToken.removed]) }] : []), ...[...unacked].reverse()];
    for (const id of [...pending.changed, ...pending.removed]) {
      const write = writes.find((w) => w.ids.has(id));
      if (write) {
        sent ??= {};
        sent[id] = has(write.sent, id) ? write.sent[id] : null;
      }
    }
    if (inFlightToken) {
      for (const id of inFlightToken.changed) if (!pending.removed.has(id)) pending.changed.add(id);
      for (const id of inFlightToken.removed) if (!pending.changed.has(id)) pending.removed.add(id);
    }
    if (pending.changed.size === 0 && pending.removed.size === 0) {
      deps.backup.clear(deps.boardId);
      return false;
    }
    try {
      // Only the unsaved records: a restore never reads the rest, and the whole document of a
      // big board would not fit in localStorage (a board too large to save most needs this).
      // `base` is each of them as the server has it at `baseVersion` (nothing for a new record).
      const records: Record<string, TLRecord> = {};
      const base: Record<string, unknown> = {};
      for (const id of pending.changed) {
        const record = deps.store.get(id as TLRecord["id"]);
        if (record) records[id] = record;
        if (has(persisted, id)) base[id] = persisted[id];
      }
      for (const id of pending.removed) if (has(persisted, id)) base[id] = persisted[id];
      return deps.backup.write(deps.boardId, {
        snapshot: { store: records, schema: deps.store.schema.serialize() } as TLStoreSnapshot,
        baseVersion: state.get().version,
        changed: [...pending.changed],
        removed: [...pending.removed],
        at: now(),
        base,
        ...(sent ? { sent } : {}),
      });
    } catch {
      return false;
    }
  }

  function scheduleBackup(): void {
    if (!deps.backup) return;
    backupBurstAt ??= now();
    clearTimer("backup");
    backupTimer = timers.set(() => {
      backupTimer = null;
      backupBurstAt = null;
      writeBackupNow();
    }, burstDelay(backupBurstAt, BACKUP_DEBOUNCE_MS, MAX_BACKUP_WAIT_MS));
  }

  /**
   * True when every pending change leaves its record as last persisted: a record rewritten with
   * the same content (Live re-rendering its echoes when a board opens) or changed and changed back.
   */
  function nothingToSave(): boolean {
    if (!serverKnown) return false;
    const { changed, removed } = tracker.peek();
    for (const id of changed) if (!deepEqual(deps.store.get(id as TLRecord["id"]), persisted[id])) return false;
    for (const id of removed) if (has(persisted, id)) return false;
    return true;
  }

  function fail(token: DirtyToken, p: Partial<SyncState>): void {
    tracker.restore(token);
    dirty = true;
    patch({ ...p, pending: true });
  }

  async function cycle(): Promise<SyncState> {
    clearTimer("debounce");
    clearTimer("retry");
    saveBurstAt = null;
    if (!isOnline()) {
      const attempt = state.get().attempt + 1;
      patch({ status: "offline", message: MSG_OFFLINE, pending: hasPending(), attempt });
      if (hasPending()) scheduleRetry(attempt);
      return state.get();
    }
    if (nothingToSave()) {
      // No write, no "Saving…", and the row's updated_at (the boards home's order) stays put.
      tracker.begin();
      dirty = false;
      patch({ status: "saved", message: null, pending: false, attempt: 0 });
      deps.backup?.clear(deps.boardId);
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
        const expected = state.get().version;
        inFlightSent = built.snapshot.store as Record<string, unknown>;
        const sent = await withTimeout((signal) => deps.persist(built.update, expected, signal), persistTimeoutMs(built.bytes));
        result = sent === TIMED_OUT ? { ok: false, kind: "timeout", message: MSG_SAVE_TIMEOUT } : sent;
      } catch (e) {
        result = { ok: false, kind: isOnline() ? "other" : "offline", message: e instanceof Error ? e.message : String(e) };
      } finally {
        inFlightSent = null;
      }
      if (disposed) {
        tracker.restore(token);
        dirty = true;
        return state.get();
      }

      if (result.ok) {
        inFlightToken = null;
        persisted = built.snapshot.store as Record<string, unknown>;
        serverKnown = true;
        unacked = [];
        patch({
          status: "saved",
          message: null,
          notice: built.notice ?? null,
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
            const fetched = await withTimeout((signal) => deps.fetchRemote(signal), persistTimeoutMs(built.bytes));
            if (fetched === TIMED_OUT) throw new Error(MSG_SAVE_TIMEOUT);
            remote = fetched;
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
          // The server now holds `remoteStore` at `remote.version`: the base a backup refers to.
          // (Any earlier write that landed is in it, so nothing is unknown any more.)
          persisted = remoteStore;
          serverKnown = true;
          unacked = [];
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
          // The write may have landed without our hearing so: what the server holds is unknown,
          // and what this write sent stays in the backups until a write or a merge settles it.
          serverKnown = false;
          unacked = [...unacked.slice(-2), { sent: built.snapshot.store as Record<string, unknown>, ids: new Set([...token.changed, ...token.removed]) }];
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
        // Edits that arrived while saving are saved like any others: after the debounce (at most
        // MAX_SAVE_WAIT_MS after the first). Saving them at once chained writes back to back for
        // as long as the student kept writing.
        if (!disposed && !halted && s.status === "saved" && hasPending()) scheduleSave();
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
      // part of the next save's burst (see scheduleSave)
      saveBurstAt ??= now();
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
    scheduleSave();
  }

  function scheduleSave(): void {
    saveBurstAt ??= now();
    clearTimer("debounce");
    debounceTimer = timers.set(() => {
      debounceTimer = null;
      void run();
    }, burstDelay(saveBurstAt, debounceMs, MAX_SAVE_WAIT_MS));
  }

  return {
    state,
    markDirty,
    async flush() {
      clearTimer("debounce");
      saveBurstAt = null;
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
