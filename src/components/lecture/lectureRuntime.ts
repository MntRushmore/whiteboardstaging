import { requestLecture, requestLectureSketch } from "@/lib/live/lecture/client";
import { createScriptSource, createSpeechSource } from "@/lib/live/lecture/speech";
import { LectureRunner } from "./lectureRunner";
import { browserStorage } from "./lectureView";
import { createScreenWakeLock } from "./wakeLock";

/**
 * Everything a lecture runs on — the session, the speech sources, the director's client — behind
 * one import that `useLecture` makes on the first start, so none of it is in the board's first
 * load (docs/BUNDLE.md).
 */
export function createLectureRunner(boardId: string): LectureRunner {
  return new LectureRunner({
    boardId,
    openSpeech: () => createSpeechSource(),
    openScript: (lines, opts) => createScriptSource(lines, opts),
    request: (req, signal) => requestLecture(req, signal),
    requestSketch: (req, signal) => requestLectureSketch(req, signal),
    storage: browserStorage,
    wakeLock: createScreenWakeLock(),
  });
}
