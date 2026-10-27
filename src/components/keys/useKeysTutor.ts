"use client";

import { useEffect, useRef, useState } from "react";
import { readLearnerProfile, type LearnerProfile } from "@/lib/learning/profile";
import { seedOf } from "@/lib/learning/nowYouTry";
import { tidyLine } from "@/lib/keys/copy";
import { keysRecord, recordable, startClock, tickClock, type KeysClock } from "@/lib/keys/record";
import { sayLine, type SayInput } from "@/lib/keys/say";
import type { SetState } from "@/lib/keys/session";
import { fetchSay } from "./tutorVoice";

/** The kid's grade and course, for the tutor's words and the record. Null fields until read (or signed out). */
export function useLearner(userId: string | null): Pick<LearnerProfile, "grade" | "course"> {
  const [learner, setLearner] = useState<Pick<LearnerProfile, "grade" | "course">>({ grade: null, course: null });
  useEffect(() => {
    if (!userId) return;
    let live = true;
    void readLearnerProfile(userId).then((p) => live && setLearner({ grade: p.grade, course: p.course }));
    return () => {
      live = false;
    };
  }, [userId]);
  return learner;
}

/** Lines already said on this page, by request: the same help says the same words. */
const said = new Map<string, string>();

/**
 * The tutor's words for what it is saying now (`sayInputFor`): the route's own when they come within
 * SAY_WAIT_MS, else the fixed line. `pending` while it waits (the page shows the tutor's "…").
 */
export function useSaid(input: SayInput | null): { line: string | null; pending: boolean } {
  const key = input ? JSON.stringify(input) : null;
  const [got, setGot] = useState<{ key: string; line: string } | null>(null);
  useEffect(() => {
    if (!input || !key || said.has(key)) return;
    let live = true;
    void sayLine(input, fetchSay).then((r) => {
      said.set(key, r.line);
      if (live) setGot({ key, line: r.line });
    });
    return () => {
      live = false;
    };
    // `key` is the input's identity
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  if (!input || !key) return { line: null, pending: false };
  const known = said.get(key) ?? (got?.key === key ? got.line : null);
  return known ? { line: known, pending: false } : { line: null, pending: true };
}

/** The fixed line, tidied as the page shows it (what `useSaid` falls back to). */
export const fixedLine = tidyLine;

interface Attempt {
  id: string;
  clock: KeysClock;
  /** the state last saved (by reference), so an unchanged problem is not saved again */
  saved: unknown;
}

function newId(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `${Date.now().toString(16)}-0000-4000-8000-000000000000`;
}

const SAVE_DEBOUNCE_MS = 1500;

/**
 * Each problem of the set as an `AttemptRecord` in the learning record (origin `keys`), saved as it
 * goes: a moment after each change, at once when it is solved, and as `unfinished` when the kid moves
 * on or leaves the page without solving it. A failed save is tried again with the next one. Returns
 * the attempt id of each problem (a Now you try's parent, its seed).
 */
export function useKeysRecord(state: SetState, learner: { course: LearnerProfile["course"] }, signedIn: boolean): (index: number) => string {
  const attempts = useRef(new Map<string, Attempt>());
  const pending = useRef(new Map<string, ReturnType<typeof keysRecord>>());
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const stateRef = useRef(state);
  const learnerRef = useRef(learner);
  useEffect(() => {
    learnerRef.current = learner;
  }, [learner]);

  // one attempt per problem on the page, by its place and item (a restart starts new ones)
  const keyOf = (s: SetState, i: number) => `${i}:${s.items[i]?.id}:${s.items.length}:${s.entries[i]?.after ?? ""}`;
  const attemptFor = (s: SetState, i: number, now: number): Attempt => {
    const k = keyOf(s, i);
    let a = attempts.current.get(k);
    if (!a) {
      a = { id: newId(), clock: startClock(now), saved: null };
      attempts.current.set(k, a);
    }
    return a;
  };

  const flush = useRef(async () => {});
  flush.current = async () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    if (!signedIn || pending.current.size === 0) return;
    const batch = [...pending.current.values()];
    pending.current.clear();
    try {
      const { saveAttempts } = await import("@/lib/learning/store");
      await saveAttempts(batch);
    } catch (err) {
      // kept for the next save, unless the database refused them for good
      const code = (err as { code?: string } | null)?.code;
      if (code === "network" || code === "unknown") for (const r of batch) if (!pending.current.has(r.id)) pending.current.set(r.id, r);
    }
  };

  const queue = (s: SetState, i: number, closed: boolean) => {
    const p = i === s.index ? s.problem : null;
    const a = attempts.current.get(keyOf(s, i));
    if (!p || !a || !recordable(p)) return;
    const parentIndex = s.entries[i]?.after;
    const parentId = parentIndex !== undefined ? (attempts.current.get(keyOf(s, parentIndex))?.id ?? null) : null;
    pending.current.set(a.id, keysRecord(p, { id: a.id, course: learnerRef.current.course, parentId, clock: a.clock, closed }));
  };

  useEffect(() => {
    const prev = stateRef.current;
    stateRef.current = state;
    const now = Date.now();
    // the problem left: closed (unfinished unless solved)
    if (prev !== state && (prev.index !== state.index || prev.items !== state.items || state.finished) && !prev.finished) {
      const a = attempts.current.get(keyOf(prev, prev.index));
      if (a && a.saved !== prev.problem) {
        a.saved = prev.problem;
        queue(prev, prev.index, true);
      }
      void flush.current();
    }
    if (state.finished) return;
    const a = attemptFor(state, state.index, now);
    if (a.saved === state.problem) return;
    a.clock = tickClock(a.clock, now);
    a.saved = state.problem;
    queue(state, state.index, false);
    if (state.problem.phase === "done") void flush.current();
    else {
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => void flush.current(), SAVE_DEBOUNCE_MS);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state]);

  // leaving the page: the problem on it is closed, and everything waiting is saved
  useEffect(() => {
    const onLeave = () => {
      const s = stateRef.current;
      if (!s.finished) queue(s, s.index, s.problem.phase !== "done");
      void flush.current();
    };
    window.addEventListener("pagehide", onLeave);
    return () => {
      window.removeEventListener("pagehide", onLeave);
      onLeave();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (index: number) => attemptFor(stateRef.current, index, Date.now()).id;
}

/** The seed of a Now you try: the same attempt always gets the same problem. */
export const nowYouTrySeed = seedOf;
