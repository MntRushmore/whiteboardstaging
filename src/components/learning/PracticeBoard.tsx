"use client";

import { useEditor, type Editor } from "tldraw";
import { toast } from "sonner";
import type { AssistanceMode } from "@/hooks/useAssistanceMode";
import { skillDef } from "@/lib/learning/contracts";
import type { LiveController } from "@/lib/live/contracts";
import { clientMetric } from "@/lib/logger";
import { usePracticeBoard, type BoardPracticeDeps } from "./usePracticeBoard";

export interface PracticeBoardProps {
  boardId: string;
  controller: LiveController;
  /** the dial: practice starts in Feedback (a tick or a ring on each line), as the tour does */
  onModeChange: (mode: AssistanceMode) => void;
}

/**
 * A topic's worked example: the first candidate the board's own engine works out on the device
 * (`topicExample.ts`), with the engine the board already has. Null on any failure: the problems
 * are written without an example.
 */
export async function pickLocalExampleOnBoard(candidates: readonly string[][]): Promise<string[] | null> {
  try {
    const [{ getEngine }, { pickLocalExample }] = await Promise.all([import("@/lib/live/engine"), import("@/lib/learning/topicExample")]);
    return pickLocalExample(await getEngine(), candidates);
  } catch {
    return null;
  }
}

/** The current screen named after its topic, out of the undo history (a name is never worth the board). */
export function nameScreen(editor: Pick<Editor, "getCurrentPage" | "updatePage" | "run">, name: string | null): void {
  if (!name) return;
  try {
    const page = editor.getCurrentPage();
    if (page.name !== name) editor.run(() => editor.updatePage({ id: page.id, name }), { history: "ignore" });
  } catch {
    // nothing to do
  }
}

/** What a practice or topic run needs of the board: the toasts, the dial and pen, the screens' names, the example's engine. */
export function practiceDeps(editor: Editor, onModeChange: (mode: AssistanceMode) => void): BoardPracticeDeps {
  return {
    skillName: (skill) => skillDef(skill)?.name ?? null,
    toast: (text) => toast(text),
    prepare: () => {
      onModeChange("feedback");
      editor.setCurrentTool("draw");
    },
    nameScreen: (skill) => nameScreen(editor, skillDef(skill)?.name ?? null),
    pickExample: pickLocalExampleOnBoard,
    metric: clientMetric,
  };
}

/**
 * A practice board's start (`usePracticeBoard`): loaded with a dynamic import, only on a board with
 * a practice marker (`hasPracticeMarker`, read synchronously by the board page). Nothing to show:
 * the tutor's hand writing the problems, and a toast naming the skill, say it all. The screen they
 * start on is named after the skill.
 */
export default function PracticeBoard({ boardId, controller, onModeChange }: PracticeBoardProps) {
  const editor = useEditor();
  usePracticeBoard(boardId, controller, practiceDeps(editor, onModeChange));
  return null;
}
