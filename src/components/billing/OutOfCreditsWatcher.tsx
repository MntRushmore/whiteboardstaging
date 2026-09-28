"use client";

import { Suspense, lazy, useEffect, useRef, useState } from "react";
import { useValue, type Editor, type TLEventInfo } from "tldraw";
import { liveStore } from "@/lib/live/liveStore";
import { creditsDialogWanted, penIsResting } from "@/lib/billing/creditsDialog";

const loadDialog = () => import("@/components/billing/OutOfCreditsDialog").then((m) => ({ default: m.OutOfCreditsDialog }));
/** Not in the board's first load: fetched when the first credits error arrives. */
const OutOfCreditsDialog = lazy(loadDialog);

/** How often a waiting dialog looks again whether the pen has rested. */
const CHECK_MS = 250;

/**
 * Turns a Live `402 credits_exhausted` (a LiveError with code 'credits') into the board's
 * out-of-credits dialog, once per visit to the board. It waits until the student is not writing
 * (no pointer down and the pen still for a moment, penIsResting) so it never lands mid-stroke;
 * after "Not now" the status pill keeps the short version with its link to the account page.
 */
export function OutOfCreditsWatcher({ editor }: { editor: Editor }) {
  const creditsError = useValue("live credits error", () => {
    const err = liveStore.lastError.get();
    return err?.code === "credits" ? err : null;
  }, []);
  const [phase, setPhase] = useState<"idle" | "open" | "done">("idle");
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

  const wanted = creditsDialogWanted(creditsError, phase !== "idle");

  useEffect(() => {
    if (!wanted) return;
    void loadDialog(); // fetch the chunk while the pen is still moving
    const id = setInterval(() => {
      const pointerDown = editor.inputs.isPointing || editor.inputs.isDragging || editor.inputs.buttons.size > 0;
      if (penIsResting({ pointerDown, lastPenAt: lastPenAt.current, now: Date.now() })) setPhase("open");
    }, CHECK_MS);
    return () => clearInterval(id);
  }, [wanted, editor]);

  if (phase !== "open") return null;
  return (
    <Suspense fallback={null}>
      <OutOfCreditsDialog open onOpenChange={(open) => !open && setPhase("done")} />
    </Suspense>
  );
}
