"use client";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { OutOfInkPanel } from "@/components/billing/OutOfInkPanel";
import { OUT_OF_INK_COPY } from "@/lib/billing/outOfInk";

/**
 * The board's ink dialog: out of ink (a 402, opened by OutOfInkWatcher once the pen has rested) or
 * just getting more (the meter's or the status pill's "Get ink"). Loaded lazily so it costs the
 * board nothing until it is needed.
 */
export function OutOfInkDialog({
  open,
  outOfInk,
  onOpenChange,
}: {
  open: boolean;
  outOfInk: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md" data-testid="out-of-ink-dialog">
        {/* the panel's heading and first sentence are the dialog's accessible title and description */}
        <OutOfInkPanel
          variant="dialog"
          outOfInk={outOfInk}
          titleAs={DialogTitle}
          bodyAs={DialogDescription}
          onDone={() => onOpenChange(false)}
          footer={
            <Button variant="ghost" size="sm" onClick={() => onOpenChange(false)}>
              {OUT_OF_INK_COPY.notNow}
            </Button>
          }
        />
      </DialogContent>
    </Dialog>
  );
}
