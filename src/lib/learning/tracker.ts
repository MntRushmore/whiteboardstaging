/**
 * The attempt tracker (owner: agent "board"): turns the board's learning signals (`LearningSignal`,
 * emitted by `LiveLoop` through `learningBus`) into attempts — one `AttemptRecord` per problem the
 * student works on a screen — keeps each one's latest state, publishes it as it changes and saves
 * what changed when asked (`flush`).
 *
 * A pure state machine over the signals: time is the signals' own (`at`), or `deps.now` for what the
 * tracker does on its own (`tick`, a mistake classified); ids are `deps.newId`; nothing here sets a
 * timer. The board's runtime (`boardLearning.ts`) closes idle attempts (`tick`) and decides when to
 * save (`flush`, through its `SaveScheduler`).
 *
 * The rules:
 *  - An attempt starts on `problem` (the chat wrote one), on `tutor_solved` of a problem it does not
 *    know (the tutor solved or taught it), or on the first `line` of a problem it does not know: then
 *    the problem is the student's own (origin `student`, its LaTeX the head line the signal carries)
 *    — or, for one of the chat's problems written before this session (`#cell:` key), `tutor_problem`.
 *    A `problem` arriving after its first `line` still says where the problem came from.
 *  - Its skill is `classifyProblem(problemLatex, deps.course)`, again whenever a student's head line
 *    is read differently.
 *  - Counts are per distinct line id (`AttemptCounts`): a line counts once however often it is read,
 *    is ringed once however often it is ringed, and is right when its latest mark is a tick.
 *  - A ringed line with the line above it and no model mistake for its read is classified locally
 *    (`classifyMistake`, async, guarded); a model mistake for the same read wins over a local one.
 *    A line counts each kind of mistake once, however often it is read again with it.
 *  - Active time is the gaps between events, each capped at `maxGapMs` — and never earlier than the
 *    board's previous event: time spent on another problem (or on the tutor writing a problem set)
 *    is not this one's. A `problem` signal starts the clock without adding to it.
 *  - The outcome is `outcomeOf`. The tutor finishing (`tutor_solved`) counts only before the student
 *    reached the answer. Once answered (by either), the outcome stays: later lines and help change
 *    the counts, not how the problem went. `finishedAt` is set when the outcome leaves `in_progress`.
 *  - An attempt closes when its screen is left (`screen`), the board closes (`closed`) or after
 *    `idleCloseMs` with no event (`tick`); a closed one that gets a new signal opens again.
 *  - An attempt is recorded (published, saved) only once it holds something: a line the tutor judged
 *    (ticked, ringed, the answer), any tutor help, the tutor finishing it, or — for a problem the
 *    tutor gave — any line at all. A problem written and never touched is never recorded, nor a column
 *    of labels and scratch numbers the tutor could not judge.
 *  - Help about a problem the tracker does not know yet (a step or an ask before its first line) is
 *    kept briefly and counted when the attempt starts.
 */
import type { LineKind, LiveEngine } from "@/lib/live/contracts";
import type { CourseId } from "@/lib/onboarding/courseIds";
import {
  LEARNING_LIMITS,
  outcomeOf,
  type AttemptCounts,
  type AttemptOrigin,
  type AttemptRecord,
  type LearningSignal,
  type LineMark,
  type Outcome,
} from "./contracts";
import type { MistakeKind } from "./hint";
import { classifyMistake } from "./mistakes";
import { classifyProblem } from "./skills";

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

/**
 * How `LiveLoop` names problems (`LearningSignal.problemKey`): `<pageId>#cell:<cell key>` for one of
 * the chat's problems, `<pageId>#ink:<line id>` for the student's own, `<pageId>#teach:<seed>` for a
 * worked solution the chat taught. The tracker reads only the kind.
 */
export const PROBLEM_KEY_KINDS = { cell: "#cell:", ink: "#ink:", teach: "#teach:" } as const;

/** Where a problem known only by its key came from (no `problem` signal for it this session). */
export function originOfKey(problemKey: string): AttemptOrigin {
  if (problemKey.includes(PROBLEM_KEY_KINDS.cell)) return "tutor_problem";
  if (problemKey.includes(PROBLEM_KEY_KINDS.teach)) return "teach";
  return "student";
}

export const TRACKER_LIMITS = {
  /** attempts kept in memory; past it, the oldest closed and saved ones are forgotten */
  attempts: 300,
  /** problems whose help is kept before their attempt starts, and how much of it */
  orphanKeys: 50,
  orphanHelps: 10,
} as const;

