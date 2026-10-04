"use client";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { LIVE_COPY } from "@/components/live/copy";

/**
 * The (i) explainer, opened from Board options rather than from a button in the bar: it is
 * help, not chrome. Copy tracks what the tabs actually do today, Live included.
 */
export function ModeInfoDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl">
        <DialogHeader>
          <DialogTitle>Help modes</DialogTitle>
          <DialogDescription>
            The tabs at the top of your board set how much the tutor helps. New boards start
            in Feedback, and your choice is remembered for this board on this device. Off
            stops every check, hint and solution.
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-wrap gap-6">
          <div className="flex-1 min-w-[200px] flex flex-col items-start">
            <img
              src="/modes/feedback.png"
              alt="Feedback mode example"
              className="h-48 w-auto rounded-md border bg-muted object-contain mb-3"
            />
            <p className="text-sm font-medium mb-1">Feedback</p>
            <p className="text-sm text-muted-foreground">
              Light annotations pointing out mistakes without giving away answers.
            </p>
          </div>

          <div className="flex-1 min-w-[200px] flex flex-col items-start">
            <img
              src="/modes/suggest.png"
              alt="Suggest mode example"
              className="h-48 w-auto rounded-md border bg-muted object-contain mb-3"
            />
            <p className="text-sm font-medium mb-1">Suggest</p>
            <p className="text-sm text-muted-foreground">
              Hints and partial steps to nudge you in the right direction.
            </p>
          </div>

          <div className="flex-1 min-w-[200px] flex flex-col items-start">
            <img
              src="/modes/solve.png"
              alt="Solve mode example"
              className="h-48 w-auto rounded-md border bg-muted object-contain mb-3"
            />
            <p className="text-sm font-medium mb-1">Solve</p>
            <p className="text-sm text-muted-foreground">
              Worked steps written under your last line, in the tutor&apos;s hand or typeset.
            </p>
          </div>

        </div>
        {/* Live is not a fourth mode: it runs underneath all three, so it reads as a note. */}
        <div className="flex items-start gap-3 rounded-md border bg-muted/40 p-3">
          <span aria-hidden className="font-serif text-3xl leading-none text-gray-400">
            &Sigma;
          </span>
          <div>
            <p className="text-sm font-medium mb-1">{LIVE_COPY.modeInfo.title}</p>
            <p className="text-sm text-muted-foreground">{LIVE_COPY.modeInfo.body}</p>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
