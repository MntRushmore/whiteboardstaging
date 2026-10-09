"use client";

import { useEffect, useState } from "react";
import { Loader2, RefreshCw } from "lucide-react";
import { useAuth } from "@/components/AuthProvider";
import type { FamilyMember, FamilyState } from "@/lib/family/contracts";
import { FAMILY_COPY } from "@/lib/family/copy";
import { currentMember, hasOthers } from "@/lib/family/members";
import { onOpenProfilePicker } from "@/lib/family/picker";
import { Button } from "@/registry/components/button/button";
import { Dialog, DialogContent } from "@/registry/components/dialog/dialog";
import { FamilyAvatar } from "./FamilyAvatar";
import { useFamily } from "./useFamily";
import { WhoIsPractising } from "./WhoIsPractising";
import styles from "./family.module.css";

/**
 * Who's practising: the family's profiles (src/lib/family/contracts.ts) in the app bar, to switch
 * between the grown-up and the kids. Loaded with a dynamic import; renders nothing for an account
 * with no kids (and while the family is unknown), until someone asks for the picker.
 *
 * For a family it shows the current profile's picture; tapping it opens "Who's practising?" with a
 * big tile for every member (WhoIsPractising). A kid's header menu has "Switch profile" (and so do
 * the Family page's kid view and the kid's plan screen), which opens the same picker through a window
 * event (src/lib/family/picker.ts). Asked before the family is read, or after the read failed, the
 * picker opens at once and says so: "Getting everyone's pictures…" while GET /api/family is under way
 * (a failed read is tried again on every ask), then the tiles, or what went wrong and Try again. A
 * picker that was not asked for never opens: closing it is the end of that ask.
 *
 * SLOT (contract 2026-10-09): filled by the family part (feat/kcb-family). Nothing imported here may
 * reach tldraw: the app bar renders on prerendered pages.
 */
export default function ProfileSwitcher() {
  const { user } = useAuth();
  const { state, loading, failed, reload } = useFamily(user?.id);
  const [open, setOpen] = useState(false);
  const [pinFor, setPinFor] = useState<FamilyMember | null>(null);

  // A failed read is tried again when the picker is asked for, so the ask is never silent.
  useEffect(
    () =>
      onOpenProfilePicker(() => {
        setOpen(true);
        if (failed) reload();
      }),
    [failed, reload],
  );

  const me = state ? currentMember(state) : null;
  const ready = state !== null && hasOthers(state) && me !== null;
  if (!ready && !open) return null;

  function change(next: boolean) {
    setOpen(next);
    if (!next) setPinFor(null);
  }

  return (
    <>
      {ready && (
        <button type="button" className={styles.trigger} onClick={() => setOpen(true)} aria-label={FAMILY_COPY.switcherLabel(me.displayName)} title={FAMILY_COPY.switchProfile} data-testid="profile-switcher">
          <FamilyAvatar name={me.displayName} avatar={me.avatar} size="sm" />
        </button>
      )}
      <Dialog open={open} onOpenChange={change}>
        <DialogContent title={pinFor ? FAMILY_COPY.pinTitle(pinFor.displayName) : FAMILY_COPY.pickerTitle} className={styles.dialog}>
          {/* remounted on every open, so it starts at the tiles */}
          {open && <PickerBody state={ready ? state : null} loading={loading} failed={failed} onRetry={reload} onPinView={setPinFor} />}
        </DialogContent>
      </Dialog>
    </>
  );
}

/**
 * The picker's body: the tiles once the family is read; until then, that it is coming, or that it
 * could not be read with Try again. A family with no one else to switch to says so.
 */
export function PickerBody({
  state,
  loading,
  failed,
  onRetry,
  onPinView,
}: {
  /** the family, only when there is someone to switch to */
  state: FamilyState | null;
  loading: boolean;
  failed: boolean;
  onRetry: () => void;
  onPinView: (member: FamilyMember | null) => void;
}) {
  if (state) return <WhoIsPractising state={state} onPinView={onPinView} />;
  if (loading) {
    return (
      <p className={styles.pickerStatus} role="status" data-testid="picker-loading">
        <Loader2 className={styles.pickerSpinner} size={20} aria-hidden />
        {FAMILY_COPY.pickerLoading}
      </p>
    );
  }
  if (failed) {
    return (
      <div className={styles.pickerStatus} role="alert" data-testid="picker-failed">
        <p className={styles.pickerStatusText}>{FAMILY_COPY.pickerFailed}</p>
        <Button variant="secondary" onClick={onRetry}>
          <RefreshCw size={16} aria-hidden />
          {FAMILY_COPY.pickerRetry}
        </Button>
      </div>
    );
  }
  return (
    <p className={styles.pickerStatus} data-testid="picker-empty">
      {FAMILY_COPY.kidsEmpty}
    </p>
  );
}
