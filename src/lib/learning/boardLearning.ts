/**
 * The board's learning runtime (owner: agent "board"), loaded with a dynamic import once the board
 * is up, in idle time (`useBoardLearning`): nothing here — the tracker, the store, the skills, the
 * summary — is in the board's first load, which carries only the hook and the bus.
 *
 *   LiveLoop ──signals──► learningBus ──► AttemptTracker ──records──► learningBus.publishAttempt (Now you try)
 *                          (buffered)            │
 *                                                └──changed──► SaveScheduler ──► store.saveAttempts
 *
 * On start it reads the student's course (and display name) from their profile, makes the tracker
 * and listens to the bus, which hands over everything the board said before it was here. It saves
 * what changed about 5 s after a change (no more often than every 15 s while the student keeps
 * working), backs off when a save fails for a reason a retry can fix (`network`, `unknown`) and stops
 * trying for the session when it cannot (`unavailable`, `unauthorized`, `invalid`). It saves at once
 * when the tab is hidden, the page goes away and the board unmounts, and keeps what is not saved yet
 * on the device (`agathon.learning.pending.<userId>`), saved at the next board's start.
 *
 * It also gives the tutor the student's learner hint (`learningBus.setLearner`, sent with each check):
 * loaded once from their record, and again after a few more attempts have finished.
 */
import type { LiveEngine } from "@/lib/live/contracts";
import { isCourseId, type CourseId } from "@/lib/onboarding/courseIds";
import { learningBus, type LearningBus } from "./bus";
import { LEARNING_LIMITS, OUTCOMES, type AttemptRecord, type LearningSignal } from "./contracts";
import type { LearnerHint } from "./hint";
import { loadAttempts, saveAttempts } from "./store";
import { learnerHint, summarize } from "./summary";
import { AttemptTracker } from "./tracker";

export const LEARNING_SAVE = {
  /** a save this long after the last change… */
  debounceMs: 5_000,
  /** …but no change waits longer than this, and saves are at least this far apart while the student works */
  intervalMs: 15_000,
  /** after a save that can be retried failed: the waits before the next tries (the last repeats) */
  backoffMs: [15_000, 30_000, 60_000, 120_000, 300_000],
  /** how often idle attempts are closed (`AttemptTracker.tick`) */
  tickMs: 60_000,
  /** the most unsaved records kept on the device */
  pendingMax: 100,
  /** the learner hint is loaded again after this many more attempts finished… */
  learnerAfter: 3,
  /** …and no sooner than this after the last load */
  learnerEveryMs: 3 * 60_000,
} as const;

// ------------------------------------------------------------------ store errors

/** The store's error code (`LearningStoreError.code`), duck-typed; `unknown` for anything else. */
export function storeErrorCode(err: unknown): string {
  const code = err && typeof err === "object" ? (err as { code?: unknown }).code : undefined;
  return typeof code === "string" && code ? code : "unknown";
}

/** A save that failed this way may work if tried again: a dropped connection, a blip. */
export function retryable(err: unknown): boolean {
  const code = storeErrorCode(err);
  return code === "network" || code === "unknown";
}

// ------------------------------------------------------------------ the save schedule

export interface SchedulerTimers {
  now(): number;
  setTimeout(fn: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
}

export interface SaveSchedulerDeps {
  /** saves everything changed (throws the store's error) */
  flush: () => Promise<void>;
  timers: SchedulerTimers;
  /** a save went through */
  onSaved?: () => void;
  /** a save failed; `halted`: no more tries this session */
  onFailed?: (code: string, halted: boolean) => void;
}

/**
 * When to save. `changed` after each change: a save is due `debounceMs` after the last change, but no
 * later than `intervalMs` after the first unsaved one, and no sooner than `intervalMs` after the last
 * save; after a failure a retry can fix, no sooner than the backoff's next wait. A failure no retry
 * fixes stops it (`halted`). `flushNow` saves at once (the tab hidden, the page going away, unmount).
 */
export class SaveScheduler {
  private timer: unknown = null;
  private firstChange: number | null = null;
  private lastChange = 0;
  private lastSave = -Infinity;
  private retryAt = -Infinity;
  private failures = 0;
  private running: Promise<void> | null = null;
  private stopped = false;
  /** the store said no for good this session (`unavailable`, `unauthorized`, `invalid`) */
  halted: string | null = null;

  constructor(private readonly deps: SaveSchedulerDeps) {}

  changed(): void {
    if (this.stopped || this.halted) return;
    const now = this.deps.timers.now();
    this.lastChange = now;
    this.firstChange ??= now;
    this.schedule();
  }

