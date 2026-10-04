"use client";

import { useCallback, useEffect, useLayoutEffect, useReducer, useRef, useState, type KeyboardEvent } from "react";
import { useEditor, useValue, type Editor } from "tldraw";
import { Pencil } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { learningBus } from "@/lib/learning/bus";
import type { PracticeProblem } from "@/lib/learning/contracts";
import { initialNowYouTry, NOW_YOU_TRY_COPY, nowYouTryReducer, type Offer } from "@/lib/learning/nowYouTry";
import type { LiveController } from "@/lib/live/contracts";
import { clientMetric } from "@/lib/logger";
import { BOTTOM_UI_SELECTOR } from "@/components/live/hintPlacement";

/**
 * "Now you try one!" (`src/lib/learning/nowYouTry.ts` decides when): a big friendly pill at the
 * foot of the board, above tldraw's tool palette, once the tutor has solved a problem or helped
 * the student finish one. Its button has the tutor write one problem like it — on a fresh screen
 * when this one has work, the chat's executor decides — free and instant: the problem is made on
 * the device (`variantOf`) and checked by the engine, no model and no ink. "Not now" closes it.
 *
 * Loaded with a dynamic import after the board is up (the board page mounts it), so the board's
 * first load gains only the import itself (docs/BUNDLE.md).
 */

export interface NowYouTryProps {
  controller: LiveController;
  /** the onboarding tour is on: no offers */
  tour: boolean;
}

/** The new problem, made on the device: the engine (already loaded on the board) and the generators. */
async function similarProblem(problem: PracticeProblem, seed: number): Promise<PracticeProblem | null> {
  try {
    const [{ getEngine }, { variantOf }] = await Promise.all([import("@/lib/live/engine"), import("@/lib/learning/practice")]);
    return variantOf(await getEngine(), problem, seed);
  } catch {
    return null;
  }
}

/**
 * How much of the board's foot tldraw's bottom row covers (the tools, the screen strip), in px:
 * measured while the offer shows, and again whenever the board or that row changes size.
 */
function useBottomInset(editor: Editor, active: boolean): number {
  const [inset, setInset] = useState(0);
  // before paint: the pill never shows at a guessed height and then jumps
  useLayoutEffect(() => {
    if (!active) return;
    const container = editor.getContainer();
    const ro = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(() => measure());
    let watched: Element | null = null;
    function measure() {
      const bottomUi = container.querySelector(BOTTOM_UI_SELECTOR);
      if (bottomUi && bottomUi !== watched && ro) {
        watched = bottomUi;
        ro.observe(bottomUi);
      }
      const box = container.getBoundingClientRect();
      setInset(bottomUi ? Math.max(0, Math.round(box.bottom - bottomUi.getBoundingClientRect().top)) : 0);
    }
    ro?.observe(container);
    measure();
    return () => ro?.disconnect();
  }, [editor, active]);
  return inset;
}

