"use client";

import { useId, useState, type FormEvent, type ReactNode } from "react";
import { ArrowRight, Calculator, ChartSpline, ChevronDown, ChevronRight, FlaskConical, Loader2, Shapes, Sigma, TriangleRight, Variable } from "lucide-react";
import type { MasteryLevel, SkillArea } from "@/lib/learning/contracts";
import { LEVEL_LABELS } from "@/lib/learning/progressView";
import { matchTopic, TOPIC_COPY, TOPIC_INFO, type TopicGroup, type TopicId, type TopicView } from "@/lib/learning/topics";
import { skillDef } from "@/lib/learning/contracts";
import styles from "./topics.module.css";

/**
 * The topic picker's parts, shared by the home (`TopicStart`) and the board's New topic sheet
 * (`TopicSheet`): an area's icon, a topic's level, the list of topics by area with "Other topics"
 * folded away, and the "What do you want to work on?" box. Plain buttons and an input styled by
 * `topics.module.css` (Arc tokens, light fallbacks on the board), so the board's sheet carries no
 * Arc component code.
 */

const AREA_ICONS: Readonly<Record<SkillArea, (size: number) => ReactNode>> = {
  arithmetic: (size) => <Calculator size={size} strokeWidth={1.8} aria-hidden />,
  algebra: (size) => <Variable size={size} strokeWidth={1.8} aria-hidden />,
  functions: (size) => <ChartSpline size={size} strokeWidth={1.8} aria-hidden />,
  geometry: (size) => <Shapes size={size} strokeWidth={1.8} aria-hidden />,
  trig: (size) => <TriangleRight size={size} strokeWidth={1.8} aria-hidden />,
  calculus: (size) => <Sigma size={size} strokeWidth={1.8} aria-hidden />,
  science: (size) => <FlaskConical size={size} strokeWidth={1.8} aria-hidden />,
};

export function AreaIcon({ area, size = 18 }: { area: SkillArea; size?: number }) {
  return <>{AREA_ICONS[area](size)}</>;
}

/** A topic's level: a dot that fills as it grows (New ○, Practicing, Almost there, Mastered ●) and its word. */
export function LevelMark({ level }: { level: MasteryLevel }) {
  return (
    <span className={styles.level} data-level={level}>
      <span className={styles.dot} aria-hidden />
      <span className={styles.levelWord}>{LEVEL_LABELS[level]}</span>
    </span>
  );
}

export interface TopicButtonProps {
  topic: TopicView;
  /** a topic board is being made: every row waits, this one spins */
  busy: TopicId | null;
  onPick: (id: TopicId) => void;
}

export function TopicButton({ topic, busy, onPick }: TopicButtonProps) {
  const mine = busy === topic.id;
  return (
    <button type="button" className={styles.topic} data-topic={topic.id} disabled={busy !== null} aria-busy={mine || undefined} onClick={() => onPick(topic.id)}>
      <span className={styles.topicText}>
        <span className={styles.topicName}>{topic.name}</span>
        <span className={styles.topicBlurb}>{topic.blurb}</span>
      </span>
      <LevelMark level={topic.level} />
      {mine ? <Loader2 size={18} className={`${styles.chev} ${styles.spin}`} aria-hidden /> : <ChevronRight size={18} className={styles.chev} aria-hidden />}
    </button>
  );
}

function Groups({ groups, idPrefix, ...pick }: { groups: readonly TopicGroup[]; idPrefix: string } & Omit<TopicButtonProps, "topic">) {
  return (
    <>
      {groups.map((g) => (
        <section key={g.area} aria-labelledby={`${idPrefix}-${g.area}`}>
          <h3 id={`${idPrefix}-${g.area}`} className={styles.groupHead}>
            <span className={styles.groupIcon}>
              <AreaIcon area={g.area} />
            </span>
            {g.label}
          </h3>
          <ul className={styles.topics}>
            {g.topics.map((t) => (
              <li key={t.id}>
                <TopicButton topic={t} {...pick} />
              </li>
            ))}
          </ul>
        </section>
      ))}
    </>
  );
}

export interface TopicListProps {
  mine: readonly TopicGroup[];
  others: readonly TopicGroup[];
  /** the course's name ("Algebra 1"), or null: the list starts with the numbers */
  course: string | null;
  busy: TopicId | null;
  onPick: (id: TopicId) => void;
  /** "Other topics" open from the start (the board's sheet keeps it closed, as the home does) */
  othersOpen?: boolean;
}

/** The student's course by area, then every other topic folded under "Other topics". */
export function TopicList({ mine, others, course, busy, onPick, othersOpen = false }: TopicListProps) {
  const id = useId();
  const [open, setOpen] = useState(othersOpen);
  return (
    <div className={styles.list}>
      <p className={styles.listHead}>{TOPIC_COPY.mine(course)}</p>
      <Groups groups={mine} idPrefix={`${id}-mine`} busy={busy} onPick={onPick} />
      {others.length > 0 && (
        <div>
          <button type="button" className={styles.others} aria-expanded={open} aria-controls={`${id}-others`} onClick={() => setOpen((o) => !o)}>
            <span>
              {TOPIC_COPY.others}
              <span className={styles.othersHint}>{TOPIC_COPY.othersHint}</span>
            </span>
            <ChevronDown size={20} className={styles.othersChev} aria-hidden />
          </button>
          <div id={`${id}-others`} className={styles.othersList} hidden={!open}>
            {open && <Groups groups={others} idPrefix={`${id}-others`} busy={busy} onPick={onPick} />}
          </div>
        </div>
      )}
    </div>
  );
}

export interface AskBoxProps {
  /** the words, sent: a topic they name opens that topic, else Ask gets them */
  onSubmit: (text: string) => void;
  busy: boolean;
  /** the visible label (the home's question; the board's "Or ask for anything") */
  label?: string;
}

/** "What do you want to work on?": a box, Go, and a line saying what Go will do. */
export function AskBox({ onSubmit, busy, label = TOPIC_COPY.askTitle }: AskBoxProps) {
  const id = useId();
  const [text, setText] = useState("");
  const words = text.trim();
  const topic = words ? matchTopic(words) : null;
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!words || busy) return;
    onSubmit(words);
  };
  return (
    <form className={styles.ask} onSubmit={submit}>
      <label htmlFor={`${id}-input`} className={styles.askLabel}>
        {label}
      </label>
      <div className={styles.askRow}>
        <input
          id={`${id}-input`}
          className={styles.askInput}
          value={text}
          maxLength={500}
          autoComplete="off"
          enterKeyHint="go"
          placeholder={TOPIC_COPY.askPlaceholder}
          aria-describedby={`${id}-hint`}
          onChange={(e) => setText(e.target.value)}
        />
        <button type="submit" className={styles.askGo} disabled={!words} aria-busy={busy || undefined}>
          {busy ? <Loader2 size={18} className={styles.spin} aria-hidden /> : <ArrowRight size={18} aria-hidden />}
          {TOPIC_COPY.askGo}
        </button>
      </div>
      <p id={`${id}-hint`} className={styles.askHint} aria-live="polite">
        {words ? topic ? <>{TOPIC_COPY.askTopic(skillDef(topic)?.name ?? TOPIC_INFO[topic].blurb)}</> : TOPIC_COPY.askTutor : null}
      </p>
    </form>
  );
}
