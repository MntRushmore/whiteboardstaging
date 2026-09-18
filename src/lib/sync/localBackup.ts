import type { BackupPayload, LocalBackup } from "./types";

export const BACKUP_KEY_PREFIX = "agathon.unsaved.";
export const BACKUP_MAX_BYTES = 2_000_000;

export function backupKey(boardId: string): string {
  return `${BACKUP_KEY_PREFIX}${boardId}`;
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((v) => typeof v === "string");
}

/** Shape check for what `read` finds in storage; anything else is treated as absent. */
export function isBackupPayload(value: unknown): value is BackupPayload {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  const snapshot = v.snapshot as Record<string, unknown> | undefined;
  if (!snapshot || typeof snapshot !== "object") return false;
  if (!snapshot.store || typeof snapshot.store !== "object" || Array.isArray(snapshot.store)) return false;
  if (!snapshot.schema || typeof snapshot.schema !== "object") return false;
  if (!(v.baseVersion === null || typeof v.baseVersion === "number")) return false;
  if (!isStringArray(v.changed) || !isStringArray(v.removed)) return false;
  if (typeof v.at !== "number") return false;
  return true;
}

function defaultStorage(): Storage | undefined {
  try {
    return (globalThis as { localStorage?: Storage }).localStorage;
  } catch {
    return undefined;
  }
}

/**
 * Unsaved-changes backup in `localStorage` under `agathon.unsaved.<boardId>`.
 * `write` returns false (and clears any stale entry) when the payload exceeds `maxBytes`
 * or storage is unavailable/full; `read` returns null for anything malformed.
 */
export function createLocalStorageBackup(storage: Storage | undefined = defaultStorage(), maxBytes = BACKUP_MAX_BYTES): LocalBackup {
  const clear = (boardId: string): void => {
    try {
      storage?.removeItem(backupKey(boardId));
    } catch {
      /* storage unavailable */
    }
  };
  return {
    read(boardId) {
      try {
        const raw = storage?.getItem(backupKey(boardId));
        if (!raw) return null;
        const parsed: unknown = JSON.parse(raw);
        return isBackupPayload(parsed) ? parsed : null;
      } catch {
        return null;
      }
    },
    write(boardId, payload) {
      if (!storage) return false;
      let raw: string;
      try {
        raw = JSON.stringify(payload);
      } catch {
        clear(boardId);
        return false;
      }
      if (raw.length > maxBytes) {
        clear(boardId);
        return false;
      }
      try {
        storage.setItem(backupKey(boardId), raw);
        return true;
      } catch {
        clear(boardId);
        return false;
      }
    },
    clear,
  };
}
