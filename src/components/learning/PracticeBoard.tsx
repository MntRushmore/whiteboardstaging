"use client";

import { useEditor } from "tldraw";
import { toast } from "sonner";
import type { AssistanceMode } from "@/hooks/useAssistanceMode";
import { skillDef } from "@/lib/learning/contracts";
import type { LiveController } from "@/lib/live/contracts";
import { clientMetric } from "@/lib/logger";
import { usePracticeBoard } from "./usePracticeBoard";

export interface PracticeBoardProps {
  boardId: string;
  controller: LiveController;
  /** the dial: practice starts in Feedback (a tick or a ring on each line), as the tour does */
  onModeChange: (mode: AssistanceMode) => void;
}

/**
 * A practice board's start (`usePracticeBoard`): loaded with a dynamic import, only on a board with
 * a practice marker (`hasPracticeMarker`, read synchronously by the board page). Nothing to show:
 * the tutor's hand writing the problems, and a toast naming the skill, say it all.
 */
export default function PracticeBoard({ boardId, controller, onModeChange }: PracticeBoardProps) {
  const editor = useEditor();
  usePracticeBoard(boardId, controller, {
    skillName: (skill) => skillDef(skill)?.name ?? null,
    toast: (text) => toast(text),
    prepare: () => {
      onModeChange("feedback");
      editor.setCurrentTool("draw");
    },
    metric: clientMetric,
  });
  return null;
}
