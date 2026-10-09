"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { supabase } from "@/lib/supabase";
import { describeError } from "@/lib/errorMessage";
import { clientMetric } from "@/lib/logger";
import { reportUserError } from "@/lib/reportAppError";
import { writeAskKickoff } from "@/lib/boards/askKickoff";
import { skillDef } from "@/lib/learning/contracts";
import type { Grade } from "@/lib/learning/grades";
import { writePracticeMarker } from "@/lib/learning/practiceMarker";
import { loadTopicData, type TopicData } from "@/lib/learning/topicData";
import { matchTopic, TOPIC_COPY, TOPIC_PROBLEMS, topicBoardTitle, type TopicId } from "@/lib/learning/topics";
import { asOnboardingClient, createFirstBoard } from "@/lib/onboarding/storage";

const client = asOnboardingClient(supabase);

export type TopicDataState = { status: "loading" } | ({ status: "ready" } & TopicData);

/** The student's grade, course and levels for the picker, read once the section mounts. Never fails: see `loadTopicData`. */
export function useTopicData(userId: string | undefined): TopicDataState {
  const [state, setState] = useState<TopicDataState>({ status: "loading" });
  useEffect(() => {
    if (!userId) return;
    let live = true;
    void loadTopicData(userId).then(
      (data) => live && setState({ status: "ready", ...data }),
      () => live && setState({ status: "ready", course: null, grade: null, levels: new Map(), weakSkills: [], recordFailed: true }),
    );
    return () => {
      live = false;
    };
  }, [userId]);
  return state;
}

/** A random seed for a topic's problems: a new set each time. */
function topicSeed(): number {
  return Math.floor(Math.random() * 0x7fffffff);
}

export interface TopicActions {
  /** what is being opened: a topic, or "ask" for the words box */
  busy: TopicId | "ask" | null;
  /** a topic board: named for the topic, its worked example and problems left in its marker */
  startTopic: (id: TopicId) => void;
  /** the words box: a topic they name opens that topic; else a board named after them, with Ask sent them */
  ask: (text: string) => void;
}

/**
 * Opening a topic from the home, like the Progress page's Practice (`useBoardActions`): the board is
 * made first (`createFirstBoard`), the device marker left for it (a topic's problems, or the words
 * for Ask), then the board opens and does the rest. A failure says so in a toast and leaves the
 * buttons ready to try again.
 */
export function useTopicActions(userId: string | undefined, grade: Grade | null = null): TopicActions {
  const router = useRouter();
  const [busy, setBusyState] = useState<TopicId | "ask" | null>(null);
  // read synchronously: two quick taps open one board
  const busyRef = useRef<TopicId | "ask" | null>(null);
  const setBusy = useCallback((next: TopicId | "ask" | null) => {
    busyRef.current = next;
    setBusyState(next);
  }, []);

  const open = useCallback(
    async (kind: TopicId | "ask", title: string, leave: (boardId: string) => boolean) => {
      if (!userId) return;
      setBusy(kind);
      const board = await createFirstBoard(client, userId, title);
      if (!board.ok) {
        toast.error(TOPIC_COPY.failedTitle, { description: describeError(new Error(board.error), TOPIC_COPY.failedFallback) });
        reportUserError({ kind: kind === "ask" ? "live.boards" : "live.practice", code: "create_failed", message: TOPIC_COPY.failedTitle });
        setBusy(null);
        return;
      }
      // no storage on this device (private mode): the board opens blank, named for what was asked
      if (!leave(board.value)) clientMetric("topics.markerFailed", { kind: kind === "ask" ? "ask" : "topic" });
      // busy stays set: the page is leaving
      router.push(`/board/${board.value}`);
    },
    [userId, router, setBusy],
  );

  const startTopic = useCallback(
    (id: TopicId) => {
      if (busyRef.current) return;
      setBusy(id);
      void import("@/lib/learning/practiceSet").then(
        ({ topicSet }) => {
          const set = topicSet(id, TOPIC_PROBLEMS, topicSeed());
          if (set.problems.length === 0) {
            toast.error(TOPIC_COPY.failedTitle, { description: TOPIC_COPY.noProblems });
            reportUserError({ kind: "live.practice", code: "no_problems", message: TOPIC_COPY.failedTitle });
            setBusy(null);
            return;
          }
          clientMetric("topics.start", { skill: id, problems: set.problems.length, from: "home" });
          void open(id, skillDef(id)?.name ?? TOPIC_COPY.browse, (boardId) => writePracticeMarker({ boardId, skill: id, problems: set.problems, examples: set.examples, createdAt: Date.now() }));
        },
        () => {
          toast.error(TOPIC_COPY.failedTitle, { description: TOPIC_COPY.failedFallback });
          setBusy(null);
        },
      );
    },
    [open, setBusy],
  );

  const ask = useCallback(
    (text: string) => {
      if (busyRef.current) return;
      const topic = matchTopic(text, grade);
      if (topic) {
        clientMetric("topics.ask", { routed: true });
        startTopic(topic);
        return;
      }
      clientMetric("topics.ask", { routed: false });
      void open("ask", topicBoardTitle(text), (boardId) => writeAskKickoff({ boardId, message: text, createdAt: Date.now() }));
    },
    [open, startTopic, grade],
  );

  return { busy, startTopic, ask };
}
