"use client";

import { useState, type FormEvent } from "react";
import { Check } from "lucide-react";
import { describeError } from "@/lib/errorMessage";
import { addKid, editKid } from "@/lib/family/client";
import { AVATARS, NAME_MAX, type AvatarId, type FamilyMember } from "@/lib/family/contracts";
import { FAMILY_COPY } from "@/lib/family/copy";
import { GRADE_OPTIONS, gradeError, gradeFromOption, nameError, optionFromGrade } from "@/lib/family/forms";
import { reportUserError } from "@/lib/reportAppError";
import { Button } from "@/registry/components/button/button";
import { Dialog, DialogContent } from "@/registry/components/dialog/dialog";
import { Input } from "@/registry/components/input/input";
import { Select } from "@/registry/components/select/select";
import { FamilyAvatar } from "./FamilyAvatar";
import styles from "./familyPage.module.css";

const AVATAR_IDS = Object.keys(AVATARS) as AvatarId[];

/**
 * Add a kid, or edit one: a name, a grade (Kindergarten to 8th, or high school) and a picture from
 * AVATARS. The grade picks the kid's skill path and starter problems, so a new kid starts with none
 * picked ("Pick a grade") and cannot be added without one: a skipped field never puts a 6-year-old on
 * the high-school path. The picture is what they tap to switch in, so it is the biggest thing here.
 * `kid` set = edit (only what changed is sent).
 */
export function KidDialog({ open, kid, onOpenChange, onSaved }: { open: boolean; kid: FamilyMember | null; onOpenChange: (open: boolean) => void; onSaved: (name: string) => void }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent title={kid ? FAMILY_COPY.editTitle(kid.displayName) : FAMILY_COPY.addKidTitle} description={kid ? undefined : FAMILY_COPY.addKidHint} className={styles.kidDialog}>
        {open && <KidForm kid={kid} onDone={(name) => (onOpenChange(false), onSaved(name))} onCancel={() => onOpenChange(false)} />}
      </DialogContent>
    </Dialog>
  );
}

function KidForm({ kid, onDone, onCancel }: { kid: FamilyMember | null; onDone: (name: string) => void; onCancel: () => void }) {
  const [name, setName] = useState(kid?.displayName ?? "");
  // a new kid has no grade until one is picked; an existing kid's is what is stored
  const [grade, setGrade] = useState(kid ? optionFromGrade(kid.grade) : "");
  const [avatar, setAvatar] = useState<AvatarId>(kid?.avatar ?? AVATAR_IDS[0]);
  const [tried, setTried] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const problem = nameError(name);
  const gradeProblem = gradeError(grade);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setTried(true);
    if (problem || gradeProblem || saving) return;
    setSaving(true);
    setError(null);
    const displayName = name.trim();
    const gradeValue = gradeFromOption(grade);
    try {
      if (kid) {
        const patch = {
          ...(displayName !== kid.displayName ? { displayName } : {}),
          ...(gradeValue !== kid.grade ? { grade: gradeValue } : {}),
          ...(avatar !== kid.avatar ? { avatar } : {}),
        };
        if (Object.keys(patch).length > 0) await editKid(kid.userId, patch);
      } else {
        await addKid({ displayName, grade: gradeValue, avatar });
      }
      onDone(displayName);
    } catch (err) {
      const fallback = kid ? FAMILY_COPY.editFailed : FAMILY_COPY.addKidFailed;
      setError(describeError(err, fallback));
      reportUserError({ kind: "live.account", code: kid ? "family_edit_failed" : "family_add_failed", message: fallback });
      setSaving(false);
    }
  }

  return (
    <form className={styles.kidForm} onSubmit={(e) => void submit(e)} noValidate>
      <div className={styles.kidPreview} aria-hidden>
        <FamilyAvatar name={name || "?"} avatar={avatar} size="xl" />
      </div>
      <Input
        label={FAMILY_COPY.nameLabel}
        placeholder={FAMILY_COPY.namePlaceholder}
        value={name}
        maxLength={NAME_MAX + 5}
        autoComplete="off"
        onChange={(e) => setName(e.target.value)}
        error={tried && problem ? problem : undefined}
        autoFocus={!kid}
        data-testid="kid-name"
      />
      <div className={styles.gradeField} data-invalid={tried && gradeProblem ? "" : undefined}>
        <Select label={FAMILY_COPY.gradeLabel} placeholder={FAMILY_COPY.gradePlaceholder} options={GRADE_OPTIONS} value={grade} onValueChange={setGrade} data-testid="kid-grade" />
        {tried && gradeProblem && (
          <p className={styles.fieldError} role="alert" data-testid="kid-grade-error">
            {gradeProblem}
          </p>
        )}
      </div>
      <fieldset className={styles.avatarField}>
        <legend className={styles.avatarLegend}>{FAMILY_COPY.avatarLabel}</legend>
        <div className={styles.avatarGrid} role="radiogroup" aria-label={FAMILY_COPY.avatarLabel}>
          {AVATAR_IDS.map((id) => (
            <button
              key={id}
              type="button"
              role="radio"
              aria-checked={avatar === id}
              aria-label={id}
              className={styles.avatarOption}
              data-selected={avatar === id || undefined}
              onClick={() => setAvatar(id)}
              data-testid={`avatar-${id}`}
            >
              <FamilyAvatar name={id} avatar={id} size="lg" />
              {avatar === id && (
                <span className={styles.avatarCheck} aria-hidden>
                  <Check size={12} strokeWidth={3} />
                </span>
              )}
            </button>
          ))}
        </div>
      </fieldset>
      {!kid && <p className={styles.consent}>{FAMILY_COPY.consent}</p>}
      {error && (
        <p className={styles.formError} role="alert">
          {error}
        </p>
      )}
      <div className={styles.formActions}>
        <Button type="button" variant="ghost" onClick={onCancel} disabled={saving}>
          {FAMILY_COPY.cancel}
        </Button>
        <Button type="submit" loading={saving} data-testid="kid-save">
          {kid ? FAMILY_COPY.editSave : FAMILY_COPY.addKidSave}
        </Button>
      </div>
    </form>
  );
}
