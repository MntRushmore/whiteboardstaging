import type { TLRecord, TLStore } from "tldraw";
import type { RemotePlan } from "./types";

export interface ApplyReport {
  /** records written */
  put: number;
  /** ids removed (only ids that existed) */
  removed: number;
  /** records rejected by schema validation and skipped */
  skipped: number;
}

function isRecordLike(value: unknown): value is TLRecord {
  return (
    !!value &&
    typeof value === "object" &&
    typeof (value as { id?: unknown }).id === "string" &&
    typeof (value as { typeName?: unknown }).typeName === "string"
  );
}

/**
 * Apply a merge plan to the live store as a remote change (source `'remote'`, one atomic
 * transaction, no undo entry). Records that fail schema validation are skipped one by one
 * instead of aborting the whole merge; the report says how many.
 */
export function applyRemotePlan(store: TLStore, plan: RemotePlan): ApplyReport {
  const report: ApplyReport = { put: 0, removed: 0, skipped: 0 };
  const valid: TLRecord[] = [];
  for (const candidate of plan.put) {
    if (!isRecordLike(candidate)) {
      report.skipped++;
      continue;
    }
    try {
      const before = store.get(candidate.id) ?? null;
      store.schema.validateRecord(store, candidate, before ? "updateRecord" : "createRecord", before);
      valid.push(candidate);
    } catch {
      report.skipped++;
    }
  }
  const removeIds = plan.remove.filter((id) => store.has(id as TLRecord["id"])) as TLRecord["id"][];
  if (valid.length === 0 && removeIds.length === 0) return report;

  store.mergeRemoteChanges(() => {
    if (valid.length) {
      try {
        store.put(valid);
        report.put += valid.length;
      } catch {
        // A side effect or integrity rule rejected the batch: fall back to one record at a time.
        for (const record of valid) {
          try {
            store.put([record]);
            report.put++;
          } catch {
            report.skipped++;
          }
        }
      }
    }
    if (removeIds.length) {
      store.remove(removeIds);
      report.removed += removeIds.length;
    }
  });
  return report;
}
