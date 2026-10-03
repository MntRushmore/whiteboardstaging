"use client";

import { Lightbulb, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { LIVE_COPY } from "./copy";

/** The tour's coach mark points here (`BoardTour`). */
export const ASK_BUTTON_ATTR = "data-ask-button";

/**
 * The board's big ask button, beside the dial (`BoardToolbarView.askButton`): "Help me" writes
 * the next step, "Solve it" the rest. The one coloured button in the bar, because it is the one
 * thing a stuck student needs to find. `glow` changes whenever the dial moves: the button is
 * remounted and glows for a moment, so a student who turned the dial because they were stuck
 * sees what to tap next. Tapped with nothing on the screen to help with, it says so.
 */
export function AskButton({ kind, glow, onAsk }: { kind: "help" | "solve"; glow: number; onAsk: () => boolean }) {
  const solve = kind === "solve";
  const label = solve ? LIVE_COPY.ask.solve : LIVE_COPY.ask.help;
  return (
    <Button
      key={glow}
      size="sm"
      className={`h-8 rounded-full bg-blue-600 px-3.5 font-semibold text-white shadow-sm hover:bg-blue-700${glow > 0 ? " ask-glow" : ""}`}
      title={solve ? LIVE_COPY.ask.solveHint : LIVE_COPY.ask.helpHint}
      {...{ [ASK_BUTTON_ATTR]: kind }}
      onClick={() => {
        if (!onAsk()) toast(LIVE_COPY.ask.nothingYet);
      }}
    >
      {solve ? <Sparkles className="h-4 w-4" aria-hidden /> : <Lightbulb className="h-4 w-4" aria-hidden />}
      <span>{label}</span>
    </Button>
  );
}
