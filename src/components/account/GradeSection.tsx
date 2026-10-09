"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "@/lib/supabase";
import { clientMetric } from "@/lib/logger";
import { describeError } from "@/lib/errorMessage";
import { Card, CardContent } from "@/components/ui/card";
import { SectionError } from "@/components/account/SectionError";
import { SECTION_BODY, SectionHeader } from "@/components/account/SectionHeader";
import { useSection } from "@/components/account/useSection";
import { accountChoices, choiceKey, choiceLabel, choiceOf, choiceSave, GRADE_SECTION_COPY, parseChoiceKey, type WelcomeChoice } from "@/lib/onboarding/choice";
import { asOnboardingClient, fetchOnboardingProfile, saveOnboarding } from "@/lib/onboarding/storage";
import { FAMILY_COPY } from "@/lib/family/copy";
import { Select } from "@/registry/components/select/select";
import styles from "./gradeSection.module.css";

const client = asOnboardingClient(supabase);

/**
 * The account page's Grade section (`id="grade"`, so `/account#grade` links land on it): the grade
 * (Kindergarten to 8th) or high-school course picked in the welcome, changed any time — a child
 * moves up a grade every year, and a grown-up who skipped the welcome sets it here. Picking one
 * saves it at once through save_onboarding (a grade as "other" plus the grade, a course alone),
 * and the next problems the tutor picks follow it (the skill path and Today's practice read the
 * profile's grade).
 *
 * A kid profile (`kid`, src/lib/family) sees their grade but does not change it: their grown-up
 * does, on the Family page (a kid's grade picks their path and starter problems, and the family is
 * the grown-up's to manage).
 */
export function GradeSection({ userId, kid = false }: { userId: string; kid?: boolean }) {
  const read = useCallback(async (): Promise<WelcomeChoice | null> => {
    const res = await fetchOnboardingProfile(client, userId);
    if (!res.ok) throw new Error(res.error);
    return choiceOf(res.value);
  }, [userId]);
  const { state, retry } = useSection<WelcomeChoice | null>(read, true, GRADE_SECTION_COPY.loadFallback);

  // `saved` overrides what was loaded once a pick is saved, so nothing is read again
  const [saved, setSaved] = useState<WelcomeChoice | null | undefined>(undefined);
  const [saving, setSaving] = useState<WelcomeChoice | null>(null);
  // the pick that did not save, and why: Retry saves it again
  const [failed, setFailed] = useState<{ choice: WelcomeChoice; error: string } | null>(null);
  const [savedNote, setSavedNote] = useState<string | null>(null);
  const cardRef = useRef<HTMLDivElement>(null);
  const loaded = state.status === "ready" || saved !== undefined;
  const current = saved !== undefined ? saved : (state.data ?? null);
  const shown = saving ?? current;

  // A `#grade` link opens the page before this card has loaded: it scrolls here once it has.
  useEffect(() => {
    if (!loaded || typeof window === "undefined" || window.location.hash !== "#grade") return;
    cardRef.current?.scrollIntoView({ block: "start" });
  }, [loaded]);

  async function save(next: WelcomeChoice) {
    if (kid) return;
    setSaving(next);
    setFailed(null);
    setSavedNote(null);
    const res = await saveOnboarding(client, choiceSave(next));
    setSaving(null);
    if (!res.ok) {
      clientMetric("account.grade.saveFailed", { error: res.error });
      setFailed({ choice: next, error: describeError(new Error(res.error), GRADE_SECTION_COPY.saveFallback) });
      return;
    }
    const after = choiceOf(res.value);
    setSaved(after);
    setSavedNote(GRADE_SECTION_COPY.saved(choiceLabel(after) ?? choiceLabel(next) ?? ""));
    clientMetric("account.grade.saved", choiceSave(after));
  }

  return (
    <Card id="grade" ref={cardRef} className={styles.card} data-testid="grade-section">
      <SectionHeader title={GRADE_SECTION_COPY.title} description={kid ? FAMILY_COPY.kidGradeDescription : GRADE_SECTION_COPY.description} />
      <CardContent className={SECTION_BODY}>
        {!loaded && state.status === "loading" ? (
          <div className="h-16 w-full max-w-xs animate-pulse rounded bg-muted/60" data-state="loading" />
        ) : !loaded && state.status === "error" ? (
          <SectionError code="grade_load_failed" title={GRADE_SECTION_COPY.loadFailedTitle} message={state.error ?? GRADE_SECTION_COPY.loadFallback} onRetry={retry} />
        ) : kid ? (
          <div className={styles.body} data-testid="kid-grade">
            <p className={styles.kidGrade}>{choiceLabel(current) ?? FAMILY_COPY.kidGradeNone}</p>
            <p className={styles.status}>{FAMILY_COPY.kidGradeHint}</p>
          </div>
        ) : (
          <div className={`${styles.body} ${styles.picker}`}>
            <div className={styles.field}>
              <Select
                label={GRADE_SECTION_COPY.label}
                placeholder={GRADE_SECTION_COPY.placeholder}
                options={accountChoices(current)}
                value={choiceKey(shown) ?? ""}
                disabled={saving !== null}
                onValueChange={(value) => {
                  const next = parseChoiceKey(value);
                  if (next && choiceKey(next) !== choiceKey(current)) void save(next);
                }}
              />
            </div>
            <p className={styles.status} role="status" aria-live="polite">
              {saving ? GRADE_SECTION_COPY.saving : savedNote}
            </p>
            {failed && (
              <SectionError
                code="grade_save_failed"
                title={GRADE_SECTION_COPY.saveFailedTitle}
                message={failed.error}
                onRetry={() => void save(failed.choice)}
              />
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
