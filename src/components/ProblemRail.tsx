"use client";

import type { PointerEvent } from "react";
import { PROBLEM_COUNT, type ProblemRecord } from "@/lib/tutor/types";

function ignoreCanvas(event: PointerEvent) {
  event.stopPropagation();
}

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
    <nav
      className="problem-rail"
      data-testid="problem-rail"
      aria-label="Problems 1 to 12"
      onPointerDown={ignoreCanvas}
      onPointerUp={ignoreCanvas}
    >
      {Array.from({ length: PROBLEM_COUNT }, (_, i) => {
        const id = i + 1;
        const finished = Boolean(problems[i]?.finished);
        const active = id === activeProblemId;
        return (
          <button
            key={id}
            type="button"
            data-testid={`problem-rail-${id}`}
            className={`problem-rail-item${active ? " is-current" : ""}`}
            aria-current={active ? "page" : undefined}
            onPointerDown={ignoreCanvas}
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
