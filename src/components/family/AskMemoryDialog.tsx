"use client";

import { useState } from "react";
import { RefreshCw } from "lucide-react";
import { ASK_MEMORY_COPY, memoryUpdatedLabel } from "@/lib/askMemory/copy";
import { useAskMemory } from "@/lib/askMemory/useAskMemory";
import type { FamilyMember } from "@/lib/family/contracts";
import { reportUserError } from "@/lib/reportAppError";
import { Button } from "@/registry/components/button/button";
import { Dialog, DialogContent } from "@/registry/components/dialog/dialog";
import { Skeleton } from "@/registry/components/skeleton/skeleton";
import styles from "./familyPage.module.css";

/**
 * "What Ask remembers about <kid>" on the Family page: the notes the tutor keeps about how that kid
 * learns, read for the grown-up (GET /api/live/ask/memory?kidId=, which checks the kid is theirs),
 * and Clear behind a second, deliberate tap (DELETE). The grown-up stays on their own profile.
 */
export function AskMemoryDialog({ kid, onOpenChange, onCleared }: { kid: FamilyMember | null; onOpenChange: (open: boolean) => void; onCleared: (name: string) => void }) {
  const name = kid?.displayName ?? "";
  const open = kid !== null;
  const { memory, loading, error, clearing, reload, clear, clearError } = useAskMemory(kid?.userId ?? null, open);
  const [confirming, setConfirming] = useState(false);
  const notes = memory?.notes ?? [];
  const updated = memoryUpdatedLabel(memory?.updatedAt ?? null);

  function change(next: boolean) {
    if (clearing) return;
    if (!next) setConfirming(false);
    onOpenChange(next);
  }

  async function confirmClear() {
    if (await clear()) {
      setConfirming(false);
      onCleared(name);
    } else {
      reportUserError({ kind: "live.account", code: "ask_memory_clear_failed", message: ASK_MEMORY_COPY.clearFailed });
    }
  }

  return (
    <Dialog open={open} onOpenChange={change}>
      <DialogContent
        title={confirming ? ASK_MEMORY_COPY.confirmTitle : ASK_MEMORY_COPY.kidTitle(name)}
        description={confirming ? ASK_MEMORY_COPY.kidConfirmBody(name) : ASK_MEMORY_COPY.kidHint(name)}
        data-testid="kid-ask-memory-dialog"
      >
        {!confirming &&
          (loading && !memory ? (
            <Skeleton lines={3} label={ASK_MEMORY_COPY.kidTitle(name)} />
          ) : error && !memory ? (
            <div role="alert">
              <p className={styles.formError}>{error}</p>
              <Button variant="secondary" size="sm" onClick={reload} className={styles.retry}>
                <RefreshCw size={14} aria-hidden />
                {ASK_MEMORY_COPY.retry}
              </Button>
            </div>
          ) : notes.length === 0 ? (
            <p className={styles.memoryEmpty}>{ASK_MEMORY_COPY.kidEmpty(name)}</p>
          ) : (
            <>
              <ul className={styles.memoryNotes} data-testid="kid-ask-memory-notes">
                {notes.map((note) => (
                  <li key={note}>{note}</li>
                ))}
              </ul>
              {updated && <p className={styles.memoryUpdated}>{updated}</p>}
            </>
          ))}
        {clearError && (
          <p className={styles.formError} role="alert">
            {clearError}
          </p>
        )}
        <div className={`${styles.formActions} ${styles.fitRow}`}>
          {confirming ? (
            <>
              <Button variant="ghost" onClick={() => setConfirming(false)} disabled={clearing}>
                {ASK_MEMORY_COPY.cancel}
              </Button>
              <Button variant="danger" onClick={() => void confirmClear()} loading={clearing} data-testid="kid-ask-memory-confirm">
                {ASK_MEMORY_COPY.confirm}
              </Button>
            </>
          ) : (
            <>
              <Button variant="ghost" onClick={() => change(false)}>
                {ASK_MEMORY_COPY.close}
              </Button>
              {notes.length > 0 && (
                <Button variant="secondary" onClick={() => setConfirming(true)} data-testid="kid-ask-memory-clear">
                  {ASK_MEMORY_COPY.clear}
                </Button>
              )}
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
