import type { Atom, TLStore, TLStoreSnapshot } from "tldraw";

/**
 * Shared contract between the sync engine (`src/lib/sync`) and the board page that wires it
 * to tldraw, Supabase and the browser. Keep this file dependency-free apart from tldraw types.
 */

export type SyncStatus = "saved" | "dirty" | "saving" | "offline" | "merging" | "error" | "refused";

export interface SyncState {
  status: SyncStatus;
  /** human-readable explanation for `error` / `refused` / `offline`; null otherwise */
  message: string | null;
  /** epoch ms of the last successful persist */
  lastSavedAt: number | null;
  /** `whiteboards.version` the local document is based on; null when unknown */
  version: number | null;
  /** true while local changes exist that have not been persisted */
  pending: boolean;
  /** consecutive failed attempts since the last success (drives the backoff) */
  attempt: number;
}

export type PersistResult =
  | { ok: true; version: number }
  | { ok: false; kind: "conflict" }
  | { ok: false; kind: "offline" | "timeout" | "too-large" | "gone" | "other"; message?: string };

export type BuildResult =
  | {
      kind: "update";
      /** `whiteboards` columns to write: data, preview?, updated_at */
      update: Record<string, unknown>;
      /** the document snapshot `update.data` was built from (used for merging on conflict) */
      snapshot: TLStoreSnapshot;
    }
  | { kind: "refused"; message: string };

export interface BackupPayload {
  snapshot: TLStoreSnapshot;
  baseVersion: number | null;
  changed: string[];
  removed: string[];
  at: number;
}

export interface LocalBackup {
  read(boardId: string): BackupPayload | null;
  /** false when the payload could not be stored (too large, storage unavailable) */
  write(boardId: string, payload: BackupPayload): boolean;
  clear(boardId: string): void;
}

export interface SaveQueueDeps {
  boardId: string;
  store: TLStore;
  initialVersion: number | null;
  buildUpdate(): Promise<BuildResult>;
  persist(update: Record<string, unknown>, expectedVersion: number | null): Promise<PersistResult>;
  fetchRemote(): Promise<{ data: unknown; version: number } | null>;
  backup?: LocalBackup;
  isOnline(): boolean;
  now?(): number;
  debounceMs?: number;
  timers?: { setTimeout: typeof setTimeout; clearTimeout: typeof clearTimeout };
}

export interface SaveQueue {
  /** tldraw atom; read with `useValue` in React */
  state: Atom<SyncState>;
  /** a local document change happened: arm the debounced save */
  markDirty(): void;
  /** cancel the debounce and save now (unmount / pagehide) */
  flush(): Promise<SyncState>;
  /** user-initiated: reset the backoff and save now */
  retry(): Promise<SyncState>;
  setOnline(online: boolean): void;
  /** write the unsaved-changes backup immediately (pagehide); false when nothing was written */
  writeBackupNow(): boolean;
  dispose(): void;
}

export interface DirtyToken {
  changed: Set<string>;
  removed: Set<string>;
}

export interface DirtyTracker {
  /** hand out the current dirty sets and start fresh ones */
  begin(): DirtyToken;
  /** merge a failed save's sets back into the pending sets */
  restore(token: DirtyToken): void;
  hasPending(): boolean;
  /** read-only copies of the pending sets */
  peek(): DirtyToken;
  dispose(): void;
}

export interface RemotePlan {
  put: unknown[];
  remove: string[];
}

export interface MergeResult extends RemotePlan {
  merged: Record<string, unknown>;
}
