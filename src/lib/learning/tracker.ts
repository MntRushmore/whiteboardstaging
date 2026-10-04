/**
 * STUB (owner: agent "board"). Turns the board's learning signals into attempts and saves them.
 * Exports are frozen by the contract; the body is replaced by its owner.
 */
import type { LiveEngine } from "@/lib/live/contracts";
import type { CourseId } from "@/lib/onboarding/courseIds";
import type { AttemptRecord, LearningSignal } from "./contracts";

export interface TrackerDeps {
  now: () => number;
  newId: () => string;
  /** the student's course, for `classifyProblem` and the record */
  course: CourseId | null;
  /** saves a batch (store.saveAttempts in the app); throws on failure */
  save: (records: readonly AttemptRecord[]) => Promise<void>;
  /** each attempt's latest state, as it changes (learningBus.publishAttempt in the app) */
  publish: (record: AttemptRecord) => void;
  /** the maths engine, for the local mistake classifier (already loaded on the board); absent in some tests */
  engine?: () => Promise<LiveEngine>;
}

export class AttemptTracker {
  constructor(private readonly deps: TrackerDeps) {}

  handle(signal: LearningSignal): void {
    void signal;
    void this.deps;
  }

  /** The attempt id for a problem on the board, if it has one. */
  attemptIdFor(problemKey: string): string | undefined {
    void problemKey;
    return undefined;
  }

  /** Save what has changed now (pagehide, unmount). */
  flush(): Promise<void> {
    return Promise.resolve();
  }
}
