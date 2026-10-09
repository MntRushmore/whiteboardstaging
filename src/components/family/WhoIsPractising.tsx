"use client";

import { useState } from "react";
import Link from "next/link";
import { Loader2, Lock, Settings } from "lucide-react";
import type { FamilyMember, FamilyState } from "@/lib/family/contracts";
import { FAMILY_PATH, switchProfile } from "@/lib/family/client";
import { FAMILY_COPY } from "@/lib/family/copy";
import { switchErrorView } from "@/lib/family/switchError";
import { reportUserError } from "@/lib/reportAppError";
import { FamilyAvatar } from "./FamilyAvatar";
import { PinPad } from "./PinPad";
import styles from "./family.module.css";

/**
 * "Who's practising?": a big tile for every member of the family. Tapping a kid switches to them
 * (no PIN); the grown-up's tile has a lock and opens the PIN pad. The signed-in profile is marked
 * "You" and does nothing. Used in the app bar's switcher dialog; `onPinView` tells the dialog
 * which title to show.
 */
export function WhoIsPractising({ state, onPinView, dest }: { state: FamilyState; onPinView?: (member: FamilyMember | null) => void; dest?: string }) {
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pinFor, setPinFor] = useState<FamilyMember | null>(null);

  function showPin(member: FamilyMember | null) {
    setPinFor(member);
    setError(null);
    onPinView?.(member);
  }

  async function become(member: FamilyMember, pin?: string): Promise<string | null> {
    try {
      await switchProfile(member.userId, { pin, dest });
      return null; // the page is reloading
    } catch (err) {
      const view = switchErrorView(err);
      if (!view.expected) reportUserError({ kind: "live.account", code: view.code, message: view.message });
      return view.message;
    }
  }

  async function tap(member: FamilyMember) {
    if (busy || member.userId === state.me) return;
    if (member.isParent) {
      showPin(member);
      return;
    }
    setBusy(member.userId);
    setError(null);
    const message = await become(member);
    if (message) {
      setError(message);
      setBusy(null);
    }
  }

  if (pinFor) {
    return <PinPad onSubmit={(pin) => become(pinFor, pin)} onBack={() => showPin(null)} />;
  }

  return (
    <div className={styles.picker}>
      <p className={styles.pickerHint}>{FAMILY_COPY.pickerHint}</p>
      <ul className={styles.tiles}>
        {state.members.map((m) => {
          const isMe = m.userId === state.me;
          const locked = m.isParent && !isMe;
          return (
            <li key={m.userId}>
              <button
                type="button"
                className={styles.tile}
                data-me={isMe || undefined}
                data-busy={busy === m.userId || undefined}
                disabled={isMe || (busy !== null && busy !== m.userId)}
                aria-current={isMe ? "true" : undefined}
                aria-label={locked ? `${m.displayName}. ${FAMILY_COPY.grownUpLocked}` : isMe ? `${m.displayName} (${FAMILY_COPY.you})` : m.displayName}
                onClick={() => void tap(m)}
              >
                <span className={styles.tileFace}>
                  <FamilyAvatar name={m.displayName} avatar={m.avatar} size="xl" />
                  {locked && (
                    <span className={styles.tileLock} aria-hidden>
                      <Lock size={16} strokeWidth={2.4} />
                    </span>
                  )}
                  {busy === m.userId && (
                    <span className={styles.tileSpinner} aria-hidden>
                      <Loader2 size={28} className={styles.spin} />
                    </span>
                  )}
                </span>
                <span className={styles.tileName}>{m.displayName}</span>
                {isMe && <span className={styles.tileYou}>{FAMILY_COPY.you}</span>}
              </button>
            </li>
          );
        })}
      </ul>
      <p className={styles.pickerError} role="alert">
        {busy ? FAMILY_COPY.switching : (error ?? "")}
      </p>
      {state.role === "parent" && (
        <Link href={FAMILY_PATH} className={styles.manage}>
          <Settings size={16} strokeWidth={1.8} aria-hidden />
          {FAMILY_COPY.manageFamily}
        </Link>
      )}
    </div>
  );
}
