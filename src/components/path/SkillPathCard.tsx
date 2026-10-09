"use client";

import { useMemo } from "react";
import { Trophy } from "lucide-react";
import { pathFor, PATH_COPY } from "@/lib/path/pathView";
import { PathCount, PathSkeleton, PathTrail, PickGrade } from "./PathTrail";
import { usePathData, usePathOpen } from "./usePath";
import styles from "./path.module.css";

/**
 * The student's skill path on the boards home (src/lib/learning/grades.ts): their grade's skills in
 * order, how far along each is, and the next one to do, as a trail. Tapping a stop opens that
 * skill's topic board. Loaded with a dynamic import, below Today's practice (docs/KIDS-COME-BACK.md).
 *
 * Never breaks the home: a loading shape while it reads, nothing at all when the record cannot be
 * read, and "Pick your grade" for a student with no grade and no high-school course.
 */

export interface SkillPathCardProps {
  userId: string;
}

export default function SkillPathCard({ userId }: SkillPathCardProps) {
  const data = usePathData(userId);
  const { busy, open } = usePathOpen(userId, "home");
  const view = useMemo(() => (data.status === "ready" ? pathFor(data.profile, data.levels) : null), [data]);

  if (data.status === "loading") return <PathSkeleton place="home" />;
  if (data.status === "failed") return null;
  if (!view) return <PickGrade place="home" />;

  return (
    <section className={styles.card} data-place="home" aria-labelledby="skill-path-title" data-skill-path={view.kind}>
      <div className={styles.head}>
        <h2 id="skill-path-title" className={styles.title}>
          {view.homeTitle}
        </h2>
        <PathCount view={view} text={view.homeCount} />
      </div>
      <PathTrail view={view} busy={busy} onOpen={open} />
      {view.allDone && (
        <p className={styles.allDone}>
          <Trophy size={18} strokeWidth={2} aria-hidden />
          {PATH_COPY.allDone}
        </p>
      )}
    </section>
  );
}
