"use client";

import { useEffect, useState } from "react";
import { atom, react, useValue, type Editor } from "tldraw";
import { liveStore } from "@/lib/live/liveStore";
import { highlightBox, highlightVisible, highlightWakeIn } from "./problemHighlightView";

/** A check or a solve stream is open: what an ask waits for. */
function liveBusy(): boolean {
  return liveStore.solving.get() > 0 || liveStore.status.get() === "checking";
}

/**
 * "Which problem will Help do?" — a soft outline around the problem Help me / Solve it act on
 * (`liveStore.helpTarget`, published by the loop), when the screen holds more than one: while the
 * button is hovered or focused, while an ask is answered, and for a moment when the target moves
 * (`problemHighlightView.ts` decides when). A DOM overlay like the hint cards — page box to screen
 * through the camera, recomputed when it moves — never a shape: nothing to sync or save, nothing
 * the student can select or rub out. The page mounts it only with the ask button there (Live on,
 * a help mode on) and AI shapes not hidden.
 */
export function ProblemHighlight({ editor }: { editor: Editor }) {
  // the view's clock, and when Live last got busy: atoms set from timers and reactions, not in render
  const [clock] = useState(() => atom("live.highlightClock", 0));
  const [busySince] = useState(() => atom("live.highlightBusySince", 0));
  useEffect(() => {
    let was = false;
    return react("live.highlightBusy", () => {
      const busy = liveBusy();
      if (busy && !was) busySince.set(Date.now());
      was = busy;
    });
  }, [busySince]);

  const view = useValue(
    "live.problemHighlight",
    () => {
      const target = liveStore.helpTarget.get();
      if (!target || target.problems < 2) return null;
      clock.get();
      const input = { target, hovered: liveStore.askHover.get(), askedAt: liveStore.askedAt.get(), busy: liveBusy(), busySince: busySince.get(), now: Date.now() };
      // read the camera so the box follows pan and zoom
      editor.getCamera();
      const box = highlightBox(target.bounds, (p) => editor.pageToScreen(p), editor.getViewportScreenBounds());
      return { box, visible: highlightVisible(input), wake: highlightWakeIn(input) };
    },
    [editor, clock, busySince],
  );

  // the outline fades out when its moment is over: wake the view then
  const wake = view?.wake ?? null;
  useEffect(() => {
    if (wake === null) return;
    const timer = setTimeout(() => clock.set(Date.now()), wake + 16);
    return () => clearTimeout(timer);
  }, [wake, clock]);

  if (!view) return null;
  return (
    <div className="pointer-events-none absolute inset-0 z-[250] overflow-hidden" aria-hidden>
      <div
        className={`absolute rounded-2xl border-2 border-blue-600/35 bg-blue-600/[0.04] transition-opacity duration-300 motion-reduce:transition-none ${view.visible ? "opacity-100" : "opacity-0"}`}
        style={view.box}
        data-testid="problem-highlight"
      />
    </div>
  );
}
