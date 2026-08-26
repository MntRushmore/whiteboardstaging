"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { Editor, TLShapeId } from "tldraw";
import { toast } from "sonner";
import { logger } from "@/lib/logger";
import {
  acceptTutorMarks,
  applyTutorMarks,
  clearTutorMarks,
  fadeInTutorShapes,
  getPendingTutorShapeIds,
  rejectTutorMarks,
  stampStudentProblemId,
} from "@/lib/tutor/applyMarks";
import {
  allChangesAreTutorLayer,
  clusterFromSeeds,
  collectAllStudentText,
  studentInkIdsFromDiff,
} from "@/lib/tutor/cluster";
import {
  canSelectProblem,
  createProblemSet,
  markProblemFinished,
  recordInkOnProblem,
} from "@/lib/tutor/problems";
import { getPageProblemId, goToProblemPage } from "@/lib/tutor/pages";
import { decideSocraticAnswer } from "@/lib/tutor/answer";
import { isUsableLatex } from "@/lib/tutor/normalize";
import { recognizeStrokes } from "@/lib/tutor/recognize";
import {
  TUTOR_DEBOUNCE_MS,
  type AssistanceMode,
  type ClusterBounds,
  type ProblemRecord,
  type TutorResponse,
} from "@/lib/tutor/types";

export type TutorEngineStatus = "idle" | "generating" | "success" | "error";

type UseTutorEngineOptions = {
  editor?: Editor;
  assistanceMode: AssistanceMode;
  autoEnabled: boolean;
  onStatus?: (status: TutorEngineStatus, message: string) => void;
};