  /** Saves now, whatever the schedule says (after a save in flight); never rejects. */
  async flushNow(): Promise<void> {
    if (this.halted) return;
    this.clear();
    if (this.running) await this.running.catch(() => undefined);
    if (this.halted) return;
    await this.run(true);
  }

  stop(): void {
    this.stopped = true;
    this.clear();
  }

  /** When the next save is due (ms, the timers' clock), or null with nothing to save. */
  dueAt(): number | null {
    if (this.firstChange === null) return null;
    const settled = Math.min(this.lastChange + LEARNING_SAVE.debounceMs, this.firstChange + LEARNING_SAVE.intervalMs);
    return Math.max(settled, this.lastSave + LEARNING_SAVE.intervalMs, this.retryAt);
  }

  private clear(): void {
    if (this.timer !== null) this.deps.timers.clearTimeout(this.timer);
    this.timer = null;
  }

  private schedule(): void {
    if (this.running || this.stopped || this.halted) return;
    this.clear();
    const due = this.dueAt();
    if (due === null) return;
    this.timer = this.deps.timers.setTimeout(() => {
      this.timer = null;
      void this.run(false);
    }, Math.max(0, due - this.deps.timers.now()));
  }

  private async run(now: boolean): Promise<void> {
    if (this.running || this.halted || (this.stopped && !now)) return;
    const t = this.deps.timers.now();
    this.firstChange = null;
    this.lastSave = t;
    let saving: Promise<void>;
    try {
      saving = this.deps.flush();
    } catch (err) {
      saving = Promise.reject(err);
    }
    this.running = saving;
    try {
      await saving;
      this.failures = 0;
      this.retryAt = -Infinity;
      this.deps.onSaved?.();
    } catch (err) {
      const code = storeErrorCode(err);
      if (!retryable(err)) {
        this.halted = code;
        this.clear();
        this.deps.onFailed?.(code, true);
        return;
      }
      this.retryAt = this.deps.timers.now() + LEARNING_SAVE.backoffMs[Math.min(this.failures, LEARNING_SAVE.backoffMs.length - 1)];
      this.failures++;
      // what failed is still to save
      this.firstChange ??= t;
      this.deps.onFailed?.(code, false);
    } finally {
      this.running = null;
      this.schedule();
    }
  }
}

// ------------------------------------------------------------------ unsaved records on the device

export type PendingStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;

export function pendingKey(userId: string): string {
  return `agathon.learning.pending.${userId}`;
}

function looksLikeRecord(v: unknown): v is AttemptRecord {
  if (!v || typeof v !== "object") return false;
  const r = v as Record<string, unknown>;
  return (
    typeof r.id === "string" &&
    r.id.length > 0 &&
    typeof r.problemLatex === "string" &&
    typeof r.skill === "string" &&
    typeof r.origin === "string" &&
    typeof r.outcome === "string" &&
    (OUTCOMES as readonly string[]).includes(r.outcome) &&
    typeof r.startedAt === "string" &&
    typeof r.updatedAt === "string"
  );
}

/** The records a visit could not save, as kept on this device (newest first); [] when none or unreadable. */
export function readPending(userId: string, storage: PendingStorage | null): AttemptRecord[] {
  if (!storage) return [];
  try {
    const raw = storage.getItem(pendingKey(userId));
    if (!raw) return [];
    const list = JSON.parse(raw) as unknown;
    return Array.isArray(list) ? list.filter(looksLikeRecord).slice(0, LEARNING_SAVE.pendingMax) : [];
  } catch {
    return [];
  }
}

/** Keeps these records on the device (newest first, at most `pendingMax`); none clears the entry. */
export function writePending(userId: string, records: readonly AttemptRecord[], storage: PendingStorage | null): void {
  if (!storage) return;
  try {
    const byId = new Map<string, AttemptRecord>();
    for (const r of records) {
      const cur = byId.get(r.id);
      if (!cur || cur.updatedAt <= r.updatedAt) byId.set(r.id, r);
    }
    const list = [...byId.values()].sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : a.updatedAt > b.updatedAt ? -1 : 0)).slice(0, LEARNING_SAVE.pendingMax);
    if (list.length === 0) storage.removeItem(pendingKey(userId));
    else storage.setItem(pendingKey(userId), JSON.stringify(list));
  } catch {
    // a full or blocked storage: the records stay in memory only
  }
}

/** A record left on the device by a visit that ended without closing it: it is over now. */
export function closedPending(record: AttemptRecord): AttemptRecord {
  if (record.outcome !== "in_progress") return record;
  return { ...record, outcome: "unfinished", finishedAt: record.finishedAt ?? record.updatedAt };
}