type HelpKind = Extract<LearningSignal, { type: "help" }>["help"];

interface LineState {
  latex: string;
  kind: LineKind;
  mark: LineMark;
  solved: boolean;
  /** ever ringed */
  ringed: boolean;
  /** ever ticked, ringed or the answer: the tutor judged it */
  judged: boolean;
}

interface LineMistake {
  kind: MistakeKind;
  source: "model" | "local";
}

/** The most reads of one line whose mistakes are kept. */
const MISTAKE_READS = 10;

interface Attempt {
  key: string;
  record: AttemptRecord;
  pageId: string;
  lines: Map<string, LineState>;
  /** each line's mistakes, by the read they were about (a line read again is classified again) */
  mistakes: Map<string, Map<string, LineMistake>>;
  help: Record<HelpKind, number>;
  active: number;
  /** its last event's time; -Infinity before its first (an attempt started by a line) */
  lastAt: number;
  closed: boolean;
  solvedByStudent: boolean;
  tutorFinished: boolean;
  /** how it went, once answered (by the student or the tutor): it no longer changes */
  answered: Outcome | null;
  /** the problem was given (`problem`, `tutor_solved`), not taken from a line of it */
  given: boolean;
  recordable: boolean;
  /** changed since it was last saved */
  dirty: boolean;
  /** being saved now */
  saving: boolean;
  /** what it said last (`commit`), updatedAt aside */
  said: string;
}

function iso(ms: number): string {
  return new Date(Number.isFinite(ms) ? ms : 0).toISOString();
}

function cap(n: number): number {
  return Math.max(0, Math.min(LEARNING_LIMITS.maxCount, Math.round(n)));
}

function copy(record: AttemptRecord): AttemptRecord {
  return { ...record, mistakes: { ...record.mistakes } };
}

export class AttemptTracker {
  private readonly byKey = new Map<string, Attempt>();
  /** help about problems not known yet, by key (`orphan`) */
  private readonly orphans = new Map<string, Array<{ help: HelpKind; at: number }>>();
  /** the board's last event, of any attempt: time before it was not the next event's problem's */
  private lastAt = -Infinity;
  /** local classifications in flight, by line and read */
  private readonly classifying = new Set<string>();
  /** the save in flight, which the next `flush` waits for */
  private saving: Promise<void> = Promise.resolve();

  constructor(private readonly deps: TrackerDeps) {}

  /** One signal from the board. Never throws: a signal it cannot use is dropped. */
  handle(signal: LearningSignal): void {
    try {
      switch (signal.type) {
        case "problem":
          return this.onProblem(signal);
        case "line":
          return this.onLine(signal);
        case "mistake":
          return this.onMistake(signal);
        case "help":
          return this.onHelp(signal);
        case "tutor_solved":
          return this.onTutorSolved(signal);
        case "screen":
          return this.onScreen(signal);
        case "closed":
          return this.onClosed(signal);
      }
    } catch (err) {
      console.warn("[learning] a signal could not be used", err);
    }
  }

  /** Closes the attempts with no event for `idleCloseMs` (the board's runtime calls it every minute). */
  tick(now: number = this.deps.now()): void {
    try {
      for (const a of [...this.byKey.values()]) {
        if (!a.closed && now - a.lastAt >= LEARNING_LIMITS.idleCloseMs) this.close(a, now);
      }
    } catch (err) {
      console.warn("[learning] tick failed", err);
    }
  }

  /** The attempt id for a problem on the board, if it has one. */
  attemptIdFor(problemKey: string): string | undefined {
    return this.byKey.get(problemKey)?.record.id;
  }

  /** Every recorded attempt's latest state (the learner hint is computed with them). */
  records(): AttemptRecord[] {
    return [...this.byKey.values()].filter((a) => a.recordable).map((a) => copy(a.record));
  }

  /** The recorded attempts not saved yet (changed, or being saved): what the device keeps until they are. */
  pending(): AttemptRecord[] {
    return [...this.byKey.values()].filter((a) => a.recordable && (a.dirty || a.saving)).map((a) => copy(a.record));
  }

  /**
   * Save what has changed now (pagehide, unmount, the save scheduler): one batch of every attempt
   * changed since its last save, after any save in flight. Rejects when the save fails (the
   * scheduler reads the store's error code); what failed is saved with the next batch.
   */
  flush(): Promise<void> {
    const run = this.saving.then(() => this.saveChanged());
    this.saving = run.catch(() => undefined);
    return run;
  }

  // ---------------------------------------------------------------- signals

