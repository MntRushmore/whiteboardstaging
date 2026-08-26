"use client";

import { useState } from "react";
import type { Editor } from "tldraw";
import { MarkActions } from "@/components/MarkActions";
import { ModeWords } from "@/components/ModeWords";
import { ProblemRail } from "@/components/ProblemRail";
import { TryThese } from "@/components/TryThese";
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
      <TryThese />
    </div>
  );
}
