"use client";

import { useState } from "react";
import type { Editor } from "tldraw";
import { MarkActions } from "@/components/MarkActions";
import { ModeWords } from "@/components/ModeWords";
import { ProblemPrompt } from "@/components/ProblemPrompt";
import { ProblemRail } from "@/components/ProblemRail";
import { useTutorEngine } from "@/hooks/useTutorEngine";
import { DEFAULT_ASSISTANCE_MODE } from "@/lib/tutor/types";

/** Lives outside `<Tldraw>` so rail/mode taps cannot become canvas ink. */
export function TeacherChrome({ editor }: { editor: Editor }) {
  const [assistanceMode, setAssistanceMode] = useState(DEFAULT_ASSISTANCE_MODE);
  const tutor = useTutorEngine({
    editor,
    assistanceMode,
    autoEnabled: true,
  });

  return (
    <div className="teacher-chrome" data-testid="teacher-chrome">
      <ProblemRail
        problems={tutor.problems}
        activeProblemId={tutor.activeProblemId}
        onSelect={tutor.selectProblem}
      />
      <ProblemPrompt problem={tutor.problems[tutor.activeProblemId - 1]} />
      <MarkActions
        editor={editor}
        problemId={tutor.activeProblemId}
        onAccept={tutor.acceptMarks}
        onReject={tutor.rejectMarks}
      />
      <ModeWords
        value={assistanceMode}
        onChange={(mode) => setAssistanceMode(mode)}
      />
    </div>
  );
}
