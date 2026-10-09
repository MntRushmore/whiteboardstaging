"use client";

import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
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
  /** what is being opened: a topic, "ask" for the words box, or "daily" for Today's practice (`useToday`) */
  busy: OpeningKind | null;
  /** a topic board: named for the topic, its worked example and problems left in its marker */
  startTopic: (id: TopicId) => void;
  /** the words box: a topic they name opens that topic; else a board named after them, with Ask sent them */
  ask: (text: string) => void;
}

// ------------------------------------------------------------------ one board at a time, page-wide

/**
 * What is being opened, for every `useTopicActions` on the page — and Today's practice (`useToday`:
 * Start, Continue, Practise more). The home has three cards that make boards (Today's practice, the
 * skill path's stops, and Up next / Ask / Pick a topic), and each tap makes a board before the page
 * moves: a lock per hook let a tap on one start a second board while the other's was still being
 * made. One lock for the page, read synchronously, so two quick taps anywhere open one board; every
 * hook's `busy` is this, so the other cards' buttons wait too. Released by its holder on a failure,
 * or when the holder unmounts (a successful open keeps it while the page leaves).
 */
export type OpeningKind = TopicId | "ask" | "daily";
type TopicOpening = { owner: object; kind: OpeningKind };
let opening: TopicOpening | null = null;
const openingListeners = new Set<() => void>();

function setOpening(next: TopicOpening | null): void {
  opening = next;
  for (const listener of openingListeners) listener();
}

/** Take the page's lock for `owner`; false while anyone (this hook included) holds it. */
export function claimTopicOpen(owner: object, kind: OpeningKind): boolean {
  if (opening) return false;
  setOpening({ owner, kind });
  return true;
}

/** Give the lock back, if `owner` holds it. */
export function releaseTopicOpen(owner: object): void {
  if (opening?.owner === owner) setOpening(null);
}

/** What the page is opening, or null. */
export function topicOpening(): OpeningKind | null {
  return opening?.kind ?? null;
}

/** Tests only: drop the lock whoever holds it (a page unmounting does this through its holder). */
export function resetTopicOpeningForTests(): void {
  setOpening(null);
}

/** Called whenever the lock is taken or given back (for `useSyncExternalStore`). */
export function subscribeOpening(listener: () => void): () => void {
  openingListeners.add(listener);
  return () => {
    openingListeners.delete(listener);
  };
}

const noOpening = () => null;

/**
 * Opening a topic from the home, like the Progress page's Practice (`useBoardActions`): the board is
 * made first (`createFirstBoard`), the device marker left for it (a topic's problems, or the words
 * for Ask), then the board opens and does the rest. A failure says so in a toast and leaves the
 * buttons ready to try again. One board at a time for the whole page (`claimTopicOpen`).
 */
export function useTopicActions(userId: string | undefined, grade: Grade | null = null): TopicActions {
  const router = useRouter();
  // this hook's key to the page's lock
  const [owner] = useState(() => ({}));
  const busy = useSyncExternalStore(subscribeOpening, topicOpening, noOpening);
  const release = useCallback(() => releaseTopicOpen(owner), [owner]);
  // leaving the page (after a successful open, or mid-way) gives the lock back
  useEffect(() => release, [release]);

  const open = useCallback(
    async (kind: OpeningKind, title: string, leave: (boardId: string) => boolean) => {
      if (!userId) {
        release();
        return;
      }
      const board = await createFirstBoard(client, userId, title);
      if (!board.ok) {
        toast.error(TOPIC_COPY.failedTitle, { description: describeError(new Error(board.error), TOPIC_COPY.failedFallback) });
        reportUserError({ kind: kind === "ask" ? "live.boards" : "live.practice", code: "create_failed", message: TOPIC_COPY.failedTitle });
        release();
        return;
      }
      // no storage on this device (private mode): the board opens blank, named for what was asked
      if (!leave(board.value)) clientMetric("topics.markerFailed", { kind: kind === "ask" ? "ask" : "topic" });
      // the lock stays held: the page is leaving (unmounting gives it back)
      router.push(`/board/${board.value}`);
    },
    [userId, router, release],
  );

  const startTopic = useCallback(
    (id: TopicId) => {
      if (!claimTopicOpen(owner, id)) return;
      void import("@/lib/learning/practiceSet").then(
        ({ topicSet }) => {
          const set = topicSet(id, TOPIC_PROBLEMS, topicSeed());
          if (set.problems.length === 0) {
            toast.error(TOPIC_COPY.failedTitle, { description: TOPIC_COPY.noProblems });
            reportUserError({ kind: "live.practice", code: "no_problems", message: TOPIC_COPY.failedTitle });
            release();
            return;
          }
          clientMetric("topics.start", { skill: id, problems: set.problems.length, from: "home" });
          void open(id, skillDef(id)?.name ?? TOPIC_COPY.browse, (boardId) => writePracticeMarker({ boardId, skill: id, problems: set.problems, examples: set.examples, createdAt: Date.now() }));
        },
        () => {
          toast.error(TOPIC_COPY.failedTitle, { description: TOPIC_COPY.failedFallback });
          release();
        },
      );
    },
    [owner, open, release],
  );

  const ask = useCallback(
    (text: string) => {
      if (topicOpening()) return;
      const topic = matchTopic(text, grade);
      if (topic) {
        clientMetric("topics.ask", { routed: true });
        startTopic(topic);
        return;
      }
      if (!claimTopicOpen(owner, "ask")) return;
      clientMetric("topics.ask", { routed: false });
      void open("ask", topicBoardTitle(text), (boardId) => writeAskKickoff({ boardId, message: text, createdAt: Date.now() }));
    },
    [owner, open, startTopic, grade],
  );

  return { busy, startTopic, ask };
}
