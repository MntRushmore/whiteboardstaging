"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { Editor, TLShapeId } from "tldraw";
import { toast } from "sonner";
import { logger } from "@/lib/logger";
import { applyTutorMarks, clearTutorMarks, fadeInTutorShapes } from "@/lib/tutor/applyMarks";
import {
  allChangesAreTutorLayer,
  clusterFromSeeds,
  collectAllStudentText,
  collectStudentInk,
  cropCluster,
  studentInkIdsFromDiff,
} from "@/lib/tutor/cluster";
import {
  CONFIDENCE_THRESHOLD,
  TUTOR_DEBOUNCE_MS,
  assistanceToTutorMode,
  type AssistanceMode,
  type ClusterBounds,
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

  const applyingRef = useRef(false);
  const processingRef = useRef(false);
  const abortRef = useRef<AbortController | null>(null);
  const pendingIdsRef = useRef<Set<TLShapeId>>(new Set());
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const modeRef = useRef(assistanceMode);
  const autoRef = useRef(autoEnabled);
  const lastResultRef = useRef<TutorResponse | null>(null);
  const onStatusRef = useRef(onStatus);

  modeRef.current = assistanceMode;
  autoRef.current = autoEnabled;
  lastResultRef.current = lastResult;
  onStatusRef.current = onStatus;

  const setBusy = useCallback((status: TutorEngineStatus, message: string) => {
    onStatusRef.current?.(status, message);
  }, []);

  const clearMarks = useCallback(() => {
    if (!editor) return;
    applyingRef.current = true;
    try {
      clearTutorMarks(editor);
      setHasMarks(false);
    } finally {
      queueMicrotask(() => {
        applyingRef.current = false;
      });
    }
  }, [editor]);

  const runCluster = useCallback(
    async (options?: {
      seedIds?: TLShapeId[];
      modeOverride?: AssistanceMode;
      instructions?: string;
      force?: boolean;
    }): Promise<boolean> => {
      if (!editor || processingRef.current) return false;

      const uiMode = options?.modeOverride ?? modeRef.current;
      const mode = assistanceToTutorMode(uiMode);
      if (!mode) return false;

      const seedIds =
        options?.seedIds && options.seedIds.length > 0
          ? options.seedIds
          : collectStudentInk(editor).map((s) => s.id);

      const cluster = clusterFromSeeds(editor, seedIds);
      if (!cluster) return false;

      const drawOrText = cluster.shapeIds
        .map((id) => editor.getShape(id))
        .filter(Boolean);
      const hasDraw = drawOrText.some(
        (s) => s!.type === "draw" || s!.type === "highlight",
      );
      const hasText = Boolean(cluster.nearbyText.trim());
      if (!hasDraw && !hasText) return false;

      processingRef.current = true;
      abortRef.current?.abort();
      const abort = new AbortController();
      abortRef.current = abort;

      try {
        setBusy("generating", "Reading your work...");
        const crop = await cropCluster(editor, cluster.shapeIds, cluster.bounds);
        if (!crop || abort.signal.aborted) {
          setBusy("idle", "");
          return false;
        }

        const response = await fetch("/api/tutor", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          signal: abort.signal,
          body: JSON.stringify({
            crop,
            nearbyText: cluster.nearbyText,
            strokes: cluster.strokes,
            mode,
            pageId: editor.getCurrentPageId(),
            clusterBounds: cluster.bounds,
            instructions: options?.instructions,
          }),
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
            throw new Error(msg);
          }
          throw new Error(errBody?.error || "Tutor request failed");
        }

        const result = (await response.json()) as TutorResponse;
        lastResultRef.current = result;
        setLastResult(result);
        setClusterBounds(cluster.bounds);

        if (result.confidence < CONFIDENCE_THRESHOLD) {
          logger.info(
            { confidence: result.confidence, latex: result.latex },
            "Tutor confidence too low; leaving ink untouched",
          );
          setBusy("idle", "");
          return false;
        }

        applyingRef.current = true;
        const ids = applyTutorMarks(editor, result.marks);
        fadeInTutorShapes(editor, ids);
        setHasMarks(ids.length > 0);
        queueMicrotask(() => {
          applyingRef.current = false;
        });

        setBusy("success", successMessage(uiMode));
        setTimeout(() => setBusy("idle", ""), 1600);
        return true;
      } catch (error) {
        if (abort.signal.aborted) {
          setBusy("idle", "");
          return false;
        }
        logger.error({ error }, "Tutor engine error");
        setBusy(
          "error",
          error instanceof Error ? error.message : "Tutor failed",
        );
        setTimeout(() => setBusy("idle", ""), 3000);
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
        if (!autoRef.current) return;
        if (assistanceToTutorMode(modeRef.current) == null) return;
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

  const getWorkspaceContext = useCallback(() => {
    const latex = lastResultRef.current?.latex ?? "";
    const text = editor ? collectAllStudentText(editor) : "";
    return { latex, text };
  }, [editor]);

  return {
    lastResult,
    clusterBounds,
    hasMarks,
    clearMarks,
    runNow: runCluster,
    getWorkspaceContext,
  };
}

function successMessage(mode: AssistanceMode): string {
  switch (mode) {
    case "feedback":
      return "Feedback added";
    case "suggest":
      return "Question added";
    case "answer":
      return "Steps added";
    default:
      return "";
  }
}
