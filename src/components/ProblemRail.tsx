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
    <nav className="problem-rail" aria-label="Problems 1 to 12">
      {Array.from({ length: PROBLEM_COUNT }, (_, i) => {
        const id = i + 1;
        const finished = Boolean(problems[i]?.finished);
        const active = id === activeProblemId;
        return (
          <button
            key={id}
            type="button"
            className={`problem-rail-item${active ? " is-current" : ""}`}
            aria-current={active ? "page" : undefined}
            onClick={() => onSelect(id)}
          >
            {id}
            {finished && (
              <svg
                className="problem-rail-check"
                width="10"
                height="10"
                viewBox="0 0 10 10"
                aria-label="Done"
              >
                <path
                  d="M1.5 5.2L3.8 7.5L8.5 2.4"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            )}
          </button>
        );
      })}
    </nav>
  );
}
