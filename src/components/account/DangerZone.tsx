"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ExternalLink, Loader2, Trash2 } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SectionError } from "@/components/account/SectionError";
import { SECTION_BODY, SectionHeader } from "@/components/account/SectionHeader";
import { describeError } from "@/lib/errorMessage";
import { ACCOUNT_COPY, DELETE_CONFIRM_WORD, deleteConfirmed } from "@/lib/billing/accountState";
import { deleteOwnAccount, isPlanStillActiveError } from "@/lib/billing/deleteAccount";
import { billingPortalUrl, mustCancelBeforeDeleting } from "@/lib/billing/unlimited";
import { PLAN_COPY } from "@/lib/billing/unlimitedPlan";
import { useUnlimited } from "@/lib/billing/useUnlimited";

/**
 * Delete account: a dialog that arms only once the user types DELETE, then
 * removes the user's own board-assets objects from Storage and calls the
 * SECURITY DEFINER RPC `delete_own_account()` (the user can only delete
 * themselves), forgets the session locally (no server call — the user is gone)
 * and goes to /login.
 *
 * While an Agathon Unlimited plan would charge again (src/lib/billing/unlimited.ts
 * mustCancelBeforeDeleting), the dialog asks for the plan to be cancelled in the
 * customer portal instead: the app has no Stripe key, so deleting the account
 * could never stop the charges. deleteOwnAccount checks the plan again before
 * touching anything (another tab may have started one), and that refusal lands here too.
 */
export function DangerZone({ email }: { email: string }) {
  const router = useRouter();
  const plan = useUnlimited();
  const [open, setOpen] = useState(false);
  const [typed, setTyped] = useState("");
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // the server said the plan is still on (fresher than the summary this page read)
  const [planRefused, setPlanRefused] = useState(false);
  const armed = deleteConfirmed(typed);
  const mustCancel = mustCancelBeforeDeleting(plan.state) || planRefused;
  const portal = billingPortalUrl(email);

  function close() {
    if (deleting) return;
    setOpen(false);
    setTyped("");
    setError(null);
    setPlanRefused(false);
  }

  async function deleteAccount() {
    if (deleting || !armed) return;
    setDeleting(true);
    setError(null);
    try {
      // Own Storage objects go first (the DB cascade cannot remove files), then the
      // RPC, then the local session is dropped without a /logout round-trip.
      const { assets } = await deleteOwnAccount(supabase);
      if (assets.error) console.warn("Some saved images could not be removed:", assets);
      // Full page load, not router.replace: the account is gone, so a fresh provider (and a
      // fresh React tree) is the only state we can trust. Falls back to the router when
      // `window` is unavailable.
      if (typeof window !== "undefined") window.location.replace("/login");
      else router.replace("/login");
    } catch (err) {
      setDeleting(false);
      if (isPlanStillActiveError(err)) {
        // nothing was removed: the plan was checked first
        setPlanRefused(true);
        plan.refresh();
        return;
      }
      console.warn("Account deletion failed:", err);
      setError(describeError(err, ACCOUNT_COPY.deleteFallback));
    }
  }

  return (
    <Card className="border-red-200">
      <SectionHeader
        title="Danger zone"
        titleClassName="text-red-700"
        description="Deleting your account removes your boards, saved images and usage history for good."
      />
      <CardContent className={SECTION_BODY}>
        <Button variant="destructive" size="sm" onClick={() => setOpen(true)}>
          <Trash2 className="w-4 h-4" />
          Delete account
        </Button>
      </CardContent>

      <Dialog open={open} onOpenChange={(next) => !next && close()}>
        {mustCancel ? (
          <DialogContent data-testid="delete-needs-cancel">
            <DialogHeader>
              <DialogTitle>{PLAN_COPY.deleteBlockedTitle}</DialogTitle>
              <DialogDescription>{PLAN_COPY.deleteBlockedBody}</DialogDescription>
            </DialogHeader>
            {portal ? (
              <p className="text-xs text-muted-foreground">{PLAN_COPY.portalHint}</p>
            ) : (
              <p className="text-sm text-muted-foreground">{PLAN_COPY.noPortal}</p>
            )}
            <DialogFooter>
              <Button variant="outline" onClick={close}>
                Close
              </Button>
              {portal && (
                <Button asChild>
                  <a href={portal} target="_blank" rel="noopener noreferrer">
                    {PLAN_COPY.manage}
                    <ExternalLink className="w-4 h-4" />
                  </a>
                </Button>
              )}
            </DialogFooter>
          </DialogContent>
        ) : (
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Delete your account?</DialogTitle>
              <DialogDescription>
                This permanently deletes {email} and every board on it. This can&apos;t be undone. Type{" "}
                <span className="font-mono font-semibold">{DELETE_CONFIRM_WORD}</span> to confirm.
              </DialogDescription>
            </DialogHeader>
            <div className="py-2">
              <Label htmlFor="delete-confirm" className="mb-2 block">
                Confirmation
              </Label>
              <Input
                id="delete-confirm"
                value={typed}
                onChange={(e) => setTyped(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && armed && void deleteAccount()}
                placeholder={DELETE_CONFIRM_WORD}
                autoComplete="off"
                autoFocus
                disabled={deleting}
                aria-invalid={error ? true : undefined}
              />
              {error && (
                <SectionError
                  className="mt-3"
                  title={ACCOUNT_COPY.deleteFailedTitle}
                  message={error}
                  onRetry={() => void deleteAccount()}
                  retrying={deleting}
                />
              )}
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={close} disabled={deleting}>
                Cancel
              </Button>
              <Button variant="destructive" onClick={() => void deleteAccount()} disabled={!armed || deleting}>
                {deleting && <Loader2 className="w-4 h-4 animate-spin" />}
                {error ? "Retry delete" : "Delete my account"}
              </Button>
            </DialogFooter>
          </DialogContent>
        )}
      </Dialog>
    </Card>
  );
}
