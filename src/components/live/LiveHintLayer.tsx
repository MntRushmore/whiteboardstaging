"use client";

import { useValue, type Editor } from "tldraw";
import { Button } from "@/components/ui/button";
import type { LiveController, OpenHint } from "@/lib/live/contracts";
import { liveStore } from "@/lib/live/liveStore";
import { LIVE_COPY } from "./copy";

interface LiveHintLayerProps {
  editor: Editor;
  controller: LiveController;
}

const CARD_MAX_W = 280;
const CARD_EST_H = 112;
const EDGE = 8;

interface PlacedHint {
  hint: OpenHint;
  left: number;
  top: number;
  width: number;
}

/**
 * Absolutely positioned overlay child of BoardContent. Each open hint is anchored to the
 * bottom-left of its line's echo (page coords -> screen via editor.pageToScreen), clamped
 * inside the tldraw container, and re-computed whenever the camera or the echo moves.
 */
export function LiveHintLayer({ editor, controller }: LiveHintLayerProps) {
  const placed = useValue(
    "live.hintPlacement",
    (): PlacedHint[] => {
      const hints = liveStore.openHints.get();
      if (hints.length === 0) return [];
      const lines = liveStore.lines.get();
      // read the camera so the computation re-runs on pan/zoom
      editor.getCamera();
      const screen = editor.getViewportScreenBounds();
      const width = Math.min(CARD_MAX_W, Math.max(160, screen.width - EDGE * 2));

      return hints.map((hint) => {
        const state = lines[hint.lineId];
        let anchor: { x: number; y: number } | null = null;
        if (state?.mathShapeId) {
          const b = editor.getShapePageBounds(state.mathShapeId);
          if (b) anchor = { x: b.x, y: b.maxY + 8 };
        }
        if (!anchor && state?.line) {
          const r = state.line.bounds;
          anchor = { x: r.x, y: r.y + r.h + 12 };
        }
        // no anchor yet: park the card near the top-centre of the viewport
        const p = anchor
          ? editor.pageToScreen(anchor)
          : { x: screen.x + screen.width / 2 - width / 2, y: screen.y + 72 };
        const left = Math.min(Math.max(p.x - screen.x, EDGE), Math.max(EDGE, screen.width - width - EDGE));
        const top = Math.min(Math.max(p.y - screen.y, EDGE), Math.max(EDGE, screen.height - CARD_EST_H - EDGE));
        return { hint, left, top, width };
      });
    },
    [editor],
  );

  if (placed.length === 0) return null;

  return (
    <div className="live-hint-layer pointer-events-none absolute inset-0 z-[900]" aria-label={LIVE_COPY.hint.region}>
      {placed.map(({ hint, left, top, width }) => (
        <div
          key={hint.id}
          className="live-hint-card pointer-events-auto absolute rounded-xl border border-amber-200 bg-white p-3 text-sm text-gray-800 shadow-md"
          style={{ left, top, width }}
          role="note"
        >
          <div className="mb-1 flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wide text-amber-700">
            <span className="live-hint-card__dot" aria-hidden />
            {LIVE_COPY.hint.levelLabel(hint.level)}
          </div>
          <p className="leading-snug">{hint.message}</p>
          {hint.question && <p className="mt-1 leading-snug text-gray-600">{hint.question}</p>}
          <div className="mt-2 flex items-center justify-end gap-2">
            <Button variant="ghost" size="sm" className="h-7 px-2 text-xs" onClick={() => controller.escalate(hint.lineId)}>
              {LIVE_COPY.hint.moreHelp}
            </Button>
            <Button variant="secondary" size="sm" className="h-7 px-2.5 text-xs" onClick={() => controller.dismissHint(hint.id)}>
              {LIVE_COPY.hint.gotIt}
            </Button>
          </div>
        </div>
      ))}
    </div>
  );
}
