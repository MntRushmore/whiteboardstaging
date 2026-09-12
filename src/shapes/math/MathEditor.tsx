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
  const committedRef = useRef(false);
  const initialRef = useRef(shape.props.latex);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.focus();
    el.select();
  }, []);

  const commit = useCallback(
    (next: string) => {
      if (committedRef.current) return;
      committedRef.current = true;
      const latex = next.trim();
      if (latex === initialRef.current) return;
      editor.updateShape<MathShape>({
        id: shape.id,
        type: "math",
        props: { latex, source: shape.props.source === "echo" ? "echo" : "student" },
        meta: { ...shape.meta, edited: true },
      });
    },
    [editor, shape.id, shape.meta, shape.props.source],
  );

  const finish = useCallback(
    (save: boolean) => {
      if (save) commit(value);
      else committedRef.current = true;
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
