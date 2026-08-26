"use client";

import { useMemo } from "react";
import katex from "katex";
import "katex/dist/katex.min.css";
import { useValue, type Editor } from "tldraw";
import { CONFIDENCE_THRESHOLD, type ClusterBounds } from "@/lib/tutor/types";

export function LatexStrip({
  editor,
  latex,
  confidence,
  bounds,
}: {
  editor: Editor;
  latex: string;
  confidence: number;
  bounds: ClusterBounds | null;
}) {
  const html = useMemo(() => {
    if (!latex.trim() || confidence < CONFIDENCE_THRESHOLD) return "";
    try {
      return katex.renderToString(latex.replace(/^\$+|\$+$/g, ""), {
        throwOnError: false,
        displayMode: false,
      });
    } catch {
      return "";
    }
  }, [latex, confidence]);

  const screen = useValue(
    "tutor-latex-strip",
    () => {
      if (!bounds || !html) return null;
      return editor.pageToViewport({ x: bounds.x, y: bounds.y });
    },
    [editor, bounds, html],
  );

  if (!html || !screen || !bounds) return null;

  return (
    <div
      className="tutor-latex-strip"
      style={{
        position: "absolute",
        left: screen.x,
        top: screen.y - 36,
        zIndex: 900,
        pointerEvents: "none",
      }}
      aria-label="Recognized math"
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}
