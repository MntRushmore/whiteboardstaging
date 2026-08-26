"use client";

import { useValue, type Editor } from "tldraw";
import { getPendingTutorShapeIds } from "@/lib/tutor/applyMarks";

export function MarkActions({
  editor,
  problemId,
  onAccept,
  onReject,
}: {
  editor: Editor;
  problemId: number;
  onAccept: () => void;
  onReject: () => void;
}) {
  const pos = useValue(
    "tutor-mark-actions",
    () => {
      const ids = getPendingTutorShapeIds(editor, problemId);
      if (ids.length === 0) return null;
      let minX = Infinity;
      let minY = Infinity;
      let maxX = -Infinity;
      for (const id of ids) {
        const box = editor.getShapePageBounds(id);
        if (!box) continue;
        minX = Math.min(minX, box.x);
        minY = Math.min(minY, box.y);
        maxX = Math.max(maxX, box.x + box.w);
      }
      if (!Number.isFinite(maxX)) return null;
      const screen = editor.pageToViewport({ x: maxX + 12, y: minY });
      return { left: screen.x, top: screen.y };
    },
    [editor, problemId],
  );

  if (!pos) return null;

  return (
    <div
      className="mark-actions"
      style={{ left: pos.left, top: pos.top }}
      role="group"
      aria-label="Tutor mark"
    >
      <button type="button" className="mark-actions-item" onClick={onAccept}>
        Accept
      </button>
      <button type="button" className="mark-actions-item is-reject" onClick={onReject}>
        Reject
      </button>
    </div>
  );
}
