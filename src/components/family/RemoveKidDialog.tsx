"use client";

import { useState } from "react";
import { describeError } from "@/lib/errorMessage";
import { removeKid } from "@/lib/family/client";
import type { FamilyMember } from "@/lib/family/contracts";
import { FAMILY_COPY } from "@/lib/family/copy";
import { reportUserError } from "@/lib/reportAppError";
import { Button } from "@/registry/components/button/button";
import { Dialog, DialogContent } from "@/registry/components/dialog/dialog";
import styles from "./familyPage.module.css";

/**
 * Remove a kid: says plainly that the kid's profile, boards and progress are deleted for good, and
 * asks for one deliberate tap on a red button. The account and everything in it go on the server
 * (DELETE /api/family/kids/<id>).
 */
export function RemoveKidDialog({ kid, onOpenChange, onRemoved }: { kid: FamilyMember | null; onOpenChange: (open: boolean) => void; onRemoved: (name: string) => void }) {
  const [removing, setRemoving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const name = kid?.displayName ?? "";

  function change(next: boolean) {
    if (removing) return;
    if (!next) setError(null);
    onOpenChange(next);
  }

  async function remove() {
    if (!kid || removing) return;
    setRemoving(true);
    setError(null);
    try {
      await removeKid(kid.userId);
      setRemoving(false);
      onOpenChange(false);
      onRemoved(name);
    } catch (err) {
      setError(describeError(err, FAMILY_COPY.removeFailed));
      reportUserError({ kind: "live.account", code: "family_remove_failed", message: FAMILY_COPY.removeFailed });
      setRemoving(false);
    }
  }

  return (
    <Dialog open={kid !== null} onOpenChange={change}>
      <DialogContent title={FAMILY_COPY.removeTitle(name)} description={FAMILY_COPY.removeBody(name)} data-testid="kid-remove-dialog">
        {error && (
          <p className={styles.formError} role="alert">
            {error}
          </p>
        )}
        <div className={`${styles.formActions} ${styles.fitRow}`}>
          <Button variant="ghost" onClick={() => change(false)} disabled={removing}>
            {FAMILY_COPY.cancel}
          </Button>
          <Button variant="danger" onClick={() => void remove()} loading={removing} title={FAMILY_COPY.removeConfirm(name)} data-testid="kid-remove-confirm">
            {/* a long name ellipsizes at the dialog's width (a 390 px phone) */}
            <span className={styles.fitLabel}>{FAMILY_COPY.removeConfirm(name)}</span>
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
