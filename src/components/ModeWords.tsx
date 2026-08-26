"use client";

import type { AssistanceMode } from "@/lib/tutor/types";

const MODES: { value: Exclude<AssistanceMode, "off">; label: string }[] = [
  { value: "suggest", label: "Socratic" },
  { value: "answer", label: "Solve" },
  { value: "feedback", label: "Feedback" },
];

export function ModeWords({
  value,
  onChange,
}: {
  value: AssistanceMode;
  onChange: (mode: Exclude<AssistanceMode, "off">) => void;
}) {
  const active = value === "off" ? "suggest" : value;

  return (
    <div className="mode-words" role="group" aria-label="Tutor mode">
      {MODES.map((mode) => (
        <button
          key={mode.value}
          type="button"
          className={`mode-words-item${active === mode.value ? " is-active" : ""}`}
          aria-pressed={active === mode.value}
          onClick={() => onChange(mode.value)}
        >
          {mode.label}
        </button>
      ))}
    </div>
  );
}
