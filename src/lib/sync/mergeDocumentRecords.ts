import { deepEqual } from "./deepEqual";
import type { MergeResult } from "./types";

/** Session-scoped tldraw record types: never persisted, never merged. */
export const SESSION_TYPE_NAMES: ReadonlySet<string> = new Set([
  "instance",
  "instance_page_state",
  "camera",
  "pointer",
  "instance_presence",
]);

export interface MergeArgs {
  /** `snapshot.store` of the local document */
  local: Record<string, unknown>;
  /** `snapshot.store` of the row another tab saved */
  remote: Record<string, unknown>;
  /** ids added or updated locally since the base version */
  changed: Set<string>;
  /** ids removed locally since the base version */
  removed: Set<string>;
}

function isSessionRecord(record: unknown): boolean {
  if (!record || typeof record !== "object") return false;
  const typeName = (record as { typeName?: unknown }).typeName;
  return typeof typeName === "string" && SESSION_TYPE_NAMES.has(typeName);
}

/**
 * Record-level three-way merge of two `TLStoreSnapshot.store` maps.
 *
 * Starting from `remote` (the row that won the race):
 *  - id in `changed`  -> the local record wins (a local add when remote lacks it)
 *  - id in `removed`  -> excluded; if remote still has it, plan to remove it
 *  - id only local, untouched      -> remote deleted it -> plan to remove it locally
 *  - id only remote, not removed   -> remote added it   -> plan to put it locally
 *  - id in both, untouched locally, deep-unequal -> remote wins -> plan to put it locally
 *
 * `merged` is the resulting document map; `put` / `remove` is the plan that turns the local
 * store into `merged` (see `applyRemotePlan`). Inputs are never mutated.
 */
export function mergeDocumentRecords({ local, remote, changed, removed }: MergeArgs): MergeResult {
  const merged: Record<string, unknown> = {};
  const put: unknown[] = [];
  const remove: string[] = [];

  for (const id of Object.keys(remote)) {
    const remoteRecord = remote[id];
    if (isSessionRecord(remoteRecord)) continue;
    if (removed.has(id)) {
      remove.push(id);
      continue;
    }
    const hasLocal = Object.prototype.hasOwnProperty.call(local, id);
    const localRecord = hasLocal ? local[id] : undefined;
    if (hasLocal && isSessionRecord(localRecord)) continue;
    if (changed.has(id)) {
      if (hasLocal) {
        merged[id] = localRecord;
      } else {
        // Flagged as changed but gone locally: the local state is "absent", so it wins as a removal.
        remove.push(id);
      }
      continue;
    }
    merged[id] = remoteRecord;
    if (!hasLocal || !deepEqual(localRecord, remoteRecord)) put.push(remoteRecord);
  }

  for (const id of Object.keys(local)) {
    if (Object.prototype.hasOwnProperty.call(remote, id)) continue;
    const localRecord = local[id];
    if (isSessionRecord(localRecord)) continue;
    if (removed.has(id)) continue;
    if (changed.has(id)) {
      merged[id] = localRecord;
    } else {
      // Untouched here, missing remotely: the other tab deleted it.
      remove.push(id);
    }
  }

  return { merged, put, remove };
}
