"use client";

import { ChartColumn, Flame, Pencil, Sparkles, Star, Trash2 } from "lucide-react";
import type { FamilyMember } from "@/lib/family/contracts";
import { FAMILY_COPY } from "@/lib/family/copy";
import { gradeLabel, isGrade } from "@/lib/learning/grades";
import { Button } from "@/registry/components/button/button";
import { FamilyAvatar } from "./FamilyAvatar";
import styles from "./familyPage.module.css";

/**
 * One kid on the Family page: their picture, name and grade, this week's three numbers (streak,
 * problems this week, skills mastered: computed on the server for the grown-up's own kids), and what
 * the grown-up can do: switch to them, see their week (the weekly report at this kid, on the grown-up's
 * own profile: no switch), edit, remove. `busy` while this kid's switch is under way; `locked` while
 * another kid's is.
 */
export function KidCard({ kid, busy, locked, onSwitch, onWeek, onEdit, onRemove }: { kid: FamilyMember; busy: boolean; locked: boolean; onSwitch: () => void; onWeek: () => void; onEdit: () => void; onRemove: () => void }) {
  const grade = isGrade(kid.grade) ? gradeLabel(kid.grade) : FAMILY_COPY.gradeNoneShort;
  return (
    <li className={styles.kid} data-testid="kid-card">
      <div className={styles.kidHead}>
        <FamilyAvatar name={kid.displayName} avatar={kid.avatar} size="lg" />
        <div className={styles.kidWho}>
          <h3 className={styles.kidName}>{kid.displayName}</h3>
          <p className={styles.kidGrade}>{grade}</p>
        </div>
        <div className={styles.kidTools}>
          <button type="button" className={styles.iconButton} onClick={onEdit} aria-label={FAMILY_COPY.editTitle(kid.displayName)} title={FAMILY_COPY.edit}>
            <Pencil size={16} strokeWidth={1.9} aria-hidden />
          </button>
          <button type="button" className={`${styles.iconButton} ${styles.iconDanger}`} onClick={onRemove} aria-label={FAMILY_COPY.removeLabel(kid.displayName)} title={FAMILY_COPY.remove} data-testid="kid-remove">
            <Trash2 size={16} strokeWidth={1.9} aria-hidden />
          </button>
        </div>
      </div>

      {kid.stats ? (
        <ul className={styles.stats} aria-label={`${kid.displayName}'s week`}>
          <li className={styles.stat} data-tone={kid.stats.streak > 0 ? "warm" : undefined} data-testid="kid-streak">
            <Flame size={16} strokeWidth={2} aria-hidden />
            {FAMILY_COPY.streak(kid.stats.streak)}
          </li>
          <li className={styles.stat}>
            <Star size={16} strokeWidth={2} aria-hidden />
            {FAMILY_COPY.problemsThisWeek(kid.stats.problemsThisWeek)}
          </li>
          <li className={styles.stat}>
            <Sparkles size={16} strokeWidth={2} aria-hidden />
            {FAMILY_COPY.mastered(kid.stats.mastered)}
          </li>
        </ul>
      ) : (
        <p className={styles.noStats}>{FAMILY_COPY.noStats}</p>
      )}

      <div className={`${styles.kidActions} ${styles.fitRow}`}>
        <Button onClick={onSwitch} loading={busy} disabled={locked} title={FAMILY_COPY.switchTo(kid.displayName)} data-testid="kid-switch">
          {/* a long name ellipsizes at the card's width (a 390 px phone) */}
          <span className={styles.fitLabel}>{FAMILY_COPY.switchTo(kid.displayName)}</span>
        </Button>
        <Button variant="secondary" onClick={onWeek} title={FAMILY_COPY.seeWeek(kid.displayName)} data-testid="kid-week">
          <ChartColumn size={16} strokeWidth={1.9} aria-hidden />
          <span className={`${styles.fitLabel} ${styles.fitLabelIcon}`}>{FAMILY_COPY.seeWeek(kid.displayName)}</span>
        </Button>
      </div>
    </li>
  );
}
