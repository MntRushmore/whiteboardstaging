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
  lastStudentClusterSeeds,
  solveLineClusters,
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
import { pinMathNotesResult, pinSocraticNote } from "@/lib/tutor/layout";
import { looksLikeAlgebra, solveNextStep } from "@/lib/tutor/mathNotes";
import { isUsableLatex } from "@/lib/tutor/normalize";
import { recognizeStrokes } from "@/lib/tutor/recognize";
import {
  MATH_NOTES_SCAN_MAX,
  TUTOR_DEBOUNCE_MS,
  assistanceToTutorMode,
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
  const ranClusterKeysRef = useRef(new Set<string>());
  const lastSolveLatexRef = useRef("");

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
    if (id === activeRef.current) return;
    const prevId = activeRef.current;
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    pendingIdsRef.current.clear();
    ranClusterKeysRef.current.clear();
    lastSolveLatexRef.current = "";
    abortRef.current?.abort();
    abortRef.current = null;
    processingRef.current = false;
    applyingRef.current = false;
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

      const mode = assistanceToTutorMode(modeRef.current);
      if (!mode) return false;

      const clusterKey = [...cluster.shapeIds].sort().join(",");
      if (mode !== "solve" && clusterKey && ranClusterKeysRef.current.has(clusterKey)) {
        return false;
      }

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

        if (cluster.strokes.length === 0) {
          logger.info(
            { problemId, seedCount: seedIds.length, shapeIds: cluster.shapeIds.length },
            "Mathpix miss; stay quiet",
          );
          setBusy("idle", "");
          return false;
        }

        if (mode === "solve") {
          const lines = solveLineClusters(editor, seedIds).slice(0, MATH_NOTES_SCAN_MAX);
          const candidates = lines.length > 0 ? lines : [cluster];
          let solved = false;
          for (const line of candidates) {
            if (line.strokes.length === 0) continue;
            logger.info(
              {
                problemId,
                strokeCount: line.strokes.length,
                bbox: line.bounds,
              },
              "POST /api/recognize write line",
            );
            const lineLatex = await recognizeStrokes(line.strokes, abort.signal);
            if (abort.signal.aborted) {
              setBusy("idle", "");
              return false;
            }
            if (!isUsableLatex(lineLatex)) continue;
            let resultText = solveNextStep(lineLatex);
            if (!resultText && looksLikeAlgebra(lineLatex)) {
              const response = await fetch("/api/tutor?mode=solve", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                signal: abort.signal,
                body: JSON.stringify({
                  problemId,
                  latex: lineLatex,
                  bbox: line.bounds,
                  mode: "solve",
                }),
              });
              if (abort.signal.aborted) {
                setBusy("idle", "");
                return false;
              }
              if (response.ok) {
                const payload = (await response.json()) as TutorResponse;
                resultText = payload.marks[0]?.text?.trim() || "";
              }
            }
            if (!resultText) {
              logger.info({ problemId, latex: lineLatex }, "skip stray; not a solve line");
              continue;
            }

            const nextProblems = recordInkOnProblem(
              problemsRef.current,
              problemId,
              line.bounds,
              lineLatex,
            );
            problemsRef.current = nextProblems;
            setProblems(nextProblems);
            setClusterBounds(line.bounds);

            if (lastSolveLatexRef.current === lineLatex) {
              setBusy("idle", "");
              return false;
            }
            lastSolveLatexRef.current = lineLatex;

            applyingRef.current = true;
            try {
              const mark = pinMathNotesResult(
                {
                  kind: "note",
                  pageId: "",
                  x: line.bounds.x,
                  y: line.bounds.y,
                  w: line.bounds.w,
                  h: line.bounds.h,
                  text: resultText,
                  problemId,
                  latex: lineLatex,
                  bbox: line.bounds,
                },
                line.bounds,
              );
              const ids = applyTutorMarks(editor, [mark], "solve");
              fadeInTutorShapes(editor, ids);
              setHasMarks(ids.length > 0);
              setHasPending(false);
            } finally {
              queueMicrotask(() => {
                applyingRef.current = false;
              });
            }
            setBusy("success", "Result added");
            setTimeout(() => setBusy("idle", ""), 1600);
            solved = true;
            break;
          }
          if (!solved) {
            logger.info({ problemId }, "Math Notes miss; stay quiet");
            setBusy("idle", "");
          }
          return solved;
        }

        logger.info(
          {
            problemId,
            strokeCount: cluster.strokes.length,
            pointCounts: cluster.strokes.map((stroke) => stroke.points.length),
            bbox: cluster.bounds,
          },
          "POST /api/recognize last cluster",
        );
        const latex = await recognizeStrokes(cluster.strokes, abort.signal);
        if (abort.signal.aborted) {
          setBusy("idle", "");
          return false;
        }
        ranClusterKeysRef.current.add(clusterKey);

        const nextProblems = recordInkOnProblem(
          problemsRef.current,
          problemId,
          cluster.bounds,
          latex,
        );
        problemsRef.current = nextProblems;
        setProblems(nextProblems);
        setClusterBounds(cluster.bounds);

        const bbox = cluster.bounds;
        if (!isUsableLatex(latex)) {
          logger.info({ problemId, latex }, "Mathpix miss; stay quiet");
          setBusy("idle", "");
          return false;
        }

        const response = await fetch(`/api/tutor?mode=${mode}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          signal: abort.signal,
          body: JSON.stringify({ problemId, latex, bbox, mode }),
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
        try {
          const pinned = decision.marks.map((mark) => pinSocraticNote(mark, cluster.bounds));
          const ids = applyTutorMarks(editor, pinned, "socratic");
          fadeInTutorShapes(editor, ids);
          setHasMarks(ids.length > 0);
          setHasPending(ids.length > 0);
        } finally {
          queueMicrotask(() => {
            applyingRef.current = false;
          });
        }

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
      { source: "all", scope: "document" },
    );

    return () => {
      dispose();
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [editor, schedule, setBusy]);

  // Pen-up backup: if store.listen missed the stroke, still POST the last cluster.
  useEffect(() => {
    if (!editor) return;
    const root = editor.getContainer();

    const queueLastCluster = () => {
      applyingRef.current = false;
      window.setTimeout(() => {
        if (!autoRef.current || processingRef.current) return;
        if (pendingIdsRef.current.size === 0) {
          for (const id of lastStudentClusterSeeds(editor)) {
            pendingIdsRef.current.add(id);
          }
        }
        if (pendingIdsRef.current.size === 0) return;
        schedule();
      }, 80);
    };

    const onPointerUp = (event: PointerEvent) => {
      if (event.button !== 0) return;
      const target = event.target;
      if (!(target instanceof Element)) return;
      if (!target.closest(".tl-canvas")) return;
      queueLastCluster();
    };

    root.addEventListener("pointerup", onPointerUp);
    return () => root.removeEventListener("pointerup", onPointerUp);
  }, [editor, schedule]);

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
