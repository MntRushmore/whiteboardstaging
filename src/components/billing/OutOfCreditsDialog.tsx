"use client";

import { OctagonAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { OutOfCreditsPanel } from "@/components/billing/OutOfCreditsPanel";
import { OUT_OF_CREDITS_COPY } from "@/lib/billing/outOfCredits";

/**
 * The board's "you've used this month's credits" dialog. Opened by OutOfCreditsWatcher (only
 * once the pen has rested), loaded lazily so it costs the board nothing until a 402 arrives.
 */
export function OutOfCreditsDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md" data-testid="out-of-credits-dialog">
        <div className="flex size-10 items-center justify-center rounded-full bg-red-50 text-red-600" aria-hidden>
          <OctagonAlert className="size-5" />
        </div>
        {/* Radix wants a Title and a Description inside Content; the panel shows the words. */}
        <DialogDescription className="sr-only">{OUT_OF_CREDITS_COPY.upgradeLead}</DialogDescription>
        <OutOfCreditsPanel
          variant="dialog"
          titleAs={DialogTitle}
          footer={
            <Button variant="ghost" size="sm" onClick={() => onOpenChange(false)}>
              {OUT_OF_CREDITS_COPY.notNow}
            </Button>
          }
        />
      </DialogContent>
    </Dialog>
  );
}
