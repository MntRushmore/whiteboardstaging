"use client";

import { useEffect, useState } from "react";
import { atom, useValue, type Atom, type Editor } from "tldraw";
import { Button } from "@/components/ui/button";
import type { LiveController, OpenHint } from "@/lib/live/contracts";
import { clearLiveError, liveStore, retryLiveError, type LiveError } from "@/lib/live/liveStore";
import { LIVE_COPY } from "./copy";
import { errorCardTitle, liveErrorView } from "./errorView";
import {
  BOARD_BAR_ATTR,
  BOTTOM_UI_SELECTOR,
  cardWidth,
  errorCardAnchor,
  lineAnchor,
  placeCard,
  type CardPlacement,
} from "./hintPlacement";
import { useLiveErrorClock } from "./LiveStatusPill";

interface LiveHintLayerProps {
  editor: Editor;
  controller: LiveController;
}

type PlacedCard = ({ kind: "hint"; hint: OpenHint } | { kind: "error"; error: LiveError & { lineId: string } }) & CardPlacement;

interface ChromeInsets {
  top: number;
  bottom: number;
}

/**
 * How much of the canvas the board's own UI covers: the top bar (to its bottom; it wraps to three
 * rows on a phone) and tldraw's bottom toolbar. Kept in an atom so the placement below re-runs
 * when either changes size, without setting React state inside an effect.
 */
function useChromeInsets(editor: Editor): Atom<ChromeInsets> {
  const [insets] = useState(() => atom<ChromeInsets>("live.cardInsets", { top: 0, bottom: 0 }));
  useEffect(() => {
    const container = editor.getContainer();
    const observed = new Set<Element>();
    const ro = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(() => measure());
    const watch = (el: Element | null) => {
      if (!el || !ro || observed.has(el)) return;
      observed.add(el);
      ro.observe(el);
    };
    function measure() {
      const box = container.getBoundingClientRect();
      // the bar is the board page's, mounted beside the canvas inside this container
      const bar = container.querySelector(`[${BOARD_BAR_ATTR}]`) ?? document.querySelector(`[${BOARD_BAR_ATTR}]`);
      const bottomUi = container.querySelector(BOTTOM_UI_SELECTOR);
      watch(bar);
      watch(bottomUi);
      const top = bar ? Math.max(0, bar.getBoundingClientRect().bottom - box.top) : 0;
      const bottom = bottomUi ? Math.max(0, box.bottom - bottomUi.getBoundingClientRect().top) : 0;
      const prev = insets.get();
      if (prev.top !== top || prev.bottom !== bottom) insets.set({ top, bottom });
    }
    watch(container);
    measure();
    return () => ro?.disconnect();
  }, [editor, insets]);
  return insets;
}

/**
 * Absolutely positioned overlay child of BoardContent. Each open hint sits by its line (the ink
 * and its readback, page coords -> screen via editor.pageToScreen), between the top bar and the
 * bottom toolbar (`placeCard`), and is re-computed whenever the camera, the line or the chrome
 * moves. A failed check or solve the student asked for gets the same card, with Retry and
 * Dismiss, when its line is on the screen; otherwise the status pill shows it (never both).
 */
export function LiveHintLayer({ editor, controller }: LiveHintLayerProps) {
  const insets = useChromeInsets(editor);
  const placed = useValue(
    "live.hintPlacement",
    (): PlacedCard[] => {
      const hints = liveStore.openHints.get();
      const lines = liveStore.lines.get();
      // read the camera so the computation re-runs on pan/zoom
      editor.getCamera();
      const error = liveStore.lastError.get();
      const errorAnchor = errorCardAnchor(editor, error, lines);
      if (hints.length === 0 && !errorAnchor) return [];
      const screen = editor.getViewportScreenBounds();
      const { top, bottom } = insets.get();
      const area = { width: screen.width, height: screen.height, top, bottom };
      const width = cardWidth(screen.width);
      // cards on the same line stack instead of covering each other
      const perLine = new Map<string, number>();
      const place = (lineId: string) => {
        const stack = perLine.get(lineId) ?? 0;
        perLine.set(lineId, stack + 1);
        return placeCard(lineAnchor(editor, lines[lineId]), area, { width, stack });
      };

      const out: PlacedCard[] = hints.map((hint) => ({ kind: "hint", hint, ...place(hint.lineId) }));
      if (errorAnchor && error?.lineId) out.push({ kind: "error", error: error as LiveError & { lineId: string }, ...place(error.lineId) });
      return out;
    },
    [editor, insets],
  );

  if (placed.length === 0) return null;

  return (
    <div className="live-hint-layer pointer-events-none absolute inset-0 z-[900]" aria-label={LIVE_COPY.hint.region}>
      {placed.map((card) =>
        card.kind === "hint" ? (
          <div
            key={card.hint.id}
            className="live-hint-card pointer-events-auto absolute rounded-xl border border-amber-200 bg-white p-3 text-sm text-gray-800 shadow-md"
            style={{ left: card.left, top: card.top, width: card.width }}
            role="note"
          >
            <div className="mb-1 flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wide text-amber-700">
              <span className="live-hint-card__dot" aria-hidden />
              {LIVE_COPY.hint.levelLabel(card.hint.level)}
            </div>
            <p className="leading-snug">{card.hint.message}</p>
            {card.hint.question && <p className="mt-1 leading-snug text-gray-600">{card.hint.question}</p>}
            <div className="mt-2 flex items-center justify-end gap-2">
              <Button variant="ghost" size="sm" className="h-7 px-2 text-xs" onClick={() => controller.escalate(card.hint.lineId)}>
                {LIVE_COPY.hint.moreHelp}
              </Button>
              <Button variant="secondary" size="sm" className="h-7 px-2.5 text-xs" onClick={() => controller.dismissHint(card.hint.id)}>
                {LIVE_COPY.hint.gotIt}
              </Button>
            </div>
          </div>
        ) : (
          <LiveErrorCard key={card.error.id} error={card.error} left={card.left} top={card.top} width={card.width} />
        ),
      )}
    </div>
  );
}

function LiveErrorCard({ error, left, top, width }: { error: LiveError } & CardPlacement) {
  const view = liveErrorView(error, useLiveErrorClock(error));
  return (
    <div
      className="live-hint-card live-hint-card--error pointer-events-auto absolute rounded-xl border border-red-200 bg-white p-3 text-sm text-gray-800 shadow-md"
      style={{ left, top, width }}
      role="alert"
      data-testid="live-error-card"
    >
      <div className="mb-1 flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wide text-red-700">
        <span className="live-hint-card__dot" aria-hidden />
        {errorCardTitle(error)}
      </div>
      <p className="leading-snug text-gray-600">{view.title}</p>
      <div className="mt-2 flex items-center justify-end gap-2">
        {view.primary === "retry" && (
          <Button variant="ghost" size="sm" className="h-7 px-2 text-xs" onClick={retryLiveError} disabled={!view.retryEnabled}>
            {LIVE_COPY.errors.retry}
            {view.secondsLeft ? ` (${view.secondsLeft})` : ""}
          </Button>
        )}
        <Button variant="secondary" size="sm" className="h-7 px-2.5 text-xs" onClick={() => clearLiveError()}>
          {LIVE_COPY.errors.dismiss}
        </Button>
      </div>
    </div>
  );
}
