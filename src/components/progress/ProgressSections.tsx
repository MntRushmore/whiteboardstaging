"use client";

import type { ReactNode } from "react";
import { ChevronRight, Clock, Flame, HeartHandshake, Lightbulb, PencilLine, Star, ThumbsUp } from "lucide-react";
import type { SkillId } from "@/lib/learning/contracts";
import { LEVEL_LABELS, PROGRESS_COPY, type MistakeView, type SkillGroup, type SkillView, type WeekTile } from "@/lib/learning/progressView";
import { Badge, type BadgeTone } from "@/registry/components/badge/badge";
import { Button } from "@/registry/components/button/button";
import styles from "./progress.module.css";

/** A titled block of the page; its heading names the region. */
export function Section({ id, title, hint, children, extra }: { id: string; title: string; hint?: string; children: ReactNode; extra?: ReactNode }) {
  return (
    <section aria-labelledby={id} className={styles.section}>
      <div className={styles.sectionHead}>
        <h2 id={id} className={styles.sectionTitle}>
          {title}
        </h2>
        {hint && <p className={styles.sectionHint}>{hint}</p>}
        {extra}
      </div>
      {children}
    </section>
  );
}

// ------------------------------------------------------------------ this week

const TILE_ICONS: Record<WeekTile["key"], ReactNode> = {
  minutes: <Clock size={20} strokeWidth={1.9} />,
  problems: <PencilLine size={20} strokeWidth={1.9} />,
  independent: <ThumbsUp size={20} strokeWidth={1.9} />,
  streak: <Flame size={20} strokeWidth={1.9} />,
};

/** Four big numbers: minutes, problems, solved on your own, and the day streak. */
export function WeekTiles({ tiles }: { tiles: readonly WeekTile[] }) {
  return (
    <ul className={styles.tiles}>
      {tiles.map((t) => (
        <li key={t.key} className={styles.tile} data-tile={t.key}>
          <span className={styles.tileIcon} aria-hidden>
            {TILE_ICONS[t.key]}
          </span>
          {/* read as one phrase: "45 minutes of practice, on 4 days" */}
          <p className={styles.tileValue}>
            {t.value}
            <span className={styles.srOnly}> {t.label}</span>
          </p>
          <p className={styles.tileLabel} aria-hidden>
            {t.label}
          </p>
          {t.hint && <p className={styles.tileHint}>{t.hint}</p>}
        </li>
      ))}
    </ul>
  );
}

// ------------------------------------------------------------------ skills

const LEVEL_TONES: Record<SkillView["level"], BadgeTone> = {
  new: "neutral",
  practicing: "info",
  almost: "warning",
  mastered: "success",
};

/** Arc's Badge with this page's tints (`.badge` in the stylesheet). */
export function ToneBadge({ tone, size, level, className, children }: { tone: BadgeTone; size?: "sm" | "md"; level?: SkillView["level"]; className?: string; children: string }) {
  return (
    <Badge tone={tone} size={size} data-tone={tone} data-level={level} className={[styles.badge, className].filter(Boolean).join(" ")}>
      {children}
    </Badge>
  );
}

function LevelBadge({ level, size }: { level: SkillView["level"]; size?: "sm" | "md" }) {
  return (
    <ToneBadge tone={LEVEL_TONES[level]} size={size} level={level} className={styles.levelBadge}>
      {LEVEL_LABELS[level]}
    </ToneBadge>
  );
}

/** New › Practicing › Almost there › Mastered: what the badges mean, in order. */
export function LevelLadder() {
  const levels = ["new", "practicing", "almost", "mastered"] as const;
  return (
    <ol className={styles.ladder} aria-label={PROGRESS_COPY.skillsLadder}>
      {levels.map((level, i) => (
        <li key={level}>
          <LevelBadge level={level} size="sm" />
          {i < levels.length - 1 && <ChevronRight size={14} strokeWidth={2} className={styles.ladderArrow} aria-hidden />}
        </li>
      ))}
    </ol>
  );
}

interface PracticeProps {
  busy: SkillId | "new" | null;
  /** whether a skill has practice problems (`hasPractice`) */
  canPractice: (skill: string) => boolean;
  onPractice: (skill: SkillView) => void;
}