  private onProblem(s: Extract<LearningSignal, { type: "problem" }>): void {
    const known = this.byKey.get(s.problemKey);
    if (known) {
      // its first line came first (a problem's signal arrives once its ink is on the page)
      if (known.given) return;
      known.given = true;
      known.record.origin = s.origin;
      known.record.parentId = s.parentId ?? null;
      this.setProblem(known, s.problemLatex);
      this.commit(known, s.at);
      return;
    }
    const a = this.start(s.problemKey, { boardId: s.boardId, pageId: s.pageId, problemLatex: s.problemLatex, origin: s.origin, parentId: s.parentId ?? null, at: s.at, given: true });
    this.lastAt = Math.max(this.lastAt, s.at);
    this.adoptOrphans(a);
    this.commit(a, s.at);
  }

  private onLine(s: Extract<LearningSignal, { type: "line" }>): void {
    let a = this.byKey.get(s.problemKey);
    const started = !a;
    a ??= this.start(s.problemKey, { boardId: s.boardId, pageId: s.pageId, problemLatex: s.problemLatex, origin: originOfKey(s.problemKey), parentId: null, at: s.at, given: false });
    const prev = a.lines.get(s.lineId);
    // the same again: nothing happened (nor does it open a closed attempt)
    if (prev && prev.latex === s.latex && prev.kind === s.kind && prev.mark === s.mark && prev.solved === s.solved) return;
    a.closed = false;
    a.pageId = s.pageId;
    this.spend(a, s.at);
    // the student's own problem is its head line, as read now
    if (!a.given && s.problemLatex.length > 0) this.setProblem(a, s.problemLatex);
    const ringed = Boolean(prev?.ringed) || s.mark === "circle";
    a.lines.set(s.lineId, {
      latex: s.latex,
      kind: s.kind,
      mark: s.mark,
      solved: s.solved,
      ringed,
      judged: Boolean(prev?.judged) || s.mark === "check" || s.mark === "circle" || s.solved,
    });
    if (s.solved && s.mark === "check") a.solvedByStudent = true;
    if (s.mark === "circle" && s.previousLatex) this.classify(a, s.lineId, s.previousLatex, s.latex);
    if (started) this.adoptOrphans(a);
    this.commit(a, s.at);
  }

  private onMistake(s: Extract<LearningSignal, { type: "mistake" }>): void {
    const a = this.byKey.get(s.problemKey);
    if (!a) return;
    const latex = a.lines.get(s.lineId)?.latex ?? "";
    const prev = this.mistakeOf(a, s.lineId, latex);
    if (prev && (prev.kind === s.kind || (prev.source === "model" && s.source === "local"))) return;
    this.setMistake(a, s.lineId, latex, { kind: s.kind, source: s.source });
    a.closed = false;
    this.spend(a, s.at);
    this.commit(a, s.at);
  }

  private onHelp(s: Extract<LearningSignal, { type: "help" }>): void {
    const a = this.byKey.get(s.problemKey);
    if (!a) {
      this.orphan(s.problemKey, s.help, s.at);
      return;
    }
    a.closed = false;
    this.spend(a, s.at);
    a.help[s.help]++;
    this.commit(a, s.at);
  }

  private onTutorSolved(s: Extract<LearningSignal, { type: "tutor_solved" }>): void {
    let a = this.byKey.get(s.problemKey);
    if (!a) {
      a = this.start(s.problemKey, { boardId: s.boardId, pageId: s.pageId, problemLatex: s.problemLatex, origin: s.origin ?? originOfKey(s.problemKey), parentId: null, at: s.at, given: true });
      this.lastAt = Math.max(this.lastAt, s.at);
      this.adoptOrphans(a);
    } else {
      a.closed = false;
      this.spend(a, s.at);
    }
    // only before the student got there: a problem they solved stays theirs
    if (!a.solvedByStudent) a.tutorFinished = true;
    this.commit(a, s.at);
  }

  private onScreen(s: Extract<LearningSignal, { type: "screen" }>): void {
    this.lastAt = Math.max(this.lastAt, s.at);
    for (const a of [...this.byKey.values()]) {
      if (!a.closed && a.pageId !== s.pageId && (a.record.boardId === s.boardId || a.record.boardId === null)) this.close(a, s.at);
    }
  }

  private onClosed(s: Extract<LearningSignal, { type: "closed" }>): void {
    for (const a of [...this.byKey.values()]) {
      if (!a.closed && (a.record.boardId === s.boardId || a.record.boardId === null)) this.close(a, s.at);
    }
  }

