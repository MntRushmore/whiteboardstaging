"use client";

import { Suspense, lazy, useEffect, useRef, useState } from "react";
import { useValue, type Editor, type TLEventInfo } from "tldraw";
import { liveStore } from "@/lib/live/liveStore";
import { OPEN_INK_DIALOG_EVENT, inkDialogWanted, penIsResting } from "@/lib/billing/inkDialog";
import { isUnlimited } from "@/lib/billing/unlimited";
import { useUnlimited } from "@/lib/billing/useUnlimited";

const loadDialog = () => import("@/components/billing/OutOfInkDialog").then((m) => ({ default: m.OutOfInkDialog }));
/** Not in the board's first load: fetched when the first ink error arrives or "Get ink" is tapped. */
const OutOfInkDialog = lazy(loadDialog);

/** How often a waiting dialog looks again whether the pen has rested. */
const CHECK_MS = 250;

type Phase = { kind: "idle" } | { kind: "open"; outOfInk: boolean } | { kind: "done" };

/**
 * The board's ink dialog, two ways in:
 *  - a Live `402 ink_empty` (a LiveError with code 'ink'): once per visit to the board, and only
 *    once the student is not writing (no pointer down and the pen still for a moment,
 *    penIsResting), so it never lands mid-stroke;
 *  - "Get ink" on the meter or the status pill (openInkDialog): at once, as often as asked.
 * After "Not now" the status pill keeps the short version, with its own "Get ink".
 *
 * Never for an Agathon Unlimited subscriber: their help spends no ink, so there is nothing to
 * buy and no reason to cover the board. A 402 can still reach a subscriber in the moments around
 * the plan starting or lapsing; the meter (unlimited) clears it once the plan is read.
 */
export function OutOfInkWatcher({ editor }: { editor: Editor }) {
  const inkError = useValue("live ink error", () => {
    const err = liveStore.lastError.get();
    return err?.code === "ink" ? err : null;
  }, []);
  const unlimited = isUnlimited(useUnlimited().state);
  const [phase, setPhase] = useState<Phase>({ kind: "idle" });
  // The 402 has had its one dialog this visit (the student asking always gets one).
  const [shownFor402, setShownFor402] = useState(false);
  const lastPenAt = useRef(0);

  // Every pointer event on the board is pen activity.
  useEffect(() => {
    const onEvent = (info: TLEventInfo) => {
      if (info.type === "pointer") lastPenAt.current = Date.now();
    };
    editor.on("event", onEvent);
    return () => {
      editor.off("event", onEvent);
    };
  }, [editor]);

  // "Get ink": the student asked, so the pen is not moving.
  useEffect(() => {
    if (unlimited) return;
    const onOpen = () => setPhase({ kind: "open", outOfInk: false });
    window.addEventListener(OPEN_INK_DIALOG_EVENT, onOpen);
    return () => window.removeEventListener(OPEN_INK_DIALOG_EVENT, onOpen);
  }, [unlimited]);

  const wanted = !unlimited && inkDialogWanted(inkError, shownFor402 || phase.kind === "open");

  useEffect(() => {
    if (!wanted) return;
    void loadDialog(); // fetch the chunk while the pen is still moving
    const id = setInterval(() => {
      const pointerDown = editor.inputs.isPointing || editor.inputs.isDragging || editor.inputs.buttons.size > 0;
      if (penIsResting({ pointerDown, lastPenAt: lastPenAt.current, now: Date.now() })) {
        setShownFor402(true);
        setPhase({ kind: "open", outOfInk: true });
      }
    }, CHECK_MS);
    return () => clearInterval(id);
  }, [wanted, editor]);

  if (phase.kind !== "open" || unlimited) return null;
  return (
    <Suspense fallback={null}>
      <OutOfInkDialog open outOfInk={phase.outOfInk} onOpenChange={(open) => !open && setPhase({ kind: "done" })} />
    </Suspense>
  );
}
