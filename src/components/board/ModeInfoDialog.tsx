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
 * help, not chrome. Copy tracks what the tabs and the Auto switch actually do today, Live included.
 */
export function ModeInfoDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl">
        <DialogHeader>
          <DialogTitle>Help modes</DialogTitle>
          <DialogDescription>
            The tabs at the top of your board set how much the tutor helps, and the Auto switch
            beside them sets when. New boards start in Feedback, and your choice is remembered for
            this board on this device. Off stops every check, hint and solution.
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
              A tick beside each right step, and a circle round one to look at again. No answers.
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
              The next step, written beside a circled line, or when you seem stuck.
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
              The rest of the problem, worked out under your last line.
            </p>
          </div>

        </div>
        {/* Live and Auto are not modes: they run under all three, so they read as notes. */}
        <div className="flex flex-col gap-3 rounded-md border bg-muted/40 p-3">
          <div className="flex items-start gap-3">
            <span aria-hidden className="flex w-7 shrink-0 justify-center font-serif text-3xl leading-none text-gray-400">
              &Sigma;
            </span>
            <div>
              <p className="text-sm font-medium mb-1">{LIVE_COPY.modeInfo.title}</p>
              <p className="text-sm text-muted-foreground">{LIVE_COPY.modeInfo.body}</p>
            </div>
          </div>
          <div className="flex items-start gap-3">
            {/* the bar's switch in miniature, on */}
            <span aria-hidden className="mt-1 flex w-7 shrink-0 justify-center">
              <span className="inline-flex h-4 w-7 items-center rounded-full bg-primary p-0.5">
                <span className="ml-auto block size-3 rounded-full bg-background" />
              </span>
            </span>
            <div>
              <p className="text-sm font-medium mb-1">{LIVE_COPY.modeInfo.autoTitle}</p>
              <p className="text-sm text-muted-foreground">{LIVE_COPY.modeInfo.autoBody}</p>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