export default function NowYouTry({ controller, tour }: NowYouTryProps) {
  const editor = useEditor();
  const [state, dispatch] = useReducer(nowYouTryReducer, undefined, initialNowYouTry);
  const tourRef = useRef(tour);
  useEffect(() => {
    tourRef.current = tour;
  });

  // every attempt's latest state, as the tracker publishes it
  useEffect(() => learningBus.onAttempt((record) => dispatch({ type: "attempt", record, now: Date.now(), tour: tourRef.current })), []);

  // another screen: the offer was about the one left
  const pageId = useValue("now you try: screen", () => editor.getCurrentPageId(), [editor]);
  const lastPage = useRef(pageId);
  useEffect(() => {
    if (pageId === lastPage.current) return;
    lastPage.current = pageId;
    dispatch({ type: "screen" });
  }, [pageId]);

  // the offer shows only once its problem exists
  const pending = state.pending;
  useEffect(() => {
    if (!pending) return;
    let live = true;
    void similarProblem(pending.problem, pending.seed).then((problem) => {
      if (live) dispatch({ type: "variant", attemptId: pending.attemptId, problem });
    });
    return () => {
      live = false;
    };
  }, [pending]);

  const offer = state.offer;
  const shownFor = useRef<string | null>(null);
  useEffect(() => {
    if (!offer || shownFor.current === offer.attemptId) return;
    shownFor.current = offer.attemptId;
    clientMetric("learning.now_you_try.offer", { lines: offer.problem.length });
  }, [offer]);

  const take = useCallback(
    async (o: Offer) => {
      dispatch({ type: "take" });
      clientMetric("learning.now_you_try.take", {});
      try {
        if (!controller.runChatActions) throw new Error("The board is not ready yet.");
        const report = await controller.runChatActions([{ type: "write_problems", problems: [[...o.problem]] }], { origin: "now_you_try", parentId: o.attemptId });
        if (report.problemsWritten === 0) toast(NOW_YOU_TRY_COPY.failed);
      } catch (e) {
        clientMetric("learning.now_you_try.failed", { error: e instanceof Error ? e.message : String(e) });
        toast(NOW_YOU_TRY_COPY.failed);
      }
    },
    [controller],
  );

  const dismiss = useCallback(() => {
    dispatch({ type: "dismiss" });
    clientMetric("learning.now_you_try.dismiss", {});
  }, []);

  const bottom = useBottomInset(editor, offer !== null);

  return (
    <>
      {/* read out once when it appears (a region mounted with its words is often not announced) */}
      <p role="status" aria-live="polite" className="sr-only">
        {offer ? NOW_YOU_TRY_COPY.announce : ""}
      </p>
      {offer && <NowYouTryOffer offer={offer} bottom={bottom} onTake={(o) => void take(o)} onDismiss={dismiss} />}
    </>
  );
}

/** The pill itself: the big button and a small Not now. Exported for its markup test. */
export function NowYouTryOffer({ offer, bottom, onTake, onDismiss }: { offer: Offer; bottom: number; onTake: (offer: Offer) => void; onDismiss: () => void }) {
  // Esc from inside the pill closes it (on the canvas Esc stays the drawing tools')
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== "Escape") return;
    e.preventDefault();
    e.stopPropagation();
    onDismiss();
  };
  return (
    <div
      data-now-you-try=""
      className="pointer-events-none absolute inset-x-0 z-1000 flex justify-center px-4"
      // 14 px above tldraw's bottom row, and above an iPhone's home bar when nothing is under it
      style={{ bottom: bottom > 0 ? bottom + 14 : "calc(env(safe-area-inset-bottom, 0px) + 72px)" }}
    >
      <div
        role="group"
        aria-label={NOW_YOU_TRY_COPY.region}
        onKeyDown={onKeyDown}
        className="pointer-events-auto flex max-w-full items-center gap-1.5 rounded-full border border-blue-100 bg-white p-1.5 shadow-[0_12px_32px_rgba(15,23,42,0.16),0_2px_6px_rgba(15,23,42,0.08)] animate-in fade-in-0 slide-in-from-bottom-3 zoom-in-95 duration-300 ease-out motion-reduce:animate-none"
      >
        <Button
          type="button"
          aria-label={NOW_YOU_TRY_COPY.goLabel}
          onClick={() => onTake(offer)}
          className="h-14 min-w-0 gap-2.5 rounded-full bg-blue-600 px-6 text-lg font-bold text-white shadow-sm hover:bg-blue-700 focus-visible:ring-blue-500/40 [&_svg:not([class*='size-'])]:size-6"
        >
          <Pencil aria-hidden />
          {NOW_YOU_TRY_COPY.go}
        </Button>
        <button
          type="button"
          aria-label={NOW_YOU_TRY_COPY.notNowLabel}
          onClick={onDismiss}
          className="h-12 shrink-0 cursor-pointer rounded-full px-4 text-base font-medium text-slate-600 outline-none transition-colors hover:bg-slate-100 hover:text-slate-900 focus-visible:ring-[3px] focus-visible:ring-ring/50 motion-reduce:transition-none"
        >
          {NOW_YOU_TRY_COPY.notNow}
        </button>
      </div>
    </div>
  );
}
