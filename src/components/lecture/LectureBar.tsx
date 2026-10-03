"use client";

import { Suspense, lazy } from "react";
import { PORTRAIT_BREAKPOINT, useBreakpoint } from "tldraw";
import type { LectureHandle } from "./useLecture";

/**
 * The panel (`LectureBarPanel`), loaded the first time a lecture starts: every board opens with the
 * Lecture button, few with a lecture, so the panel's code stays out of the board's first load
 * (docs/BUNDLE.md). Off, nothing is rendered or fetched.
 */
const LectureBarPanel = lazy(() => import("./LectureBarPanel").then((m) => ({ default: m.LectureBarPanel })));

export function LectureBar({ lecture }: { lecture: LectureHandle }) {
  // Below tldraw's TABLET breakpoint (an upright iPad, a phone, a board beside the Ask panel) its
  // toolbar has a second row of undo / redo / delete over the tools: the panel sits above both,
  // not over the student's undo for the whole lecture.
  const raised = useBreakpoint() < PORTRAIT_BREAKPOINT.TABLET;
  if (lecture.status === "off") return null;
  return (
    <Suspense fallback={null}>
      <LectureBarPanel lecture={lecture} raised={raised} />
    </Suspense>
  );
}
