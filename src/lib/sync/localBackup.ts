import type { BackupPayload, LocalBackup } from "./types";

export const BACKUP_KEY_PREFIX = "agathon.unsaved.";
export const BACKUP_MAX_BYTES = 2_000_000;

/**
 * `agathon.unsaved.<boardId>.<tabId>`: one key per tab (per mounted board, really), so two tabs
 * of a board never overwrite or clear each other's backup. Without `tabId` it is the key every
 * tab shared before 2026-10-03, still read (and removed) when a board opens.
 */
export function backupKey(boardId: string, tabId?: string): string {
  return `${BACKUP_KEY_PREFIX}${boardId}${tabId ? `.${tabId}` : ""}`;
}

/** A random id for this tab's backup key (and its Web Lock, see tabLock.ts). */
export function newTabId(): string {
  const c = (globalThis as { crypto?: Crypto }).crypto;
  return c?.randomUUID ? c.randomUUID().slice(0, 13) : Math.random().toString(36).slice(2, 15);
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((v) => typeof v === "string");
}

const isMap = (v: unknown): boolean => !!v && typeof v === "object" && !Array.isArray(v);

/** Shape check for what `read` finds in storage; anything else is treated as absent. */
export function isBackupPayload(value: unknown): value is BackupPayload {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  const snapshot = v.snapshot as Record<string, unknown> | undefined;
  if (!snapshot || typeof snapshot !== "object") return false;
  if (!isMap(snapshot.store)) return false;
  if (!snapshot.schema || typeof snapshot.schema !== "object") return false;
  if (!(v.baseVersion === null || typeof v.baseVersion === "number")) return false;
  if (!isStringArray(v.changed) || !isStringArray(v.removed)) return false;
  if (typeof v.at !== "number") return false;
  if (v.base !== undefined && !isMap(v.base)) return false;
  if (v.sent !== undefined && !isMap(v.sent)) return false;
  return true;
}

function defaultStorage(): Storage | undefined {
  try {
    return (globalThis as { localStorage?: Storage }).localStorage;
  } catch {
    return undefined;
  }
}

/** One backup found on the device: its key, the tab that wrote it (null: the old shared key) and the payload (null: unreadable). */
export interface StoredBackup {
  key: string;
  tabId: string | null;
  payload: BackupPayload | null;
}

/** This tab's backup (`LocalBackup`, what the save queue writes) plus the device-wide view a restore needs. */
export interface DeviceBackups extends LocalBackup {
  readonly tabId: string;
  /** every backup of `boardId` on this device: other tabs', earlier page loads', the old shared key, this tab's */
  list(boardId: string): StoredBackup[];
  remove(key: string): void;
}

/**
 * Unsaved-changes backup in `localStorage` under `agathon.unsaved.<boardId>.<tabId>`.
 * `write` returns false (and clears any stale entry) when the payload exceeds `maxBytes` (after
 * dropping the optional `base` / `sent` copies, which only sharpen a restore) or storage is
 * unavailable/full; `read` returns null for anything malformed.
 */
export function createLocalStorageBackup(
  storage: Storage | undefined = defaultStorage(),
  maxBytes = BACKUP_MAX_BYTES,
  tabId: string = newTabId(),
): DeviceBackups {
  const remove = (key: string): void => {
    try {
      storage?.removeItem(key);
    } catch {
      /* storage unavailable */
    }
  };
  const parse = (raw: string | null | undefined): BackupPayload | null => {
    if (!raw) return null;
    try {
      const parsed: unknown = JSON.parse(raw);
      return isBackupPayload(parsed) ? parsed : null;
    } catch {
      return null;
    }
  };
  const clear = (boardId: string): void => remove(backupKey(boardId, tabId));
  return {
    tabId,
    read(boardId) {
      try {
        return parse(storage?.getItem(backupKey(boardId, tabId)));
      } catch {
        return null;
      }
    },
    write(boardId, payload) {
      if (!storage) return false;
      let raw: string;
      try {
        raw = JSON.stringify(payload);
        if (raw.length > maxBytes && (payload.base || payload.sent)) {
          // The unsaved records matter more than knowing exactly what the server had.
          const { base: _base, sent: _sent, ...plain } = payload;
          void _base;
          void _sent;
          raw = JSON.stringify(plain);
        }
      } catch {
        clear(boardId);
        return false;
      }
      if (raw.length > maxBytes) {
        clear(boardId);
        return false;
      }
      try {
        storage.setItem(backupKey(boardId, tabId), raw);
        return true;
      } catch {
        clear(boardId);
        return false;
      }
    },
    clear,
    list(boardId) {
      const shared = backupKey(boardId);
      const out: StoredBackup[] = [];
      try {
        if (!storage) return out;
        for (let i = 0; i < storage.length; i++) {
          const key = storage.key(i);
          if (key === shared || key?.startsWith(`${shared}.`)) {
            out.push({ key, tabId: key === shared ? null : key.slice(shared.length + 1), payload: parse(storage.getItem(key)) });
          }
        }
      } catch {
        /* storage unavailable: nothing to restore */
      }
      return out;
    },
    remove,
  };
}