function SkillCard({ skill, busy, canPractice, onPractice }: { skill: SkillView } & PracticeProps) {
  const mastered = skill.level === "mastered";
  const nameId = `skill-${skill.skill}`;
  return (
    <li className={styles.skill} data-level={skill.level}>
      <div className={styles.skillHead}>
        <h4 id={nameId} className={styles.skillName}>
          {mastered && <Star size={18} strokeWidth={1.9} className={styles.star} aria-hidden />}
          {skill.name}
        </h4>
        <LevelBadge level={skill.level} />
      </div>
      {/* a skill not tried yet has nothing to measure: no bar, a shorter card */}
      {skill.attempts > 0 && (
        <div
          className={styles.meter}
          role="progressbar"
          aria-labelledby={nameId}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={skill.percent}
          aria-valuetext={`${skill.levelLabel}, ${skill.percent}%`}
        >
          <div className={styles.meterFill} style={{ width: `${skill.percent}%` }} />
        </div>
      )}
      <div className={styles.skillFoot}>
        <span className={styles.skillCount}>{skill.problemsText}</span>
        {canPractice(skill.skill) && (
          <Button
            size="sm"
            variant="secondary"
            onClick={() => onPractice(skill)}
            disabled={busy !== null && busy !== skill.skill}
            aria-busy={busy === skill.skill || undefined}
            aria-label={busy === skill.skill ? undefined : `${PROGRESS_COPY.practice} ${skill.name}`}
          >
            <PencilLine size={14} strokeWidth={1.9} aria-hidden />
            {busy === skill.skill ? PROGRESS_COPY.practiceStarting : PROGRESS_COPY.practice}
          </Button>
        )}
      </div>
    </li>
  );
}

/** Every skill, grouped by area in teaching order, each with its level, a bar and Practice. */
export function SkillMap({ groups, ...practice }: { groups: readonly SkillGroup[] } & PracticeProps) {
  return (
    <div className={styles.groups}>
      {groups.map((g) => (
        <div key={g.key}>
          <h3 className={styles.groupTitle}>{g.label}</h3>
          <ul className={styles.skillGrid}>
            {g.skills.map((s) => (
              <SkillCard key={s.skill} skill={s} {...practice} />
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}

// ------------------------------------------------------------------ watch out for

/** The slips seen most in the last 30 days, each with how often and a tip. */
export function MistakeList({ items }: { items: readonly MistakeView[] }) {
  return (
    <ul className={styles.mistakes}>
      {items.map((m) => (
        <li key={m.kind} className={styles.mistake}>
          <div className={styles.mistakeHead}>
            <h3 className={styles.mistakeLabel}>{m.label}</h3>
            <ToneBadge tone="neutral" size="sm">
              {m.countText}
            </ToneBadge>
          </div>
          <p className={styles.tip}>
            <Lightbulb size={16} strokeWidth={1.9} className={styles.tipIcon} aria-hidden />
            <span>
              <span className={styles.srOnly}>Tip: </span>
              {m.tip}
            </span>
          </p>
        </li>
      ))}
    </ul>
  );
}

// ------------------------------------------------------------------ for grown-ups

export function GrownUps({ text }: { text: string }) {
  return (
    <section aria-labelledby="grown-ups-title" className={styles.grownUps}>
      <div className={styles.grownUpsHead}>
        <HeartHandshake size={20} strokeWidth={1.8} aria-hidden />
        <h2 id="grown-ups-title" className={styles.sectionTitle}>
          {PROGRESS_COPY.grownUpsTitle}
        </h2>
      </div>
      <p className={styles.grownUpsText}>{text}</p>
    </section>
  );
}

// ------------------------------------------------------------------ loading

/** Shaped like the tiles, the chart and the skills, so nothing jumps when they arrive. */
export function ProgressSkeleton() {
  return (
    <div className={styles.stack} data-state="loading" aria-busy role="status" aria-label="Loading your progress">
      <div className={styles.section}>
        <div className={`${styles.skeletonHeading} ${styles.pulse}`} />
        <div className={styles.tiles}>
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className={`${styles.skeletonTile} ${styles.pulse}`} />
          ))}
        </div>
      </div>
      <div className={styles.section}>
        <div className={`${styles.skeletonHeading} ${styles.pulse}`} />
        <div className={`${styles.skeletonBlock} ${styles.pulse}`} />
      </div>
      <div className={styles.section}>
        <div className={`${styles.skeletonHeading} ${styles.pulse}`} />
        <div className={`${styles.skeletonBlock} ${styles.pulse}`} />
      </div>
    </div>
  );
}