export function useTutorEngine({
  editor,
  assistanceMode,
  autoEnabled,
  onStatus,
}: UseTutorEngineOptions) {
  const [lastResult, setLastResult] = useState<TutorResponse | null>(null);
  const [clusterBounds, setClusterBounds] = useState<ClusterBounds | null>(null);
  const [hasMarks, setHasMarks] = useState(false);
  const [hasPending, setHasPending] = useState(false);
  const [problems, setProblems] = useState<ProblemRecord[]>(() => createProblemSet());
  const [activeProblemId, setActiveProblemId] = useState(1);

  const applyingRef = useRef(false);
  const processingRef = useRef(false);
  const abortRef = useRef<AbortController | null>(null);
  const pendingIdsRef = useRef<Set<TLShapeId>>(new Set());
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const modeRef = useRef(assistanceMode);
  const autoRef = useRef(autoEnabled);
  const lastResultRef = useRef<TutorResponse | null>(null);
  const onStatusRef = useRef(onStatus);
  const problemsRef = useRef(problems);
  const activeRef = useRef(activeProblemId);
  const rejectedDiagramsRef = useRef(new Set<number>());

  modeRef.current = assistanceMode;
  autoRef.current = autoEnabled;
  lastResultRef.current = lastResult;
  onStatusRef.current = onStatus;
  problemsRef.current = problems;
  activeRef.current = activeProblemId;

  const setBusy = useCallback((status: TutorEngineStatus, message: string) => {
    onStatusRef.current?.(status, message);
  }, []);

  const refreshPending = useCallback(() => {
    if (!editor) {
      setHasPending(false);
      return;
    }
    setHasPending(getPendingTutorShapeIds(editor, activeRef.current).length > 0);
  }, [editor]);

  const clearMarks = useCallback(() => {
    if (!editor) return;
    applyingRef.current = true;
    try {
      clearTutorMarks(editor, activeRef.current);
      setHasMarks(false);
      refreshPending();
    } finally {
      queueMicrotask(() => {
        applyingRef.current = false;
      });
    }
  }, [editor, refreshPending]);

  const acceptMarks = useCallback(() => {
    if (!editor) return;
    applyingRef.current = true;
    try {
      acceptTutorMarks(editor, activeRef.current);
      setHasPending(false);
    } finally {
      queueMicrotask(() => {
        applyingRef.current = false;
      });
    }
  }, [editor]);

  const rejectMarks = useCallback(() => {
    if (!editor) return;
    applyingRef.current = true;
    try {
      const removed = rejectTutorMarks(editor, activeRef.current);
      if (removed.length > 0) rejectedDiagramsRef.current.add(activeRef.current);
      setHasMarks(false);
      setHasPending(false);
    } finally {
      queueMicrotask(() => {
        applyingRef.current = false;
      });
    }
  }, [editor]);

  const selectProblem = useCallback((id: number) => {
    if (!canSelectProblem(id)) return;
    const prevId = activeRef.current;
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    pendingIdsRef.current.clear();
    abortRef.current?.abort();
    abortRef.current = null;
    processingRef.current = false;
    if (prevId !== id) {
      setProblems((prev) => {
        const next = markProblemFinished(prev, prevId);
        problemsRef.current = next;
        return next;
      });
    }
    activeRef.current = id;
    setActiveProblemId(id);
    if (editor) {
      goToProblemPage(editor, id);
      refreshPending();
    }
  }, [editor, refreshPending]);

  /** Last stroke cluster → Mathpix → one Socratic mark. No picture fallback. */
  const runCluster = useCallback(
    async (options?: { seedIds?: TLShapeId[] }): Promise<boolean> => {
      if (!editor || processingRef.current) return false;

      const seedIds = options?.seedIds ?? [];
      if (seedIds.length === 0) return false;

      const cluster = clusterFromSeeds(editor, seedIds);
      if (!cluster) return false;

      const problemId = getPageProblemId(editor);
      activeRef.current = problemId;
      setActiveProblemId(problemId);

      applyingRef.current = true;
      try {
        stampStudentProblemId(editor, cluster.shapeIds, problemId);
      } finally {
        queueMicrotask(() => {
          applyingRef.current = false;
        });
      }

      processingRef.current = true;
      abortRef.current?.abort();
      const abort = new AbortController();
      abortRef.current = abort;

      try {
        setBusy("generating", "Reading your work...");

        const latex = await recognizeStrokes(cluster.strokes, abort.signal);
        if (abort.signal.aborted) {
          setBusy("idle", "");
          return false;
        }

        const nextProblems = recordInkOnProblem(
          problemsRef.current,
          problemId,
          cluster.bounds,
          latex,
        );
        problemsRef.current = nextProblems;
        setProblems(nextProblems);
        setClusterBounds(nextProblems[problemId - 1]?.bbox ?? cluster.bounds);

        const bbox = nextProblems[problemId - 1]?.bbox ?? cluster.bounds;
        if (!isUsableLatex(latex)) {
          logger.info({ problemId, latex }, "Mathpix miss; stay quiet");
          setBusy("idle", "");
          return false;
        }

        const response = await fetch("/api/tutor?mode=socratic", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          signal: abort.signal,
          body: JSON.stringify({ problemId, latex, bbox }),
        });

        if (abort.signal.aborted) {
          setBusy("idle", "");
          return false;
        }

        if (!response.ok) {
          const errBody = await response.json().catch(() => ({}));
          if (response.status === 402 || errBody?.error === "credits_exhausted") {
            const msg =
              errBody?.message ||
              "Account credits depleted — please talk to Rushil to refill your account!";
            toast.error(msg, { duration: 8000 });
            logger.info({ problemId, latex }, "Flash miss; stay quiet");
            setBusy("idle", "");
            return false;
          }
          logger.info(
            { problemId, latex, status: response.status },
            "Flash miss; stay quiet",
          );
          setBusy("idle", "");
          return false;
        }

        const result = (await response.json()) as TutorResponse;
        lastResultRef.current = result;
        setLastResult(result);

        const decision = decideSocraticAnswer(seedIds.length, result.latex, result.marks);
        if (decision.action === "quiet") {
          logger.info(
            {
              problemId: result.problemId,
              latex: result.latex,
              miss: result.miss,
              reason: decision.reason,
            },
            decision.reason === "mathpix-miss"
              ? "Mathpix miss; stay quiet"
              : "Flash miss; stay quiet",
          );
          setBusy("idle", "");
          return false;
        }

        applyingRef.current = true;
        const ids = applyTutorMarks(editor, decision.marks, "socratic");
        fadeInTutorShapes(editor, ids);
        setHasMarks(ids.length > 0);
        setHasPending(ids.length > 0);
        queueMicrotask(() => {
          applyingRef.current = false;
        });

        setBusy("success", "Question added");
        setTimeout(() => setBusy("idle", ""), 1600);
        return true;
      } catch (error) {
        if (abort.signal.aborted) {
          setBusy("idle", "");
          return false;
        }
        logger.info({ error, problemId }, "Flash miss; stay quiet");
        setBusy("idle", "");
        return false;
      } finally {
        processingRef.current = false;
        if (abortRef.current === abort) abortRef.current = null;
        pendingIdsRef.current.clear();
      }
    },
    [editor, setBusy],
  );

  const schedule = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      timerRef.current = null;
      if (!autoRef.current) {
        pendingIdsRef.current.clear();
        return;
      }
      const seeds = [...pendingIdsRef.current];
      pendingIdsRef.current.clear();
      void runCluster({ seedIds: seeds });
    }, TUTOR_DEBOUNCE_MS);
  }, [runCluster]);

  useEffect(() => {
    if (!editor) return;

    const dispose = editor.store.listen(
      (entry) => {
        if (applyingRef.current || processingRef.current) return;
        if (allChangesAreTutorLayer(entry.changes)) return;

        const { addedOrUpdated } = studentInkIdsFromDiff(entry.changes);
        if (addedOrUpdated.length === 0) return;

        for (const id of addedOrUpdated) pendingIdsRef.current.add(id);
        if (abortRef.current) {
          abortRef.current.abort();
          abortRef.current = null;
          processingRef.current = false;
          setBusy("idle", "");
        }
        schedule();
      },
      { source: "user", scope: "document" },
    );

    return () => {
      dispose();
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [editor, schedule, setBusy]);

  useEffect(() => {
    if (!editor) return;
    refreshPending();
  }, [editor, activeProblemId, refreshPending]);

  const getWorkspaceContext = useCallback(() => {
    const active = problemsRef.current[activeRef.current - 1];
    const latex = active?.latex || lastResultRef.current?.latex || "";
    const text = editor ? collectAllStudentText(editor) : "";
    return { latex, text };
  }, [editor]);

  return {
    lastResult,
    clusterBounds,
    hasMarks,
    hasPending,
    clearMarks,
    acceptMarks,
    rejectMarks,
    runNow: runCluster,
    getWorkspaceContext,
    problems,
    activeProblemId,
    selectProblem,
  };
}
