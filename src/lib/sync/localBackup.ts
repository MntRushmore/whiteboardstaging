import type { BackupPayload, LocalBackup } from "./types";

export const BACKUP_KEY_PREFIX = "agathon.unsaved.";
/**
 * One backup's budget, in bytes as Safari counts them (`storedBytes`). Safari gives an origin
 * 5 MB of localStorage, so two backups this size fit beside the session and the rest; Chromium's
 * 10 MB (5.2 M characters) holds more.
 */
export const BACKUP_MAX_BYTES = 2_000_000;
/**
 * A backup older than this may be evicted to make room for a newer one (`write`). A backup is
 * replayed the next time its board opens, so one this old belongs to a board the student has not
 * opened for a week (and Safari itself deletes a site's storage after 7 days of use without a visit).
 */
export const STALE_BACKUP_MS = 7 * 24 * 60 * 60 * 1000;

/** Any UTF-16 code unit above U+00FF: WebKit then stores the whole string as UTF-16. */
const WIDE_CHAR = /[Ā-￿]/;

/**
 * Bytes `value` takes in Safari's localStorage. WebKit keeps a string whose characters are all
 * Latin-1 at 1 byte each, but the whole string at 2 bytes each once any character is above U+00FF
 * (one "√" in a recognized line), and counts those bytes against its 5 MB quota: the same 2 M
 * characters cost 2 MB or 4 MB. Chromium counts 2 bytes per character either way, against 10 MB,
 * so the bound is conservative there too.
 */
export function storedBytes(value: string): number {
  return WIDE_CHAR.test(value) ? value.length * 2 : value.length;
}

/** The browser refused a write because the origin's storage is full (not because it is blocked). */
export function isQuotaError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const { name, code } = error as { name?: unknown; code?: unknown };
  // QuotaExceededError (code 22) everywhere; NS_ERROR_DOM_QUOTA_REACHED (1014) in older Firefox
  return name === "QuotaExceededError" || name === "NS_ERROR_DOM_QUOTA_REACHED" || code === 22 || code === 1014;
}

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
  /**
   * These keys' records are now this tab's own unsaved changes (a restore replayed them): until
   * they are removed, they are the first backups `write` evicts when storage is full.
   */
  absorb(keys: readonly string[]): void;
}

/**
 * Unsaved-changes backup in `localStorage` under `agathon.unsaved.<boardId>.<tabId>`.
 *
 * `write` keeps a backup within `maxBytes` as Safari counts them (`storedBytes`), dropping the
 * optional `base` / `sent` copies (they only sharpen a restore) when the whole payload is over
 * that or does not fit in what storage has left. When storage is full it then makes room by
 * evicting, oldest first, backups this tab has restored (`absorb`), unreadable ones, and ones
 * older than STALE_BACKUP_MS; never another tab's recent backup. If the new backup still does not
 * fit, or is over `maxBytes` even trimmed, `write` returns false and leaves this tab's previous
 * backup in place: older unsaved work beats none, and a restore is record by record and
 * base-aware. `read` returns null for anything malformed.
 */
export function createLocalStorageBackup(
  storage: Storage | undefined = defaultStorage(),
  maxBytes = BACKUP_MAX_BYTES,
  tabId: string = newTabId(),
  now: () => number = Date.now,
): DeviceBackups {
  /** other tabs' backup keys whose records this tab carries now (restored) */
  const absorbed = new Set<string>();
  const remove = (key: string): void => {
    absorbed.delete(key);
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

  /** "ok"; "full" (over quota: making room may help); "failed" (storage blocked or broken) */
  const trySet = (store: Storage, key: string, raw: string): "ok" | "full" | "failed" => {
    try {
      store.setItem(key, raw);
      return "ok";
    } catch (e) {
      return isQuotaError(e) ? "full" : "failed";
    }
  };

  /** Backups `write` may evict to make room, in the order it evicts them (never `ownKey`). */
  const evictable = (store: Storage, ownKey: string): string[] => {
    const found: Array<{ key: string; rank: number; at: number }> = [];
    try {
      for (let i = 0; i < store.length; i++) {
        const key = store.key(i);
        if (!key || key === ownKey || !key.startsWith(BACKUP_KEY_PREFIX)) continue;
        const payload = parse(store.getItem(key));
        const at = payload?.at ?? Number.NEGATIVE_INFINITY;
        if (absorbed.has(key)) found.push({ key, rank: 0, at });
        else if (!payload) found.push({ key, rank: 1, at });
        else if (now() - payload.at > STALE_BACKUP_MS) found.push({ key, rank: 2, at });
      }
    } catch {
      /* storage unavailable */
    }
    return found.sort((a, b) => a.rank - b.rank || a.at - b.at).map((f) => f.key);
  };

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
      const key = backupKey(boardId, tabId);
      // What to store, best first: the whole payload, then without the base copies.
      const forms: string[] = [];
      try {
        const whole = JSON.stringify(payload);
        if (storedBytes(whole) <= maxBytes) forms.push(whole);
        if (payload.base || payload.sent) {
          const { base: _base, sent: _sent, ...plain } = payload;
          void _base;
          void _sent;
          const trimmed = JSON.stringify(plain);
          if (storedBytes(trimmed) <= maxBytes) forms.push(trimmed);
        }
      } catch {
        return false;
      }
      if (forms.length === 0) return false;
      for (const raw of forms) {
        const result = trySet(storage, key, raw);
        if (result !== "full") return result === "ok";
      }
      // Storage is full: make room, one eviction at a time, for the smallest form.
      const smallest = forms[forms.length - 1];
      for (const victim of evictable(storage, key)) {
        remove(victim);
        const result = trySet(storage, key, smallest);
        if (result !== "full") return result === "ok";
      }
      return false;
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
    absorb(keys) {
      for (const key of keys) absorbed.add(key);
    },
  };
}
