"use client";

import { useState, type FormEvent } from "react";
import { KeyRound } from "lucide-react";
import { toast } from "sonner";
import { describeError } from "@/lib/errorMessage";
import { savePin } from "@/lib/family/client";
import { FAMILY_COPY } from "@/lib/family/copy";
import { pinFormError, pinInput } from "@/lib/family/forms";
import { reportUserError } from "@/lib/reportAppError";
import { Button } from "@/registry/components/button/button";
import { Input } from "@/registry/components/input/input";
import styles from "./familyPage.module.css";

/**
 * The grown-up's PIN on the Family page: set it (required before the first kid) or change it. Typed
 * twice, digits only, never shown back. Saving needs nothing but the grown-up's own session.
 */
export function PinCard({ hasPin }: { hasPin: boolean }) {
  const [editing, setEditing] = useState(!hasPin);
  const [pin, setPin] = useState("");
  const [confirm, setConfirm] = useState("");
  const [tried, setTried] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const formError = pinFormError(pin, confirm);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setTried(true);
    if (formError || saving) return;
    setSaving(true);
    setError(null);
    try {
      await savePin(pin);
      toast.success(FAMILY_COPY.pinSaved);
      setPin("");
      setConfirm("");
      setTried(false);
      // the family re-reads itself (savePin -> FAMILY_CHANGED_EVENT), and hasPin turns true
      setEditing(false);
    } catch (err) {
      const message = describeError(err, FAMILY_COPY.pinSaveFailed);
      setError(message);
      reportUserError({ kind: "live.account", code: "family_pin_failed", message: FAMILY_COPY.pinSaveFailed });
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className={styles.section} aria-labelledby="family-pin-title" data-testid="family-pin">
      <div className={styles.sectionHead}>
        <span className={styles.sectionIcon} aria-hidden>
          <KeyRound size={18} strokeWidth={1.9} />
        </span>
        <div>
          <h2 id="family-pin-title" className={styles.sectionTitle}>
            {FAMILY_COPY.pinCardTitle}
          </h2>
          <p className={styles.sectionHint}>{hasPin ? FAMILY_COPY.pinCardSet : FAMILY_COPY.pinCardNew}</p>
        </div>
        {hasPin && !editing && (
          <Button variant="secondary" size="sm" className={styles.sectionAction} onClick={() => setEditing(true)}>
            {FAMILY_COPY.pinChange}
          </Button>
        )}
      </div>
      {editing && (
        <form className={styles.pinForm} onSubmit={(e) => void submit(e)} noValidate>
          <Input
            label={FAMILY_COPY.pinLabel}
            type="password"
            inputMode="numeric"
            autoComplete="new-password"
            pattern="[0-9]{4}"
            maxLength={4}
            value={pin}
            onChange={(e) => setPin(pinInput(e.target.value))}
            className={styles.pinInput}
            error={tried && !/^\d{4}$/.test(pin) ? FAMILY_COPY.pinInvalid : undefined}
            data-testid="family-pin-input"
          />
          <Input
            label={FAMILY_COPY.pinConfirmLabel}
            type="password"
            inputMode="numeric"
            autoComplete="new-password"
            pattern="[0-9]{4}"
            maxLength={4}
            value={confirm}
            onChange={(e) => setConfirm(pinInput(e.target.value))}
            className={styles.pinInput}
            error={tried && /^\d{4}$/.test(pin) && pin !== confirm ? FAMILY_COPY.pinMismatch : undefined}
            data-testid="family-pin-confirm"
          />
          <div className={styles.formActions}>
            {hasPin && (
              <Button type="button" variant="ghost" onClick={() => setEditing(false)} disabled={saving}>
                {FAMILY_COPY.cancel}
              </Button>
            )}
            <Button type="submit" loading={saving} data-testid="family-pin-save">
              {hasPin ? FAMILY_COPY.pinChange : FAMILY_COPY.pinSave}
            </Button>
          </div>
          {error && (
            <p className={styles.formError} role="alert">
              {error}
            </p>
          )}
        </form>
      )}
    </section>
  );
}
