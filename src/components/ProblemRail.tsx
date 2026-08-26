"use client";

import { PROBLEM_COUNT, type ProblemRecord } from "@/lib/tutor/types";

export function ProblemRail({
  problems,
  activeProblemId,
  onSelect,
}: {
  problems: ProblemRecord[];
  activeProblemId: number;
  onSelect: (id: number) => void;
}) {
  return (
    <div
      className="problem-rail"
      role="tablist"
      aria-label="Problems 1 to 12"
      style={{
        position: "absolute",
        top: "64px",
        left: "50%",
        transform: "translateX(-50%)",
        zIndex: 1000,
        display: "flex",
        gap: "4px",
        padding: "4px",
        pointerEvents: "auto",
      }}
    >
      {Array.from({ length: PROBLEM_COUNT }, (_, i) => {
        const id = i + 1;
        const problem = problems[i];
        const unlocked = Boolean(problem?.unlocked);
        const finished = Boolean(problem?.finished);
        const active = id === activeProblemId;
        return (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={active}
            aria-disabled={!unlocked}
            title={
              unlocked
                ? finished
                  ? `Problem ${id} (done)`
                  : `Problem ${id}`
                : `Problem ${id} unlocks when you write`
            }
            onClick={() => {
              if (unlocked) onSelect(id);
            }}
            className={`problem-rail-item${active ? " is-active" : ""}${
              unlocked ? " is-unlocked" : ""
            }${finished ? " is-finished" : ""}`}
          >
            <span>{id}</span>
            {finished && <span className="problem-rail-check" aria-hidden>✓</span>}
          </button>
        );
      })}
    </div>
  );
}
