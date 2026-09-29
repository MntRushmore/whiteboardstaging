"use client";

import { Mic } from "lucide-react";
import { Button } from "@/components/ui/button";
import { LECTURE_BUTTON_COPY as LECTURE_COPY } from "./lectureCopy";
import type { LectureHandle } from "./useLecture";

/**
 * Lecture mode's switch, in the board's top bar next to Ask. Off: turns it on (the consent note the
 * first time on this device). On: turns it off — the transcript is already saved on the screens,
 * so nothing is lost. While listening it wears a small red recording dot, so a glance at the bar
 * says the microphone is live.
 */
export function LectureButton({ lecture }: { lecture: Pick<LectureHandle, "status" | "start" | "stop" | "cancelConsent"> }) {
  const on = lecture.status !== "off";
  const recording = lecture.status === "listening";
  return (
    <Button
      variant={on ? "secondary" : "outline"}
      size="sm"
      className={on ? "shadow-sm" : "bg-white shadow-sm"}
      title={on ? LECTURE_COPY.stopHint : LECTURE_COPY.buttonHint}
      aria-pressed={on}
      data-lecture-status={lecture.status}
      onClick={() => {
        if (!on) lecture.start();
        else if (lecture.status === "consent") lecture.cancelConsent();
        else lecture.stop();
      }}
    >
      {recording ? (
        <span className="relative flex size-4 items-center justify-center" aria-hidden>
          <span className="absolute inline-flex size-2.5 animate-ping rounded-full bg-red-400 opacity-75 motion-reduce:animate-none" />
          <span className="relative inline-flex size-2.5 rounded-full bg-red-500" />
        </span>
      ) : (
        <Mic className="h-4 w-4" />
      )}
      <span className="ml-1.5">{LECTURE_COPY.button}</span>
    </Button>
  );
}
