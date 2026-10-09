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
 * the grown-up can do: switch to them, see their Progress (switch, then /progress), edit, remove.
 * `busy` is what this kid's switch is doing; `locked` while another kid's is under way.
 */
export function KidCard({ kid, busy, locked, onSwitch, onProgress, onEdit, onRemove }: { kid: FamilyMember; busy: "switch" | "progress" | null; locked: boolean; onSwitch: () => void; onProgress: () => void; onEdit: () => void; onRemove: () => void }) {
  const grade = isGrade(kid.grade) ? gradeLabel(kid.grade) : FAMILY_COPY.gradeNone;
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
          <button type="button" className={`${styles.iconButton} ${styles.iconDanger}`} onClick={onRemove} aria-label={FAMILY_COPY.removeTitle(kid.displayName)} title={FAMILY_COPY.remove} data-testid="kid-remove">
            <Trash2 size={16} strokeWidth={1.9} aria-hidden />
          </button>
        </div>
      </div>

      {kid.stats ? (
        <ul className={styles.stats} aria-label={`${kid.displayName}'s week`}>
          <li className={styles.stat} data-tone={kid.stats.streak > 0 ? "warm" : undefined}>
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

      <div className={styles.kidActions}>
        <Button onClick={onSwitch} loading={busy === "switch"} disabled={locked || busy === "progress"} data-testid="kid-switch">
          {FAMILY_COPY.switchTo(kid.displayName)}
        </Button>
        <Button variant="secondary" onClick={onProgress} loading={busy === "progress"} disabled={locked || busy === "switch"}>
          <ChartColumn size={16} strokeWidth={1.9} aria-hidden />
          {FAMILY_COPY.seeProgress}
        </Button>
      </div>
    </li>
  );
}