  // ---------------------------------------------------------------- attempts

  private start(
    key: string,
    from: { boardId: string; pageId: string; problemLatex: readonly string[]; origin: AttemptOrigin; parentId: string | null; at: number; given: boolean },
  ): Attempt {
    const lines = from.problemLatex.map((l) => l.trim()).filter(Boolean);
    const record: AttemptRecord = {
      id: this.deps.newId(),
      boardId: from.boardId,
      problemLatex: lines.join("; ").slice(0, LEARNING_LIMITS.problemLatex),
      skill: classifyProblem(lines, this.deps.course),
      course: this.deps.course,
      origin: from.origin,
      parentId: from.parentId,
      outcome: "in_progress",
      mistakes: {},
      activeMs: 0,
      linesWritten: 0,
      linesRight: 0,
      linesRinged: 0,
      hints: 0,
      tutorSteps: 0,
      solves: 0,
      asks: 0,
      startedAt: iso(from.at),
      updatedAt: iso(from.at),
      finishedAt: null,
    };
    const a: Attempt = {
      key,
      record,
      pageId: from.pageId,
      lines: new Map(),
      mistakes: new Map(),
      help: { hint: 0, next_step: 0, solve: 0, ask: 0 },
      active: 0,
      // a problem given starts its clock now; a line's attempt counts the time its first line took
      lastAt: from.given ? from.at : -Infinity,
      closed: false,
      solvedByStudent: false,
      tutorFinished: false,
      answered: null,
      given: from.given,
      recordable: false,
      dirty: false,
      saving: false,
      said: "",
    };
    this.byKey.set(key, a);
    this.prune();
    return a;
  }

  private setProblem(a: Attempt, problemLatex: readonly string[]): void {
    const lines = problemLatex.map((l) => l.trim()).filter(Boolean);
    const joined = lines.join("; ").slice(0, LEARNING_LIMITS.problemLatex);
    if (!joined || joined === a.record.problemLatex) return;
    a.record.problemLatex = joined;
    a.record.skill = classifyProblem(lines, this.deps.course);
  }

  /** The time since this attempt's last event (or the board's, when later) goes to it, capped. */
  private spend(a: Attempt, at: number): void {
    const from = Math.max(a.lastAt, this.lastAt);
    if (Number.isFinite(from) && at > from) a.active = Math.min(LEARNING_LIMITS.maxActiveMs, a.active + Math.min(at - from, LEARNING_LIMITS.maxGapMs));
    a.lastAt = Number.isFinite(a.lastAt) ? Math.max(a.lastAt, at) : at;
    this.lastAt = Math.max(this.lastAt, at);
  }

  private close(a: Attempt, at: number): void {
    a.closed = true;
    this.commit(a, at);
    // nothing in it worth a record: nothing to keep either
    if (!a.recordable) this.forget(a);
  }

  private forget(a: Attempt): void {
    if (this.byKey.get(a.key) === a) this.byKey.delete(a.key);
  }

  /** Past `TRACKER_LIMITS.attempts`: the oldest closed attempts with nothing left to save go. */
  private prune(): void {
    if (this.byKey.size <= TRACKER_LIMITS.attempts) return;
    const done = [...this.byKey.values()].filter((a) => a.closed && !a.dirty && !a.saving).sort((x, y) => x.lastAt - y.lastAt);
    for (const a of done) {
      if (this.byKey.size <= TRACKER_LIMITS.attempts) return;
      this.forget(a);
    }
  }

  private counts(a: Attempt): AttemptCounts {
    let right = 0;
    let ringed = 0;
    for (const l of a.lines.values()) {
      if (l.mark === "check") right++;
      if (l.ringed) ringed++;
    }
    return {
      linesWritten: cap(a.lines.size),
      linesRight: cap(right),
      linesRinged: cap(ringed),
      hints: cap(a.help.hint),
      tutorSteps: cap(a.help.next_step),
      solves: cap(a.help.solve),
      asks: cap(a.help.ask),
    };
  }

  /** Worth a record: the tutor judged a line of it, helped, or finished it — or a given problem has a line. */
  private isRecordable(a: Attempt, counts: AttemptCounts): boolean {
    if (a.recordable) return true;
    const helped = counts.hints + counts.tutorSteps + counts.solves > 0;
    const judged = [...a.lines.values()].some((l) => l.judged);
    a.recordable = a.tutorFinished || helped || judged || (a.given && counts.linesWritten > 0);
    return a.recordable;
  }

