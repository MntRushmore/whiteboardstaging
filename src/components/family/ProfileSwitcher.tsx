"use client";

import { useEffect, useState } from "react";
import { useAuth } from "@/components/AuthProvider";
import type { FamilyMember } from "@/lib/family/contracts";
import { FAMILY_COPY } from "@/lib/family/copy";
import { currentMember, hasOthers } from "@/lib/family/members";
import { onOpenProfilePicker } from "@/lib/family/picker";
import { Dialog, DialogContent } from "@/registry/components/dialog/dialog";
import { FamilyAvatar } from "./FamilyAvatar";
import { useFamily } from "./useFamily";
import { WhoIsPractising } from "./WhoIsPractising";
import styles from "./family.module.css";

/**
 * Who's practising: the family's profiles (src/lib/family/contracts.ts) in the app bar, to switch
 * between the grown-up and the kids. Loaded with a dynamic import; renders nothing for an account
 * with no kids (and while the family is unknown).
 *
 * For a family it shows the current profile's picture; tapping it opens "Who's practising?" with a
 * big tile for every member (WhoIsPractising). A kid's header menu has "Switch profile", which opens
 * the same picker through a window event (src/lib/family/picker.ts).
 *
 * SLOT (contract 2026-10-09): filled by the family part (feat/kcb-family). Nothing imported here may
 * reach tldraw: the app bar renders on prerendered pages.
 */
export default function ProfileSwitcher() {
  const { user } = useAuth();
  const { state } = useFamily(user?.id);
  const [open, setOpen] = useState(false);
  const [pinFor, setPinFor] = useState<FamilyMember | null>(null);

  useEffect(() => onOpenProfilePicker(() => setOpen(true)), []);

  if (!state || !hasOthers(state)) return null;
  const me = currentMember(state);
  if (!me) return null;

  function change(next: boolean) {
    setOpen(next);
    if (!next) setPinFor(null);
  }

  return (
    <>
      <button type="button" className={styles.trigger} onClick={() => setOpen(true)} aria-label={FAMILY_COPY.switcherLabel(me.displayName)} title={FAMILY_COPY.switchProfile} data-testid="profile-switcher">
        <FamilyAvatar name={me.displayName} avatar={me.avatar} size="sm" />
      </button>
      <Dialog open={open} onOpenChange={change}>
        <DialogContent title={pinFor ? FAMILY_COPY.pinTitle(pinFor.displayName) : FAMILY_COPY.pickerTitle} className={styles.dialog}>
          {/* remounted on every open, so it starts at the tiles */}
          {open && <WhoIsPractising state={state} onPinView={setPinFor} />}
        </DialogContent>
      </Dialog>
    </>
  );
}
