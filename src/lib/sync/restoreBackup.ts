import type { TLStore } from "tldraw";
import { applyRemotePlan } from "./applyRemotePlan";
import { deepEqual } from "./deepEqual";
import { mergeDocumentRecords } from "./mergeDocumentRecords";
import type { BackupPayload } from "./types";

const has = (o: object, id: string): boolean => Object.prototype.hasOwnProperty.call(o, id);

/**
 * Replay an unsaved-changes backup over a freshly loaded store: the backup's `changed` records
 * are put (local edits win, even when the loaded row is newer than `backup.baseVersion`) and
 * its `removed` ids are removed. Everything else comes from the loaded store untouched.
 * Records written by an older schema (a deploy since) are migrated first. Returns how many
 * records actually changed: a backup whose save landed before the tab closed applies nothing.
 */
export function restoreBackupInto(store: TLStore, backup: BackupPayload, loadedVersion: number | null): { applied: number } {
  void loadedVersion; // local edits win regardless of how far the server moved on
  let local = backup.snapshot.store as Record<string, unknown>;
  try {
    const migrated = store.schema.migrateStoreSnapshot(backup.snapshot);
    if (migrated.type === "success") local = migrated.value as Record<string, unknown>;
  } catch {
    /* keep the records as written; applyRemotePlan skips any that no longer validate */
  }
  const changed = new Set(backup.changed);
  const removed = new Set(backup.removed);
  const current = store.getStoreSnapshot("document").store as Record<string, unknown>;
  const { merged } = mergeDocumentRecords({ local, remote: current, changed, removed });

  const put: unknown[] = [];
  for (const id of changed) {
    if (has(merged, id) && !(has(current, id) && deepEqual(current[id], merged[id]))) put.push(merged[id]);
  }
  const remove = [...removed].filter((id) => has(current, id));
  const report = applyRemotePlan(store, { put, remove });
  return { applied: report.put + report.removed };
}
