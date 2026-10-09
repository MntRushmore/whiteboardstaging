/**
 * The board's learning bus: `LiveLoop` emits what happened (`LearningSignal`), the attempt tracker
 * (loaded later with a dynamic import) listens, and publishes each attempt's latest state for the
 * board's UI (Now you try). It also holds the student's learner hint, which the board loads once
 * and `LiveLoop` sends with each check.
 *
 * Part of the board's first load: no imports but types. Signals emitted before anything listens are
 * buffered (at most MAX_BUFFER, oldest dropped) and delivered to the first signal listener.
 */
import type { AttemptRecord, LearningSignal } from "./contracts";
import type { LearnerHint } from "./hint";

const MAX_BUFFER = 500;
/** attempts remembered for `attempts()` (a board session rarely has more than a few dozen) */
const MAX_ATTEMPTS = 200;

type Listener<T> = (value: T) => void;

export class LearningBus {
  private buffer: LearningSignal[] = [];
  private readonly signalListeners = new Set<Listener<LearningSignal>>();
  private readonly attemptListeners = new Set<Listener<AttemptRecord>>();
  private readonly learnerListeners = new Set<Listener<LearnerHint | undefined>>();
  private hint: LearnerHint | undefined;
  private readonly latest = new Map<string, AttemptRecord>();

  emit(signal: LearningSignal): void {
    if (this.signalListeners.size === 0) {
      this.buffer.push(signal);
      if (this.buffer.length > MAX_BUFFER) this.buffer.splice(0, this.buffer.length - MAX_BUFFER);
      return;
    }
    for (const fn of [...this.signalListeners]) safely(fn, signal);
  }

  /** Listen to signals; the first listener also gets everything buffered so far, in order. */
  onSignal(fn: Listener<LearningSignal>): () => void {
    this.signalListeners.add(fn);
    if (this.buffer.length > 0) {
      const pending = this.buffer;
      this.buffer = [];
      for (const s of pending) safely(fn, s);
    }
    return () => {
      this.signalListeners.delete(fn);
    };
  }

  /** The tracker publishes an attempt each time it changes. */
  publishAttempt(record: AttemptRecord): void {
    this.latest.delete(record.id);
    this.latest.set(record.id, record);
    if (this.latest.size > MAX_ATTEMPTS) this.latest.delete(this.latest.keys().next().value as string);
    for (const fn of [...this.attemptListeners]) safely(fn, record);
  }

  /** Each attempt published since the board opened, as it is now, oldest change first (the replay's "fixed 2 mistakes"). */
  attempts(): AttemptRecord[] {
    return [...this.latest.values()];
  }

  onAttempt(fn: Listener<AttemptRecord>): () => void {
    this.attemptListeners.add(fn);
    return () => {
      this.attemptListeners.delete(fn);
    };
  }

  setLearner(hint: LearnerHint | undefined): void {
    this.hint = hint;
    for (const fn of [...this.learnerListeners]) safely(fn, hint);
  }

  /** Called each time the learner hint is set (the Ask panel's "Practice my weak spots" chip). */
  onLearner(fn: Listener<LearnerHint | undefined>): () => void {
    this.learnerListeners.add(fn);
    return () => {
      this.learnerListeners.delete(fn);
    };
  }

  /** The student's learner hint, once loaded; undefined before (or for a student with no record). */
  learner(): LearnerHint | undefined {
    return this.hint;
  }

  /** Forget everything (the board unmounted, or a test). Listeners stay subscribed. */
  reset(): void {
    this.buffer = [];
    this.hint = undefined;
    this.latest.clear();
  }
}

function safely<T>(fn: Listener<T>, value: T): void {
  try {
    fn(value);
  } catch {
    // a listener's failure never reaches the board's own code
  }
}

export const learningBus = new LearningBus();
