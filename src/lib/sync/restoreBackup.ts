import type { TLStore, TLStoreSnapshot } from "tldraw";
import { applyRemotePlan } from "./applyRemotePlan";
import { deepEqual } from "./deepEqual";
import { SESSION_TYPE_NAMES } from "./mergeDocumentRecords";
import type { DeviceBackups } from "./localBackup";
import { openTabIds } from "./tabLock";
import type { BackupPayload, SaveQueue } from "./types";

const has = (o: object, id: string): boolean => Object.prototype.hasOwnProperty.call(o, id);
const valueOf = (o: Record<string, unknown>, id: string): unknown => (has(o, id) ? o[id] : undefined);

export interface RestoreReport {
  /** records the restore put or removed */
  applied: number;
  /** unsaved local changes NOT restored because the server changed the same record since (the student is told) */
  stale: number;
}

/** Records written by an older schema (a deploy since the backup) are migrated first. */
function migrated(store: TLStore, records: Record<string, unknown> | undefined, schema: TLStoreSnapshot["schema"]): Record<string, unknown> | undefined {
  if (!records) return undefined;
  try {
    const result = store.schema.migrateStoreSnapshot({ store: records, schema } as TLStoreSnapshot);
    if (result.type === "success") return result.value as Record<string, unknown>;
  } catch {
    /* keep the records as written; applyRemotePlan skips any that no longer validate */
  }
  return records;
}

/**
 * Replay unsaved-changes backups over a freshly loaded store, oldest first, record by record (the
 * same granularity as the save queue's conflict merge). For each record a backup changed or
 * removed, the loaded row decides:
 *
 *  - the server still has it as it was at the backup's base version -> only this device changed
 *    it: the local change is restored (put, or removed)
 *  - the server has exactly what a write of this device sent (`backup.sent`: it landed, the tab
 *    died before hearing so) -> still this device's own: restored
 *  - the server changed it too (edited, or deleted, since the base) -> the server's record stays
 *    and the stale local change is dropped and counted in `stale`
 *  - the server already holds the local record -> nothing to do
 *
 * A newer backup's decision about a record replaces an older one's. Backups written before
 * 2026-10-03 carry no base records: when the row is still at their base version every change is
 * restored; when it moved on, a record the server has and the backup changed is kept as the
 * server has it, and one the server lacks is restored (most likely a new stroke).
 * Everything else comes from the loaded store untouched; nothing is applied when every backup's
 * save had in fact landed.
 */
export function restoreBackups(store: TLStore, backups: readonly BackupPayload[], loadedVersion: number | null): RestoreReport {
  const server = store.getStoreSnapshot("document").store as Record<string, unknown>;
  /** id -> record to put, or null to remove */
  const outcome = new Map<string, unknown>();
  const stale = new Set<string>();

  for (const backup of [...backups].sort((a, b) => a.at - b.at)) {
    const { schema } = backup.snapshot;
    const local = migrated(store, backup.snapshot.store as Record<string, unknown>, schema) ?? {};
    const base = migrated(store, backup.base, schema);
    // `sent` marks a removal with null, which is not a record to migrate
    const sentRemovals = Object.entries(backup.sent ?? {}).filter(([, v]) => v === null);
    const sentRecords = Object.fromEntries(Object.entries(backup.sent ?? {}).filter(([, v]) => v !== null));
    const sent = backup.sent && { ...Object.fromEntries(sentRemovals), ...migrated(store, sentRecords, schema) };
    const atBase = backup.baseVersion !== null && backup.baseVersion === loadedVersion;
    /** did the server change `id` after this backup's base version (other than by this device's own write)? */
    const serverMoved = (id: string): boolean => {
      const now = valueOf(server, id);
      if (base ? deepEqual(now, valueOf(base, id)) : atBase || now === undefined) return false;
      if (sent && has(sent, id) && deepEqual(now ?? null, sent[id])) return false;
      return true;
    };
    const decide = (id: string, value: unknown): void => {
      if (value === null ? !has(server, id) : deepEqual(valueOf(server, id), value)) {
        outcome.set(id, value); // the server already agrees
        stale.delete(id);
      } else if (serverMoved(id)) {
        if (!outcome.has(id)) stale.add(id);
      } else {
        outcome.set(id, value);
        stale.delete(id);
      }
    };
    for (const id of backup.changed) {
      const record = valueOf(local, id) as { typeName?: string } | undefined;
      if (record && !SESSION_TYPE_NAMES.has(record.typeName ?? "")) decide(id, record);
    }
    for (const id of backup.removed) decide(id, null);
  }

  const put: unknown[] = [];
  const remove: string[] = [];
  for (const [id, value] of outcome) {
    if (value === null) {
      if (has(server, id)) remove.push(id);
    } else if (!deepEqual(valueOf(server, id), value)) put.push(value);
  }
  const report = applyRemotePlan(store, { put, remove });
  return { applied: report.put + report.removed, stale: stale.size };
}

/** One backup (see `restoreBackups`). */
export function restoreBackupInto(store: TLStore, backup: BackupPayload, loadedVersion: number | null): RestoreReport {
  return restoreBackups(store, [backup], loadedVersion);
}

export interface RestoreDeviceBackupsArgs {
  store: TLStore;
  boardId: string;
  /** `whiteboards.version` of the row the store was loaded from */
  loadedVersion: number | null;
  /** this mount's backup (its own key is never replayed) */
  backup: DeviceBackups;
  queue: Pick<SaveQueue, "markDirty" | "writeBackupNow">;
  /** true once the board unmounted: nothing is applied */
  cancelled: () => boolean;
  /** injectable for tests */
  openTabs?: () => Promise<Set<string> | null>;
}

/**
 * Replay the unsaved work this device kept for the board over the loaded row: every backup key
 * whose tab is gone (closed, crashed, an earlier page load, the shared key of older deploys), oldest
 * first; a tab that is still open saves its own. Restored records are this tab's unsaved changes
 * from then on (saved, and in its own backup, written at once) and the replayed keys are removed.
 * Without Web Locks every other key counts as gone. Null when there was nothing to replay.
 * (src/hooks/useSnapshotSave.ts loads this module only when such a key exists.)
 */
export async function restoreDeviceBackups({
  store,
  boardId,
  loadedVersion,
  backup,
  queue,
  cancelled,
  openTabs = openTabIds,
}: RestoreDeviceBackupsArgs): Promise<RestoreReport | null> {
  const found = backup.list(boardId).filter((b) => b.tabId !== backup.tabId);
  if (found.length === 0) return null;
  const open = await openTabs();
  const gone = found.filter((b) => !(b.tabId && open?.has(b.tabId)));
  if (gone.length === 0 || cancelled()) return null;
  const payloads = gone.flatMap((b) => (b.payload ? [b.payload] : []));
  let report: RestoreReport = { applied: 0, stale: 0 };
  if (payloads.length > 0) {
    report = restoreBackups(store, payloads, loadedVersion);
    queue.markDirty();
    if (report.applied > 0) {
      // What is still unsaved now goes into this tab's backup before the old keys go: no window
      // without one. If storage is full, the old keys (their records are in it) make the room; if
      // even that is not enough, the old keys stay (the write puts back what it evicted) and are
      // replayed again next time.
      backup.absorb(gone.map((b) => b.key));
      if (!queue.writeBackupNow()) return report;
    }
  }
  for (const b of gone) backup.remove(b.key);
  return report;
}
