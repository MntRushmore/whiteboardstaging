"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { supabase } from "@/lib/supabase";
import { describeError } from "@/lib/errorMessage";
import { clientMetric } from "@/lib/logger";
import { DEFAULT_BOARD_TITLE } from "@/lib/boards/boardTitle";
import { isCourseId, type CourseId } from "@/lib/onboarding/courseIds";
import { asOnboardingClient, createFirstBoard } from "@/lib/onboarding/storage";
import type { AttemptRecord, LearningSummary, SkillId } from "@/lib/learning/contracts";
import { hasPractice, practiceProblems } from "@/lib/learning/practiceSet";
import { writePracticeMarker } from "@/lib/learning/practiceMarker";
import { PROGRESS_COPY, practiceTitle } from "@/lib/learning/progressView";
import { loadAttempts } from "@/lib/learning/store";
import { summarize } from "@/lib/learning/summary";

const client = asOnboardingClient(supabase);

/** How many problems a practice board starts with. */
const PRACTICE_COUNT = 4;

export interface ProgressProfile {
  course: CourseId | null;
  displayName: string | null;
}

export type ProgressData =
  | { status: "loading" }
  | { status: "error"; error: string }
  | {
      status: "ready";
      attempts: AttemptRecord[];
      summary: LearningSummary;
      profile: ProgressProfile;
      /** when it was read: the summary's "now" */
      now: number;
      tzOffsetMinutes: number;
    };

/**
 * The course and display name, as the account page reads its profile (the owner's select policy).
 * Never fails the page: without them the title has no course and the paragraph no name.
 */
async function readProfile(userId: string): Promise<ProgressProfile> {
  try {
    const { data, error } = await supabase.from("profiles").select("display_name, course").eq("user_id", userId).maybeSingle();
    if (error || !data) return { course: null, displayName: null };
    const row = data as { display_name?: unknown; course?: unknown };
    return {
      course: isCourseId(row.course) ? row.course : null,
      displayName: typeof row.display_name === "string" ? row.display_name : null,
    };
  } catch {
    return { course: null, displayName: null };
  }
}

/** The record and profile, summarized in the browser's time zone. Never throws. */
async function fetchProgress(userId: string): Promise<ProgressData> {
  try {
    const [attempts, profile] = await Promise.all([loadAttempts(), readProfile(userId)]);
    const now = Date.now();
    const tzOffsetMinutes = new Date(now).getTimezoneOffset();
    const summary = summarize(attempts, now, { course: profile.course, tzOffsetMinutes });
    clientMetric("progress.viewed", { problems: summary.totals.problems });
    return { status: "ready", attempts, summary, profile, now, tzOffsetMinutes };
  } catch (error) {
    console.error("Error loading progress:", error);
    return { status: "error", error: describeError(error, PROGRESS_COPY.loadFallback) };
  }
}

/**
 * The student's learning record (`loadAttempts`, their own rows) and profile, summarized in their
 * time zone. Read when the page opens and on Retry.
 */
export function useProgressData(userId: string | undefined): { data: ProgressData; reload: () => void } {
  const [data, setData] = useState<ProgressData>({ status: "loading" });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (!userId) return;
    let live = true;
    void fetchProgress(userId).then((next) => {
      if (live) setData(next);
    });
    return () => {
      live = false;
    };
  }, [userId, attempt]);

  const reload = useCallback(() => {
    setData({ status: "loading" });
    setAttempt((n) => n + 1);
  }, []);

  return { data, reload };
}

/** A random seed for a practice set: a new set each time. */
function practiceSeed(): number {
  return Math.floor(Math.random() * 0x7fffffff);
}

export interface BoardActions {
  /** the skill whose practice board is being made, or "new" for a blank board */
  busy: SkillId | "new" | null;
  /** whether Practice shows for a skill */
  canPractice: (skill: string) => boolean;
  practice: (skill: { skill: SkillId; name: string }) => void;
  newBoard: () => void;
}

/**
 * Practice opens a board of problems for one skill: the board is created like the welcome's first
 * board (`createFirstBoard`), named "Practice: <skill>", the problems are left for it in the device's
 * practice marker, and the board writes them when it opens. New board makes an ordinary blank one.
 * A failure says so in a toast and leaves the button ready to try again.
 */
export function useBoardActions(userId: string | undefined): BoardActions {
  const router = useRouter();
  const [busy, setBusy] = useState<SkillId | "new" | null>(null);

  const open = useCallback(
    async (kind: SkillId | "new", title: string, problems: string[][] | null, failedTitle: string) => {
      if (!userId) return;
      setBusy(kind);
      const board = await createFirstBoard(client, userId, title);
      if (!board.ok) {
        toast.error(failedTitle, { description: describeError(new Error(board.error), PROGRESS_COPY.practiceFallback) });
        setBusy(null);
        return;
      }
      if (problems && kind !== "new" && !writePracticeMarker({ boardId: board.value, skill: kind, problems, createdAt: Date.now() })) {
        // no storage on this device (private mode): the board opens blank, named for the skill
        clientMetric("progress.practice.markerFailed", { skill: kind });
      }
      // busy stays set: the page is leaving
      router.push(`/board/${board.value}`);
    },
    [userId, router],
  );

  const practice = useCallback(
    (skill: { skill: SkillId; name: string }) => {
      if (busy) return;
      const problems = practiceProblems(skill.skill, PRACTICE_COUNT, practiceSeed());
      if (problems.length === 0) {
        toast.error(PROGRESS_COPY.practiceFailedTitle, { description: PROGRESS_COPY.practiceNone });
        return;
      }
      clientMetric("progress.practice.start", { skill: skill.skill, problems: problems.length });
      void open(skill.skill, practiceTitle(skill.name), problems, PROGRESS_COPY.practiceFailedTitle);
    },
    [busy, open],
  );

  const newBoard = useCallback(() => {
    if (busy) return;
    void open("new", DEFAULT_BOARD_TITLE, null, PROGRESS_COPY.newBoardFailedTitle);
  }, [busy, open]);

  return { busy, canPractice: hasPractice, practice, newBoard };
}
