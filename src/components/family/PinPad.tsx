"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowLeft, Delete, Loader2 } from "lucide-react";
import { FAMILY_COPY } from "@/lib/family/copy";
import styles from "./family.module.css";

const KEYS = ["1", "2", "3", "4", "5", "6", "7", "8", "9"] as const;
const LENGTH = 4;

/**
 * The grown-up's PIN pad: four dots and big keys a small hand can't miss, no keyboard needed (a
 * grown-up at a desk can still type digits and Backspace). The fourth digit sends it; the answer
 * comes back as `onSubmit`'s message: an error clears the dots and shakes them. The digits are never
 * shown, and live only in this component until they are sent.
 */
export function PinPad({ onSubmit, onBack, disabled = false }: { onSubmit: (pin: string) => Promise<string | null>; onBack: () => void; disabled?: boolean }) {
  const [digits, setDigits] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [shake, setShake] = useState(0);
  // the source of truth for key presses (a state updater must not send anything)
  const typed = useRef("");
  const busyRef = useRef(false);
  const locked = disabled || busy;

  const show = (next: string) => {
    typed.current = next;
    setDigits(next);
  };

  const submit = useCallback(
    async (pin: string) => {
      busyRef.current = true;
      setBusy(true);
      const message = await onSubmit(pin);
      busyRef.current = false;
      setBusy(false);
      if (message) {
        setError(message);
        show("");
        setShake((n) => n + 1);
      }
    },
    [onSubmit],
  );

  const press = useCallback(
    (d: string) => {
      if (busyRef.current || disabled || typed.current.length >= LENGTH) return;
      setError(null);
      const next = typed.current + d;
      show(next);
      if (next.length === LENGTH) void submit(next);
    },
    [disabled, submit],
  );

  const erase = useCallback(() => {
    if (busyRef.current) return;
    show(typed.current.slice(0, -1));
  }, []);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (/^[0-9]$/.test(e.key)) {
        e.preventDefault();
        press(e.key);
      } else if (e.key === "Backspace") {
        e.preventDefault();
        erase();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [press, erase]);

  return (
    <div className={styles.pinPad} data-busy={busy || undefined}>
      <p className={styles.pinHint}>{FAMILY_COPY.pinHint}</p>
      <div key={shake} className={styles.pinDots} data-shake={shake > 0 || undefined} role="img" aria-label={`${digits.length} of ${LENGTH} digits`}>
        {Array.from({ length: LENGTH }, (_, i) => (
          <span key={i} className={styles.pinDot} data-filled={i < digits.length || undefined} />
        ))}
      </div>
      <p className={styles.pinStatus} role="status" aria-live="polite" data-tone={error ? "error" : undefined}>
        {busy ? (
          <>
            <Loader2 size={16} className={styles.spin} aria-hidden /> {FAMILY_COPY.pinChecking}
          </>
        ) : (
          (error ?? " ")
        )}
      </p>
      <div className={styles.keys}>
        {KEYS.map((d) => (
          <button key={d} type="button" className={styles.key} onClick={() => press(d)} disabled={locked} aria-label={FAMILY_COPY.pinDigit(d)}>
            {d}
          </button>
        ))}
        <button type="button" className={`${styles.key} ${styles.keyQuiet}`} onClick={onBack} disabled={busy} aria-label={FAMILY_COPY.pinBack}>
          <ArrowLeft size={26} strokeWidth={2} aria-hidden />
        </button>
        <button type="button" className={styles.key} onClick={() => press("0")} disabled={locked} aria-label={FAMILY_COPY.pinDigit("0")}>
          0
        </button>
        <button type="button" className={`${styles.key} ${styles.keyQuiet}`} onClick={erase} disabled={locked || digits.length === 0} aria-label={FAMILY_COPY.pinDelete}>
          <Delete size={26} strokeWidth={2} aria-hidden />
        </button>
      </div>
    </div>
  );
}
