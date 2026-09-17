import type { TLStore } from "tldraw";
import { applyRemotePlan } from "./applyRemotePlan";
import { mergeDocumentRecords } from "./mergeDocumentRecords";
import type { BackupPayload } from "./types";

/**
 * Replay an unsaved-changes backup over a freshly loaded store: the backup's `changed` records
 * are put (local edits win, even when the loaded row is newer than `backup.baseVersion`) and
 * its `removed` ids are removed. Everything else comes from the loaded store untouched.
 * Returns how many records were applied.
 */
export function restoreBackupInto(store: TLStore, backup: BackupPayload, loadedVersion: number | null): { applied: number } {
  void loadedVersion; // local edits win regardless of how far the server moved on
  const local = backup.snapshot.store as Record<string, unknown>;
  const changed = new Set(backup.changed);
  const removed = new Set(backup.removed);
  const current = store.getStoreSnapshot("document").store as Record<string, unknown>;
  const { merged } = mergeDocumentRecords({ local, remote: current, changed, removed });

  const put: unknown[] = [];
  for (const id of changed) {
    if (Object.prototype.hasOwnProperty.call(merged, id)) put.push(merged[id]);
  }
  const remove = [...removed].filter((id) => Object.prototype.hasOwnProperty.call(current, id));
  const report = applyRemotePlan(store, { put, remove });
  return { applied: report.put + report.removed };
}
