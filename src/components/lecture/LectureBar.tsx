"use client";

import { Suspense, lazy } from "react";
import type { LectureHandle } from "./useLecture";

/**
 * The panel (`LectureBarPanel`), loaded the first time a lecture starts: every board opens with the
 * Lecture button, few with a lecture, so the panel's code stays out of the board's first load
 * (docs/BUNDLE.md). Off, nothing is rendered or fetched.
 */
const LectureBarPanel = lazy(() => import("./LectureBarPanel").then((m) => ({ default: m.LectureBarPanel })));

export function LectureBar({ lecture }: { lecture: LectureHandle }) {
  if (lecture.status === "off") return null;
  return (
    <Suspense fallback={null}>
      <LectureBarPanel lecture={lecture} />
    </Suspense>
  );
}
