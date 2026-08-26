"use client";

import { useState, type PointerEvent } from "react";
import { DEMO_PROBLEMS } from "@/lib/tutor/problems";

function ignoreCanvas(event: PointerEvent) {
  event.stopPropagation();
}

/** Optional peek at Simon's 12. Never printed on the paper. */
export function TryThese() {
  const [open, setOpen] = useState(false);

  return (
    <div
      className="try-these"
      onPointerDown={ignoreCanvas}
      onPointerUp={ignoreCanvas}
    >
      {open && (
        <div className="try-these-list" role="list" aria-label="Sample problems">
          {DEMO_PROBLEMS.map((problem) => (
            <p key={problem.id} className="try-these-item" role="listitem">
              <span className="try-these-num">{problem.id}</span>
              {problem.title}
            </p>
          ))}
        </div>
      )}
      <button
        type="button"
        className={`try-these-toggle${open ? " is-open" : ""}`}
        aria-expanded={open}
        onPointerDown={ignoreCanvas}
        onClick={() => setOpen((value) => !value)}
      >
        try these
      </button>
    </div>
  );
}
