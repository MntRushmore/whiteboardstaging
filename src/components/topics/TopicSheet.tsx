"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { Sparkles, Target, X } from "lucide-react";
import { toast } from "sonner";
import { useEditor, useValue } from "tldraw";
import type { AssistanceMode } from "@/hooks/useAssistanceMode";
import { skillDef } from "@/lib/learning/contracts";
import { gradeLabel } from "@/lib/learning/grades";
import { courseName, matchTopic, TOPIC_COPY, TOPIC_PROBLEMS, topicGroups, upNext, type TopicId } from "@/lib/learning/topics";
import type { LiveController } from "@/lib/live/contracts";
import { clientMetric } from "@/lib/logger";
import { reportUserError } from "@/lib/reportAppError";
import { practiceDeps } from "@/components/learning/PracticeBoard";
import { PRACTICE_COPY, writePracticeSet } from "@/components/learning/usePracticeBoard";
import { AskBox, TopicList } from "./TopicPicker";
import { topicSheetOpen } from "./topicSheetState";
import { useTopicData } from "./useTopicStart";
import styles from "./topics.module.css";

/**
 * The board's New topic (the screen strip's button): the home's topic picker as a sheet — a bottom
 * sheet on a phone, beside the board from a tablet up. A topic goes on a new screen of this board
 * (this one, while it is still empty), named after it: the tutor works one example, then writes a
 * few problems easy to hard on the screen after it (`writePracticeSet`, as a topic board does).
 * Words in the box that name no one topic go to Ask, which opens with them sent.
 *
 * Loaded on the first tap of New topic, never with the board (docs/BUNDLE.md).
 */

export interface TopicSheetProps {
  boardId: string;
  userId: string;
  controller: LiveController;
  onModeChange: (mode: AssistanceMode) => void;
  /** words for the tutor: the board opens Ask and sends them */
  onAsk: (text: string) => void;
}

const topicSeed = () => Math.floor(Math.random() * 0x7fffffff);

export default function TopicSheet({ boardId, userId, controller, onModeChange, onAsk }: TopicSheetProps) {
  const editor = useEditor();
  const open = useValue("topic sheet open", () => topicSheetOpen.get(), []);
  const data = useTopicData(userId);
  const [busy, setBusy] = useState<TopicId | null>(null);
  const busyRef = useRef(false);

  const grade = data.status === "ready" ? data.grade : null;

  const view = useMemo(() => {
    if (data.status !== "ready") return null;
    return {
      choice: upNext(data.course, data.levels, data.weakSkills, data.grade),
      groups: topicGroups(data.course, data.levels, data.grade),
      course: courseName(data.course),
      grade: gradeLabel(data.grade),
    };
  }, [data]);

  const start = useCallback(
    async (id: TopicId) => {
      if (busyRef.current) return;
      busyRef.current = true;
      setBusy(id);
      try {
        const { topicSet } = await import("@/lib/learning/practiceSet");
        const set = topicSet(id, TOPIC_PROBLEMS, topicSeed());
        const run = controller.runChatActions;
        if (set.problems.length === 0 || !run) {
          toast(set.problems.length === 0 ? TOPIC_COPY.noProblems : PRACTICE_COPY.topicFailed);
          return;
        }
        topicSheetOpen.set(false);
        // a screen with work on it keeps it: the topic goes on a new one (the chat's own new_screen)
        const newScreen = editor.getCurrentPageShapeIds().size > 0;
        clientMetric("topics.start", { skill: id, problems: set.problems.length, from: "board", newScreen });
        void writePracticeSet(
          set,
          {
            ...practiceDeps(editor, onModeChange),
            run: (actions, from) => run(actions, from),
            reportFailure: (code, message) => reportUserError({ kind: "live.practice", code, message, boardId }),
          },
          { newScreen },
        );
      } catch {
        toast(PRACTICE_COPY.topicFailed);
      } finally {
        busyRef.current = false;
        setBusy(null);
      }
    },
    [boardId, controller, editor, onModeChange],
  );

  const ask = useCallback(
    (text: string) => {
      const topic = matchTopic(text, grade);
      clientMetric("topics.ask", { routed: Boolean(topic), from: "board" });
      if (topic) {
        void start(topic);
        return;
      }
      topicSheetOpen.set(false);
      onAsk(text);
    },
    [onAsk, start, grade],
  );

  const chips = view ? [view.choice.next && { kind: "next" as const, topic: view.choice.next }, view.choice.weakest && { kind: "weak" as const, topic: view.choice.weakest }].filter((c) => c !== null && c !== undefined) : [];

  return (
    <Dialog.Root open={open} onOpenChange={(o) => topicSheetOpen.set(o)}>
      <Dialog.Portal>
        <Dialog.Overlay className={styles.overlay} />
        <Dialog.Content className={`${styles.root} ${styles.sheet}`} aria-describedby={undefined} data-topic-sheet="">
          <div className={styles.sheetHead}>
            <div>
              <Dialog.Title className={styles.sheetTitle}>{TOPIC_COPY.sheetTitle}</Dialog.Title>
              <p className={styles.sheetHint}>{TOPIC_COPY.sheetHint}</p>
            </div>
            <Dialog.Close className={styles.sheetClose} aria-label="Close">
              <X size={18} aria-hidden />
            </Dialog.Close>
          </div>
          <div className={styles.sheetBody}>
            {chips.length > 0 && (
              <div className={styles.chips}>
                {chips.map((c) => (
                  <button key={c.kind} type="button" className={styles.chip} disabled={busy !== null} onClick={() => void start(c.topic.id)}>
                    {c.kind === "next" ? <Sparkles size={16} aria-hidden /> : <Target size={16} aria-hidden />}
                    <span className={styles.chipEyebrow}>{c.kind === "next" ? TOPIC_COPY.upNext : TOPIC_COPY.weakest}:</span>
                    {skillDef(c.topic.id)?.name ?? c.topic.name}
                  </button>
                ))}
              </div>
            )}
            <AskBox busy={false} onSubmit={ask} grade={grade} />
            {view ? (
              <TopicList mine={view.groups.mine} others={view.groups.others} course={view.course} grade={view.grade} busy={busy} onPick={(id) => void start(id)} />
            ) : (
              <div className={styles.cardSkeleton} aria-hidden />
            )}
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
