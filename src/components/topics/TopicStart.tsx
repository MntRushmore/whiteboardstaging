"use client";

import { useMemo, useState } from "react";
import { LibraryBig, Play, Target } from "lucide-react";
import { Button } from "@/registry/components/button/button";
import { Dialog, DialogContent } from "@/registry/components/dialog/dialog";
import { gradeLabel } from "@/lib/learning/grades";
import { courseName, TOPIC_COPY, topicGroups, upNext, type TopicId, type TopicView } from "@/lib/learning/topics";
import { AreaIcon, AskBox, LevelMark, TopicList } from "./TopicPicker";
import { useTopicActions, useTopicData } from "./useTopicStart";
import styles from "./topics.module.css";

/**
 * The top of the boards home (2026-10-08): Up next — the next topic of the student's grade path (or
 * course) not mastered yet, one tap to a topic board — with their weakest spot beside it, the "What do you want
 * to work on?" box, and Pick a topic (every topic, by area, in a dialog). Loaded with a dynamic
 * import, so the home's first load carries none of it (docs/BUNDLE.md).
 */

export interface TopicStartProps {
  userId: string;
}

function UpNextCard({ topic, kind, busy, onStart }: { topic: TopicView; kind: "next" | "weak"; busy: TopicId | "ask" | null; onStart: (id: TopicId) => void }) {
  const next = kind === "next";
  const titleId = `topic-${kind}-title`;
  return (
    <article className={styles.card} data-kind={kind} aria-labelledby={titleId}>
      <span className={styles.cardIcon} aria-hidden>
        {next ? <AreaIcon area={topic.area} size={24} /> : <Target size={20} strokeWidth={1.8} />}
      </span>
      <div className={styles.cardBody}>
        <p className={styles.eyebrow}>{next ? TOPIC_COPY.upNext : TOPIC_COPY.weakest}</p>
        <h2 id={titleId} className={styles.cardTitle}>
          {topic.name}
        </h2>
        <p className={styles.cardBlurb}>{next ? topic.blurb : TOPIC_COPY.weakestHint}</p>
        <div className={styles.cardActions}>
          <Button
            variant={next ? "primary" : "secondary"}
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

  const busyTopic = actions.busy && actions.busy !== "ask" ? actions.busy : null;
  const cards = view ? [view.choice.next, view.choice.weakest].filter((t): t is TopicView => t !== null) : [];

  return (
    <section className={`${styles.root} ${styles.start}`} aria-label={TOPIC_COPY.browse} data-topic-start="">
      {!view ? (
        <div className={styles.cards} data-count="2" aria-hidden>
          <div className={styles.cardSkeleton} />
        </div>
      ) : cards.length > 0 ? (
        <div className={styles.cards} data-count={cards.length}>
          {view.choice.next && <UpNextCard topic={view.choice.next} kind="next" busy={actions.busy} onStart={actions.startTopic} />}
          {view.choice.weakest && <UpNextCard topic={view.choice.weakest} kind="weak" busy={actions.busy} onStart={actions.startTopic} />}
        </div>
      ) : (
        <p className={styles.inlineError}>{TOPIC_COPY.allDone}</p>
      )}
      {data.status === "ready" && data.recordFailed && <p className={styles.inlineError}>{TOPIC_COPY.loadFailed}</p>}

      <div className={styles.askRowWrap}>
        <AskBox busy={actions.busy === "ask"} onSubmit={actions.ask} grade={grade} />
        <button type="button" className={styles.browse} aria-haspopup="dialog" onClick={() => setBrowsing(true)}>
          <LibraryBig size={18} strokeWidth={1.8} aria-hidden />
          {TOPIC_COPY.browse}
        </button>
      </div>

      <Dialog open={browsing} onOpenChange={setBrowsing}>
        <DialogContent title={TOPIC_COPY.browse} description={TOPIC_COPY.browseHint} className={`${styles.root} ${styles.dialog}`}>
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