  /** Its record from its state now; published (and to be saved) when it changed and is worth a record. */
  private commit(a: Attempt, at: number): void {
    const counts = this.counts(a);
    let outcome: Outcome;
    if (a.answered) outcome = a.answered;
    else {
      outcome = outcomeOf(counts, a.solvedByStudent, a.tutorFinished, a.closed);
      if (outcome !== "in_progress" && outcome !== "unfinished") a.answered = outcome;
    }
    // each kind once per line, however often the line was read with it
    const mistakes: Partial<Record<MistakeKind, number>> = {};
    for (const reads of a.mistakes.values()) {
      for (const kind of new Set([...reads.values()].map((m) => m.kind))) mistakes[kind] = cap((mistakes[kind] ?? 0) + 1);
    }
    const r = a.record;
    // when it stopped being in progress — unfinished then answered, it was finished when answered
    if (outcome === "in_progress") r.finishedAt = null;
    else if (outcome !== r.outcome || !r.finishedAt) r.finishedAt = iso(at);
    Object.assign(r, counts, { outcome, mistakes, activeMs: Math.round(Math.min(a.active, LEARNING_LIMITS.maxActiveMs)) });
    const said = JSON.stringify({ ...r, updatedAt: "" });
    const wasRecordable = a.recordable;
    const recordable = this.isRecordable(a, counts);
    if (said === a.said && wasRecordable === recordable) return;
    a.said = said;
    r.updatedAt = iso(Math.max(at, Date.parse(r.startedAt)));
    if (!recordable) return;
    a.dirty = true;
    this.deps.publish(copy(r));
  }

  // ---------------------------------------------------------------- help before its problem

  private orphan(key: string, help: HelpKind, at: number): void {
    const list = this.orphans.get(key) ?? [];
    this.orphans.delete(key);
    list.push({ help, at });
    this.orphans.set(key, list.slice(-TRACKER_LIMITS.orphanHelps));
    while (this.orphans.size > TRACKER_LIMITS.orphanKeys) this.orphans.delete(this.orphans.keys().next().value as string);
  }

  private adoptOrphans(a: Attempt): void {
    const list = this.orphans.get(a.key);
    if (!list) return;
    this.orphans.delete(a.key);
    const started = Date.parse(a.record.startedAt);
    for (const o of list) if (started - o.at <= LEARNING_LIMITS.maxGapMs) a.help[o.help]++;
  }

  // ---------------------------------------------------------------- mistakes

  private mistakeOf(a: Attempt, lineId: string, latex: string): LineMistake | undefined {
    return a.mistakes.get(lineId)?.get(latex);
  }

  private setMistake(a: Attempt, lineId: string, latex: string, mistake: LineMistake): void {
    const reads = a.mistakes.get(lineId) ?? new Map<string, LineMistake>();
    reads.delete(latex);
    reads.set(latex, mistake);
    while (reads.size > MISTAKE_READS) reads.delete(reads.keys().next().value as string);
    a.mistakes.set(lineId, reads);
  }

  /** A ringed line, compared with the line above it by the board's own classifier (async; a model mistake for the same read wins). */
  private classify(a: Attempt, lineId: string, previousLatex: string, latex: string): void {
    const engine = this.deps.engine;
    if (!engine) return;
    if (this.mistakeOf(a, lineId, latex)) return;
    const job = `${a.record.id}\n${lineId}\n${latex}`;
    if (this.classifying.has(job)) return;
    this.classifying.add(job);
    void engine()
      .then((e) => {
        const kind = classifyMistake(e, previousLatex, latex);
        if (!kind || this.byKey.get(a.key) !== a) return;
        // read again meanwhile, or the model named this read's mistake first
        if (a.lines.get(lineId)?.latex !== latex || this.mistakeOf(a, lineId, latex)) return;
        this.setMistake(a, lineId, latex, { kind, source: "local" });
        this.commit(a, this.deps.now());
      })
      .catch(() => undefined)
      .finally(() => this.classifying.delete(job));
  }

  // ---------------------------------------------------------------- saving

  private async saveChanged(): Promise<void> {
    const batch = [...this.byKey.values()].filter((a) => a.recordable && a.dirty);
    if (batch.length === 0) return;
    const records = batch.map((a) => copy(a.record));
    for (const a of batch) {
      a.dirty = false;
      a.saving = true;
    }
    try {
      await this.deps.save(records);
    } catch (err) {
      // saved with the next batch (a change meanwhile marked it again already)
      for (const a of batch) a.dirty = true;
      throw err;
    } finally {
      for (const a of batch) a.saving = false;
      this.prune();
    }
  }
}
