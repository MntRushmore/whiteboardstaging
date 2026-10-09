"use client";

import { useEffect, useRef } from "react";
import { Lightbulb, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { liveStore } from "@/lib/live/liveStore";
import { LIVE_COPY } from "./copy";

/** The tour's coach mark points here (`BoardTour`). */
export const ASK_BUTTON_ATTR = "data-ask-button";

/**
 * The board's big ask button, beside the dial (`BoardToolbarView.askButton`): "Help me" writes
 * the next step, "Solve it" the rest. The one coloured button in the bar, because it is the one
 * thing a stuck student needs to find. `glow` changes whenever the dial moves: the button is
 * remounted and glows for a moment, so a student who turned the dial because they were stuck
 * sees what to tap next. Tapped with nothing on the screen to help with, it says so.
 *
 * Hovered with a mouse or focused from the keyboard, it outlines the problem it would act on
 * (`liveStore.askHover`, `ProblemHighlight`). A touch has no hover: a tap is the ask itself.
 *
 * `big`: the simple board's (src/components/kidmode), a 56 px target for a young kid's finger.
 */
export function AskButton({ kind, glow, onAsk, big = false }: { kind: "help" | "solve"; glow: number; onAsk: () => boolean; big?: boolean }) {
  const solve = kind === "solve";
  const label = solve ? LIVE_COPY.ask.solve : LIVE_COPY.ask.help;
  const near = useRef({ hover: false, focus: false });
  const point = (patch: Partial<{ hover: boolean; focus: boolean }>) => {
    near.current = { ...near.current, ...patch };
    liveStore.askHover.set(near.current.hover || near.current.focus);
  };
  // gone while hovered (the dial moved to Off): no leave event will come
  useEffect(() => () => void liveStore.askHover.set(false), []);
  return (
    <Button
      key={glow}
      size="sm"
      className={`${big ? "h-14 gap-2.5 px-6 text-lg font-bold [&_svg]:size-6!" : "h-8 px-3.5 font-semibold"} rounded-full bg-blue-600 text-white shadow-sm hover:bg-blue-700${glow > 0 ? " ask-glow" : ""}`}
      title={`${solve ? LIVE_COPY.ask.solveHint : LIVE_COPY.ask.helpHint}. ${LIVE_COPY.ask.pickHint}`}
      {...{ [ASK_BUTTON_ATTR]: kind }}
      onPointerEnter={(e) => e.pointerType === "mouse" && point({ hover: true })}
      onPointerLeave={() => point({ hover: false })}
      onFocus={(e) => point({ focus: e.currentTarget.matches(":focus-visible") })}
      onBlur={() => point({ focus: false })}
      onClick={() => {
        if (!onAsk()) toast(LIVE_COPY.ask.nothingYet);
      }}
    >
      {solve ? <Sparkles className="h-4 w-4" aria-hidden /> : <Lightbulb className="h-4 w-4" aria-hidden />}
      <span>{label}</span>
    </Button>
  );
}
