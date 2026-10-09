"use client";

import { HeartHandshake } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { FAMILY_COPY } from "@/lib/family/copy";
import { gradeLabel, isGrade } from "@/lib/learning/grades";
import { FamilyAvatar } from "./FamilyAvatar";
import { useFamily } from "./useFamily";
import styles from "./familyPage.module.css";

/**
 * The account page for a kid profile, all of it: one friendly card with their picture, name and
 * grade, and one line saying their grown-up looks after the plan and changes these on the Family
 * page. No billing, no email, no delete notice: nothing on it is a kid's to change.
 */
export function KidAccountCard({ userId, fallbackName }: { userId: string; fallbackName: string }) {
  const { state, loading } = useFamily(userId);
  const me = state?.members.find((m) => m.userId === userId) ?? null;
  const name = me?.displayName || fallbackName;
  const grade = me ? (isGrade(me.grade) ? gradeLabel(me.grade) : FAMILY_COPY.kidGradeNone) : null;

  return (
    <Card data-testid="kid-account">
      <CardContent className="p-5 sm:p-6">
        <div className={styles.kidAccount} aria-busy={!me && loading ? true : undefined}>
          <FamilyAvatar name={name} avatar={me?.avatar ?? null} size="xl" />
          <div className={styles.kidAccountWho}>
            <p className={styles.kidAccountName}>{name}</p>
            <p className={styles.kidAccountGrade}>{grade ?? (loading ? FAMILY_COPY.kidAccountLoading : FAMILY_COPY.kidGradeNone)}</p>
          </div>
        </div>
        <p className={styles.kidAccountNote}>
          <HeartHandshake size={18} strokeWidth={1.8} aria-hidden />
          <span>{FAMILY_COPY.kidAccountNote}</span>
        </p>
      </CardContent>
    </Card>
  );
}
