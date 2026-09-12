import type { Editor } from "tldraw";

/**
 * Every programmatic write of the Live layer. mergeRemoteChanges tags the change source
 * 'remote': not in the undo stack, invisible to the legacy source:'user' listeners
 * (idle trigger, cancel-in-flight). The autosave listener uses source:'all' so these
 * writes are still persisted.
 *
 * The store throws if this is called inside an atomic op or a store listener, so callers
 * that run inside a listener use scheduleLiveWrite.
 */
export function liveWrite(editor: Editor, fn: () => void): void {
  editor.store.mergeRemoteChanges(fn);
}

export function scheduleLiveWrite(editor: Editor, fn: () => void): void {
  queueMicrotask(() => {
    try {
      liveWrite(editor, fn);
    } catch (e) {
      console.warn("[live] write failed", e);
    }
  });
}
