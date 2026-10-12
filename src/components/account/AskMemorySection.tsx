"use client";

import { useState } from "react";
import { Loader2, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { SectionError } from "@/components/account/SectionError";
import { SECTION_BODY, SectionHeader } from "@/components/account/SectionHeader";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ASK_MEMORY_COPY, memoryUpdatedLabel } from "@/lib/askMemory/copy";
import { useAskMemory } from "@/lib/askMemory/useAskMemory";

/**
 * "What Ask remembers" on the account page: the notes the tutor keeps about how this profile learns
 * (GET /api/live/ask/memory), and Clear, after a confirm (DELETE). For every profile, a kid's
 * included: the notes are about them, in words a kid can read. A grown-up sees each kid's on the
 * Family page.
 */
export function AskMemorySection() {
  const { memory, loading, error, clearing, reload, clear, clearError } = useAskMemory(null, true);
  const [confirming, setConfirming] = useState(false);
  const notes = memory?.notes ?? [];
  const updated = memoryUpdatedLabel(memory?.updatedAt ?? null);

  async function confirmClear() {
    if (await clear()) {
      setConfirming(false);
      toast.success(ASK_MEMORY_COPY.cleared);
    }
  }

  return (
    <Card data-testid="ask-memory-section">
      <SectionHeader title={ASK_MEMORY_COPY.title} description={ASK_MEMORY_COPY.hint} />
      <CardContent className={`${SECTION_BODY} space-y-3`}>
        {loading && !memory ? (
          <div className="space-y-2" aria-busy aria-label={ASK_MEMORY_COPY.title}>
            <div className="h-4 w-3/4 animate-pulse rounded bg-muted" />
            <div className="h-4 w-1/2 animate-pulse rounded bg-muted" />
          </div>
        ) : error && !memory ? (
          <SectionError code="ask_memory_failed" title={ASK_MEMORY_COPY.loadFailedTitle} message={error} onRetry={reload} retrying={loading} />
        ) : notes.length === 0 ? (
          <p className="text-sm text-muted-foreground">{ASK_MEMORY_COPY.empty}</p>
        ) : (
          <>
            <ul className="space-y-1.5 text-sm" data-testid="ask-memory-notes">
              {notes.map((note) => (
                <li key={note} className="flex gap-2">
                  <span aria-hidden className="mt-2 size-1.5 shrink-0 rounded-full bg-muted-foreground/60" />
                  <span className="min-w-0 break-words">{note}</span>
                </li>
              ))}
            </ul>
            {updated && <p className="text-xs text-muted-foreground">{updated}</p>}
            <Button variant="outline" size="sm" className="pointer-coarse:h-11" onClick={() => setConfirming(true)} aria-label={ASK_MEMORY_COPY.clearLabel}>
              <Trash2 className="size-4" aria-hidden />
              {ASK_MEMORY_COPY.clear}
            </Button>
          </>
        )}
      </CardContent>

      <Dialog open={confirming} onOpenChange={(next) => !clearing && setConfirming(next)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{ASK_MEMORY_COPY.confirmTitle}</DialogTitle>
            <DialogDescription>{ASK_MEMORY_COPY.confirmBody}</DialogDescription>
          </DialogHeader>
          {clearError && <SectionError code="ask_memory_clear_failed" title={ASK_MEMORY_COPY.clearFailed} message={clearError} />}
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirming(false)} disabled={clearing}>
              {ASK_MEMORY_COPY.cancel}
            </Button>
            <Button variant="destructive" onClick={() => void confirmClear()} disabled={clearing} data-testid="ask-memory-confirm">
              {clearing && <Loader2 className="size-4 animate-spin" />}
              {ASK_MEMORY_COPY.confirm}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
