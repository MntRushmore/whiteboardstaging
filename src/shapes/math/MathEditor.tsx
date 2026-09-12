"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { stopEventPropagation, useEditor } from "tldraw";
import type { MathShape } from "@/lib/live/contracts";
import { renderLatex } from "./katex";

/**
 * Inline LaTeX editor shown while a `math` shape is being edited (double-click / Enter /
 * the Math tool). Commits on blur or Enter with a USER-sourced update so the Live loop's
 * listener sees `meta.edited` and re-analyzes without recognition. Escape cancels.
 */
export function MathEditor({ shape, fontSize }: { shape: MathShape; fontSize: number }) {
  const editor = useEditor();
  const [value, setValue] = useState(shape.props.latex);
  const ref = useRef<HTMLTextAreaElement>(null);
  /** last LaTeX written to the store (starts at the shape's current value) */
  const lastCommitted = useRef(shape.props.latex);
  const cancelled = useRef(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.focus();
    el.select();
  }, []);

  const commit = useCallback(
    (next: string) => {
      if (cancelled.current) return;
      const latex = next.trim();
      if (latex === lastCommitted.current) return;
      lastCommitted.current = latex;
      // user-sourced on purpose: undoable, and WP-D's listener re-analyzes the edited line
      editor.updateShape<MathShape>({
        id: shape.id,
        type: "math",
        props: { latex },
        meta: { ...shape.meta, edited: true },
      });
    },
    [editor, shape.id, shape.meta],
  );

  const finish = useCallback(
    (save: boolean) => {
      if (save) commit(value);
      else cancelled.current = true;
      // leaves select.editing_shape (the select tool handles the complete/cancel event)
      if (save) editor.complete();
      else editor.cancel();
    },
    [commit, editor, value],
  );

  return (
    <div
      className="live-math__editor"
      onPointerDown={stopEventPropagation}
      onPointerUp={stopEventPropagation}
      onWheel={stopEventPropagation}
      onTouchStart={stopEventPropagation}
      onTouchEnd={stopEventPropagation}
      style={{ pointerEvents: "all", fontSize }}
    >
      <textarea
        ref={ref}
        className="live-math__textarea"
        value={value}
        rows={1}
        spellCheck={false}
        autoCapitalize="off"
        autoCorrect="off"
        placeholder="LaTeX, e.g. 2x + 3 = 11"
        onChange={(e) => setValue(e.target.value)}
        onBlur={() => commit(value)}
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            finish(true);
          } else if (e.key === "Escape") {
            e.preventDefault();
            finish(false);
          }
        }}
      />
      <div
        className="live-math__preview"
        aria-hidden
        dangerouslySetInnerHTML={{ __html: renderLatex(value) || "&nbsp;" }}
      />
    </div>
  );
}
