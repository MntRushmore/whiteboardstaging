"use client";

import { useMemo, useState } from "react";
import { LibraryBig, Play, Target } from "lucide-react";
import { Button } from "@/registry/components/button/button";
import { Dialog, DialogContent } from "@/registry/components/dialog/dialog";
import { gradeLabel, type Grade } from "@/lib/learning/grades";
import { courseName, TOPIC_COPY, topicGroups, upNext, type TopicId, type TopicView } from "@/lib/learning/topics";
import { pathSkillIds, pathSourceFor } from "@/lib/path/pathView";
import { AreaIcon, AskBox, LevelMark, TopicList } from "./TopicPicker";
import { useTopicActions, useTopicData, type OpeningKind } from "./useTopicStart";
import styles from "./topics.module.css";

/**
 * Under Today's practice and the skill path on the boards home: the student's weakest spot (Keep at
 * it), the "What do you want to work on?" box, and Pick a topic (every topic, by area, in a dialog).
 * Today's practice is the one big first step; everything here is secondary and looks it.
 *
 * Up next shows only when the skill path does not already show it (no grade or course yet, or a path
 * finished and the next grade's skill up). A K–3 kid gets Pick a topic alone; the words box is inside
 * it, over the list. Loaded with a dynamic import, so the home's first load carries none of it
 * (docs/BUNDLE.md).
 */

export interface TopicStartProps {
  userId: string;
}

/** A K–3 kid (Kindergarten to 3rd grade): Pick a topic alone on the home, the words box inside it. */
export function isYoungGrade(grade: Grade | null | undefined): boolean {
  return typeof grade === "number" && grade <= 3;
}

/** Whether the skill path above already shows this Up next (its Next up stop): then this card would only repeat it. */
export function pathShowsNext(next: TopicView | null, grade: Grade | null | undefined, course: Parameters<typeof pathSourceFor>[0]["course"]): boolean {
  if (!next) return false;
  const source = pathSourceFor({ grade, course });
  return source.kind !== "pick" && pathSkillIds(source).includes(next.id);
}

/** Up next or Keep at it: one card shape for both, secondary to Today's practice (one title size, the button and level on one row). */
function UpNextCard({ topic, kind, busy, onStart }: { topic: TopicView; kind: "next" | "weak"; busy: OpeningKind | null; onStart: (id: TopicId) => void }) {
  const next = kind === "next";
  const titleId = `topic-${kind}-title`;
  return (
    <article className={styles.card} data-kind={kind} aria-labelledby={titleId}>
      <span className={styles.cardIcon} aria-hidden>
        {next ? <AreaIcon area={topic.area} size={22} /> : <Target size={20} strokeWidth={1.8} />}
      </span>
      <div className={styles.cardBody}>
        <p className={styles.eyebrow}>{next ? TOPIC_COPY.upNext : TOPIC_COPY.weakest}</p>
        <h2 id={titleId} className={styles.cardTitle}>
          {topic.name}
        </h2>
        <p className={styles.cardBlurb}>{next ? topic.blurb : TOPIC_COPY.weakestHint}</p>
        <div className={styles.cardActions}>
          <Button
            variant="secondary"
            size="lg"
            loading={busy === topic.id}
            disabled={busy !== null}
            aria-label={`${next ? TOPIC_COPY.start : TOPIC_COPY.practise}: ${topic.name}`}
            onClick={() => onStart(topic.id)}
          >
            <Play size={16} strokeWidth={2} aria-hidden />
            {next ? TOPIC_COPY.start : TOPIC_COPY.practise}
          </Button>
          <LevelMark level={topic.level} />
        </div>
      </div>
    </article>
  );
}

export default function TopicStart({ userId }: TopicStartProps) {
  const data = useTopicData(userId);
  const grade = data.status === "ready" ? data.grade : null;
  const actions = useTopicActions(userId, grade);
  const [browsing, setBrowsing] = useState(false);

  const view = useMemo(() => {
    if (data.status !== "ready") return null;
    return {
      choice: upNext(data.course, data.levels, data.weakSkills, data.grade),
      groups: topicGroups(data.course, data.levels, data.grade),
      course: courseName(data.course),
      grade: gradeLabel(data.grade),
    };
  }, [data]);

  // the list spins for a topic it is opening; while Ask or Today's practice holds the page's lock it stays as it is (the lock refuses a tap there)
  const busyTopic = actions.busy && actions.busy !== "ask" && actions.busy !== "daily" ? actions.busy : null;
  // the path's Next up stop is Up next already: no second card for the same skill
  const next = view && data.status === "ready" && !pathShowsNext(view.choice.next, data.grade, data.course) ? view.choice.next : null;
  const cards = view ? [next, view.choice.weakest].filter((t): t is TopicView => t !== null) : [];
  const young = isYoungGrade(grade);
  const askBox = <AskBox busy={actions.busy === "ask"} onSubmit={actions.ask} grade={grade} />;

  return (
    <section className={`${styles.root} ${styles.start}`} aria-label={TOPIC_COPY.browse} data-topic-start="">
      {!view ? (
        <div className={styles.cards} data-count="1" aria-hidden>
          <div className={styles.cardSkeleton} />
        </div>
      ) : cards.length > 0 ? (
        <div className={styles.cards} data-count={cards.length}>
          {next && <UpNextCard topic={next} kind="next" busy={actions.busy} onStart={actions.startTopic} />}
          {view.choice.weakest && <UpNextCard topic={view.choice.weakest} kind="weak" busy={actions.busy} onStart={actions.startTopic} />}
        </div>
      ) : !view.choice.next ? (
        <p className={styles.inlineError}>{TOPIC_COPY.allDone}</p>
      ) : null}
      {data.status === "ready" && data.recordFailed && <p className={styles.inlineError}>{TOPIC_COPY.loadFailed}</p>}

      <div className={styles.askRowWrap} data-young={young || undefined}>
        {!young && askBox}
        <button type="button" className={styles.browse} aria-haspopup="dialog" onClick={() => setBrowsing(true)}>
          <LibraryBig size={18} strokeWidth={1.8} aria-hidden />
          {TOPIC_COPY.browse}
        </button>
      </div>

      <Dialog open={browsing} onOpenChange={setBrowsing}>
        <DialogContent title={TOPIC_COPY.browse} description={TOPIC_COPY.browseHint} className={`${styles.root} ${styles.dialog}`}>
          {young && <div className={styles.dialogAsk}>{askBox}</div>}
          {view ? (
            <TopicList mine={view.groups.mine} others={view.groups.others} course={view.course} grade={view.grade} busy={busyTopic} onPick={actions.startTopic} />
          ) : (
            <div className={styles.cardSkeleton} aria-hidden />
          )}
        </DialogContent>
      </Dialog>
    </section>
  );
}
