"use client";

import { useMemo } from "react";
import { Trophy } from "lucide-react";
import { useAuth } from "@/components/AuthProvider";
import { isKidEmail } from "@/lib/family/contracts";
import type { SkillProgress } from "@/lib/learning/contracts";
import { levelsOf } from "@/lib/learning/topics";
import { pathFor, PATH_COPY } from "@/lib/path/pathView";
import { Section } from "@/components/progress/ProgressSections";
import { PathSkeleton, PathTrail, PickGrade, StarsKey } from "./PathTrail";
import { usePathOpen, usePathProfile } from "./usePath";
import styles from "./path.module.css";

export interface ProgressPathProps {
  userId: string | undefined;
  /** the Progress page's summary skills (their levels): the page has read the record already */
  skills: readonly Pick<SkillProgress, "skill" | "level">[];
}

/**
 * The top of the Progress page: the student's path with its header, "3rd grade path: 2 of 4 skills
 * mastered", which a grown-up reads too, and what the stars mean. Tapping a stop opens its topic
 * board, as on the home. The levels come from the page's own read; only the grade is read here.
 */
export function ProgressPath({ userId, skills }: ProgressPathProps) {
  // a kid profile's grade is their grown-up's to pick (on /family): Pick your grade says who to ask
  const kid = isKidEmail(useAuth().user?.email);
  const profile = usePathProfile(userId);
  const { busy, open } = usePathOpen(userId, "progress");
  const view = useMemo(() => (profile.status === "ready" ? pathFor(profile, levelsOf(skills)) : null), [profile, skills]);

  if (profile.status === "loading") return <PathSkeleton place="progress" />;
  if (!view) return <PickGrade place="progress" kid={kid} />;

  return (
    <Section id="path-title" title={view.progressTitle} hint={PATH_COPY.progressHint} extra={<StarsKey />}>
      <div className={styles.card} data-place="progress" data-skill-path={view.kind}>
        <PathTrail view={view} busy={busy} onOpen={open} />
        {view.allDone && (
          <p className={styles.allDone}>
            <Trophy size={18} strokeWidth={2} aria-hidden />
            {PATH_COPY.allDoneProgress}
          </p>
        )}
      </div>
    </Section>
  );
}