// ------------------------------------------------------------------ the runtime

export interface LearningProfile {
  course: CourseId | null;
  displayName: string | null;
}

interface EventTargetLike {
  addEventListener(type: string, fn: (e: Event) => void): void;
  removeEventListener(type: string, fn: (e: Event) => void): void;
}

export interface BoardLearningDeps {
  bus: LearningBus;
  readProfile: (userId: string) => Promise<LearningProfile>;
  save: (records: readonly AttemptRecord[]) => Promise<void>;
  load: () => Promise<AttemptRecord[]>;
  /** the learner hint from the student's attempts (`summarize` → `learnerHint`) */
  hint: (attempts: readonly AttemptRecord[], now: number, course: CourseId | null) => LearnerHint | undefined;
  engine: () => Promise<LiveEngine>;
  newId: () => string;
  timers: SchedulerTimers;
  storage: PendingStorage | null;
  /** `pagehide` (the window) */
  window: EventTargetLike | null;
  /** `visibilitychange` (the document) and whether it is hidden */
  document: (EventTargetLike & { visibilityState?: string }) | null;
}

async function readProfileFromSupabase(userId: string): Promise<LearningProfile> {
  // the app's client is in the board's first load already; imported here so tests never make one
  const { supabase } = await import("@/lib/supabase");
  const { data, error } = await supabase.from("profiles").select("course, display_name").eq("user_id", userId).maybeSingle();
  if (error || !data) return { course: null, displayName: null };
  const row = data as { course?: unknown; display_name?: unknown };
  return { course: isCourseId(row.course) ? row.course : null, displayName: typeof row.display_name === "string" && row.display_name.trim() ? row.display_name.trim() : null };
}

