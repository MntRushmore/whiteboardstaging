"use client";

import type { ProblemRecord } from "@/lib/tutor/types";

export function ProblemPrompt({ problem }: { problem: ProblemRecord | undefined }) {
  if (!problem) return null;
  return (
    <div className="problem-prompt" aria-label={`Problem ${problem.id}`}>
      <span className="problem-prompt-subject">{problem.subject}</span>
      {problem.title}
    </div>
  );
}
