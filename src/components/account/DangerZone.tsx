"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Trash2 } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
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
import { describeError } from "@/lib/errorMessage";
import { ACCOUNT_COPY, DELETE_CONFIRM_WORD, deleteConfirmed } from "@/lib/billing/accountState";
import { deleteOwnAccount } from "@/lib/billing/deleteAccount";

/**
 * Delete account: a dialog that arms only once the user types DELETE, then
 * removes the user's own board-assets objects from Storage and calls the
 * SECURITY DEFINER RPC `delete_own_account()` (the user can only delete
 * themselves), forgets the session locally (no server call — the user is gone)
 * and goes to /login.
 */
export function DangerZone({ email }: { email: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [typed, setTyped] = useState("");
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const armed = deleteConfirmed(typed);

  function close() {
    if (deleting) return;
    setOpen(false);
    setTyped("");
    setError(null);
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
      console.warn("Account deletion failed:", err);
      setError(describeError(err, ACCOUNT_COPY.deleteFallback));
      setDeleting(false);
    }
  }

  return (
    <Card className="border-red-200">
      <CardHeader>
        <CardTitle className="text-red-700">Danger zone</CardTitle>
        <CardDescription>
          Deleting your account removes your boards, saved images and usage history for good.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Button variant="destructive" size="sm" onClick={() => setOpen(true)}>
          <Trash2 className="w-4 h-4" />
          Delete account
        </Button>
      </CardContent>

      <Dialog open={open} onOpenChange={(next) => !next && close()}>
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
      </Dialog>
    </Card>
  );
}
