import type { TLStore } from "tldraw";
import type { DirtyToken, DirtyTracker } from "./types";

/**
 * Records which document records changed locally since the last successful save.
 *
 * Semantics per id:
 *  - added / updated            -> in `changed`
 *  - removed                    -> in `removed` (and dropped from `changed`, so add-then-remove is only a removal)
 *  - removed then re-added      -> back in `changed`
 *
 * `begin()` hands the current sets to a save cycle and starts fresh ones, so edits made while a
 * save is in flight stay pending. If the save fails, `restore(token)` merges the sets back.
 *
 * Source is `'all'` on purpose: Live's `mergeRemoteChanges` writes (echoes, graphs, AI steps) are
 * part of the document and must be persisted like user strokes.
 */
export function createDirtyTracker(store: TLStore): DirtyTracker {
  let changed = new Set<string>();
  let removed = new Set<string>();

  const dispose = store.listen(
    ({ changes }) => {
      for (const id of Object.keys(changes.added)) {
        changed.add(id);
        removed.delete(id);
      }
      for (const id of Object.keys(changes.updated)) {
        changed.add(id);
        removed.delete(id);
      }
      for (const id of Object.keys(changes.removed)) {
        removed.add(id);
        changed.delete(id);
      }
    },
    { scope: "document", source: "all" },
  );

  return {
    begin() {
      // Outside tests tldraw delivers history on the next frame; pull anything already
      // committed so the token matches the snapshot a caller takes right after begin().
      flushHistory(store);
      const token: DirtyToken = { changed, removed };
      changed = new Set();
      removed = new Set();
      return token;
    },
    restore(token) {
      // Pending sets are newer than the token: a record removed after the failed save stays
      // removed, a record re-added after the failed save stays changed.
      for (const id of token.changed) if (!removed.has(id)) changed.add(id);
      for (const id of token.removed) if (!changed.has(id)) removed.add(id);
    },
    hasPending() {
      flushHistory(store);
      return changed.size > 0 || removed.size > 0;
    },
    peek() {
      flushHistory(store);
      return { changed: new Set(changed), removed: new Set(removed) };
    },
    dispose,
  };
}

/** `Store._flushHistory` is internal but stable across tldraw 2-4; skip silently if absent. */
function flushHistory(store: TLStore): void {
  const s = store as unknown as { _flushHistory?: () => void };
  try {
    s._flushHistory?.();
  } catch {
    /* history delivery falls back to the frame reactor */
  }
}