function newUuid(): string {
  const c = typeof globalThis.crypto !== "undefined" ? globalThis.crypto : undefined;
  if (c && typeof c.randomUUID === "function") return c.randomUUID();
  const bytes = new Uint8Array(16);
  if (c && typeof c.getRandomValues === "function") c.getRandomValues(bytes);
  else for (let i = 0; i < 16; i++) bytes[i] = Math.floor(Math.random() * 256);
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function defaultDeps(): BoardLearningDeps {
  const hasWindow = typeof window !== "undefined";
  let storage: PendingStorage | null = null;
  try {
    storage = hasWindow ? window.localStorage : null;
  } catch {
    storage = null;
  }
  return {
    bus: learningBus,
    readProfile: readProfileFromSupabase,
    save: (records) => saveAttempts(records),
    load: () => loadAttempts({ sinceDays: LEARNING_LIMITS.readDays, limit: LEARNING_LIMITS.readLimit }),
    hint: (attempts, now, course) => learnerHint(summarize(attempts, now, { course, tzOffsetMinutes: new Date(now).getTimezoneOffset() })),
    // the board's engine, loaded with the board already
    engine: () => import("@/lib/live/engine").then((m) => m.getEngine()),
    newId: newUuid,
    timers: {
      now: () => Date.now(),
      setTimeout: (fn, ms) => setTimeout(fn, ms),
      clearTimeout: (h) => clearTimeout(h as ReturnType<typeof setTimeout>),
    },
    storage,
    window: hasWindow ? window : null,
    document: typeof document !== "undefined" ? document : null,
  };
}

export interface BoardLearningOptions {
  boardId: string;
  userId: string;
}

/** What a running board runtime offers (tests, and the board's UI if it wants the profile). */
export interface BoardLearningHandle {
  /** stops it: the board's attempts are closed and saved (or kept on the device) */
  stop(): void;
  profile(): LearningProfile | null;
  tracker(): AttemptTracker | null;
  scheduler(): SaveScheduler;
}

/**
 * Starts the board's learning runtime; returns its handle (`stop` on unmount). Never throws: a
 * runtime that cannot start (no profile, no storage) records what it can, or nothing.
 */
export function startBoardLearning(opts: BoardLearningOptions, overrides: Partial<BoardLearningDeps> = {}): BoardLearningHandle {
  const deps: BoardLearningDeps = { ...defaultDeps(), ...overrides };
  const { bus, timers } = deps;
  let stopped = false;
  let tracker: AttemptTracker | null = null;
  let profile: LearningProfile | null = null;
  let unsubscribe: (() => void) | null = null;
  let tickTimer: unknown = null;
  /** what the last visits left on the device, saved first */
  const replay: AttemptRecord[] = readPending(opts.userId, deps.storage).map(closedPending);

  // what is not saved yet, kept on the device — not records the store called invalid: they would fail on every visit
  const persist = () => writePending(opts.userId, scheduler.halted === "invalid" ? [] : [...replay, ...(tracker?.pending() ?? [])], deps.storage);

  const flushAll = async (): Promise<void> => {
    if (replay.length > 0) {
      const batch = replay.splice(0);
      try {
        await deps.save(batch);
      } catch (err) {
        replay.unshift(...batch);
        throw err;
      }
    }
    await tracker?.flush();
  };

  const scheduler = new SaveScheduler({
    flush: flushAll,
    timers,
    onSaved: () => persist(),
    onFailed: (code) => {
      if (code === "invalid") replay.splice(0);
      persist();
    },
  });

  // ---- the learner hint
  let learnerAt = -Infinity;
  let finishedSince = 0;
  let loadingLearner = false;
  const finished = new Set<string>();

  const refreshLearner = async (): Promise<void> => {
    if (loadingLearner || stopped) return;
    loadingLearner = true;
    learnerAt = timers.now();
    finishedSince = 0;
    try {
      const loaded = await deps.load();
      if (stopped) return;
      // the board's own attempts are newer than what the store has (saves lag the board)
      const byId = new Map<string, AttemptRecord>(loaded.map((r) => [r.id, r]));
      for (const r of tracker?.records() ?? []) byId.set(r.id, r);
      bus.setLearner(deps.hint([...byId.values()], timers.now(), profile?.course ?? null));
    } catch (err) {
      console.warn("[learning] the learner hint could not be loaded", err);
    } finally {
      loadingLearner = false;
    }
  };

  const maybeRefreshLearner = () => {
    if (finishedSince >= LEARNING_SAVE.learnerAfter && timers.now() - learnerAt >= LEARNING_SAVE.learnerEveryMs) void refreshLearner();
  };

  const published = (record: AttemptRecord) => {
    bus.publishAttempt(record);
    if (record.finishedAt && !finished.has(record.id)) {
      finished.add(record.id);
      finishedSince++;
      maybeRefreshLearner();
    }
    scheduler.changed();
  };

  const tick = () => {
    tickTimer = null;
    if (stopped) return;
    tracker?.tick(timers.now());
    maybeRefreshLearner();
    tickTimer = timers.setTimeout(tick, LEARNING_SAVE.tickMs);
  };

  // ---- the page going away, or out of sight
  const onHidden = () => {
    if (deps.document?.visibilityState !== "hidden") return;
    persist();
    void scheduler.flushNow().then(persist);
  };
  const onPageHide = () => {
    // the board may not come back: its problems are over (a page brought back from the cache opens them again)
    tracker?.handle({ type: "closed", at: timers.now(), boardId: opts.boardId });
    persist();
    void scheduler.flushNow().then(persist);
  };
  deps.window?.addEventListener("pagehide", onPageHide);
  deps.document?.addEventListener("visibilitychange", onHidden);

  void (async () => {
    try {
      profile = await deps.readProfile(opts.userId).catch(() => ({ course: null, displayName: null }));
      if (stopped) return;
      tracker = new AttemptTracker({
        now: timers.now,
        newId: deps.newId,
        course: profile.course,
        save: deps.save,
        publish: published,
        engine: deps.engine,
      });
      const mine = tracker;
      // the board's signals (those it said before this runtime was here come first)
      unsubscribe = bus.onSignal((signal: LearningSignal) => {
        if ("boardId" in signal && signal.boardId !== opts.boardId) return;
        mine.handle(signal);
      });
      if (replay.length > 0) scheduler.changed();
      tickTimer = timers.setTimeout(tick, LEARNING_SAVE.tickMs);
      void refreshLearner();
    } catch (err) {
      console.warn("[learning] the board's learning record could not start", err);
    }
  })();

  return {
    stop: () => {
      if (stopped) return;
      stopped = true;
      deps.window?.removeEventListener("pagehide", onPageHide);
      deps.document?.removeEventListener("visibilitychange", onHidden);
      if (tickTimer !== null) timers.clearTimeout(tickTimer);
      tickTimer = null;
      unsubscribe?.();
      unsubscribe = null;
      // the board is closing: its attempts are over, and saved now (or kept on the device)
      tracker?.handle({ type: "closed", at: timers.now(), boardId: opts.boardId });
      // another student may sign in on this tab: their checks must not carry this one's hint
      bus.setLearner(undefined);
      persist();
      void scheduler.flushNow().then(() => {
        scheduler.stop();
        persist();
      });
    },
    profile: () => profile,
    tracker: () => tracker,
    scheduler: () => scheduler,
  };
}
