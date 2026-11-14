"use client";

import Link from "next/link";
import { ChevronLeft, MoreHorizontal } from "lucide-react";
import { useCallback, useEffect, useMemo, useReducer, useState, useSyncExternalStore } from "react";
import { useFeatureLabs } from "@/lib/featureLabs";
import { KEYS_COPY } from "@/lib/keys/copy";
import { generateSet, itemsFromList } from "@/lib/keys/generate";
import { setReducer, starsOf, startSet, type ProblemAction } from "@/lib/keys/session";
import { AllDone } from "./AllDone";
import { KEYS_FONT_VARS } from "./fonts";
import styles from "./keys.module.css";
import { HelpMark, StarIcon } from "./TutorMarks";
import { TypedLines } from "./TypedLines";

const KEY_LIST: [string, string][] = [
  ["0–9", "Fill a box. A column fills right to left."],
  ["c", "Open the carry box over this column."],
  ["← → ↑ ↓", "Move between boxes and lines."],
  ["Enter", "Go to the answer. In the answer, check it."],
  ["Ctrl + Enter", "Check, from anywhere."],
  ["?", "Help me."],
  ["Space", "Add a ten to the blocks."],
  ["Backspace", "Clear a box, or take a ten away."],
];

const noop = () => () => {};

export interface KeysPageProps {
  /** the set's seed (the day's, unless `?seed=` gave one) */
  seed: number;
  /** `?p=26+?6=92|47+38`: exactly these problems (QA) */
  list?: string | null;
}

/**
 * Keys (docs/KEYS.md): Today's practice with only a keyboard, as the iPad's Problem Page. Behind the
 * Feature Labs switch "Keyboard practice". The set lives here; the work surface is `TypedLines`.
 */
export function KeysPage({ seed, list }: KeysPageProps) {
  const { features, setFeature, loading } = useFeatureLabs();
  // Feature Labs reads this browser's cache first: render only once mounted, so the server's page and
  // the browser's first render agree.
  const mounted = useSyncExternalStore(noop, () => true, () => false);

  const [round, setRound] = useState(0);
  const items = useMemo(() => {
    const fromList = list ? itemsFromList(list) : [];
    return fromList.length ? fromList : generateSet(seed + round);
  }, [list, seed, round]);
  const [state, dispatch] = useReducer(setReducer, items, startSet);
  const [moreOpen, setMoreOpen] = useState(false);

  const onMore = useCallback(() => {
    const next = round + 1;
    setRound(next);
    dispatch({ type: "restart", items: list ? items : generateSet(seed + next) });
  }, [round, list, items, seed]);

  useEffect(() => {
    if (!moreOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setMoreOpen(false);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [moreOpen]);

  const problemDispatch = useCallback((a: ProblemAction) => dispatch(a), []);
  const onNext = useCallback(() => dispatch({ type: "next" }), []);

  const rootClass = `${styles.root} ${KEYS_FONT_VARS}`;

  if (!mounted || (!features.keys && loading)) {
    return (
      <main className={rootClass} aria-busy="true">
        <p className={styles.srOnly}>{KEYS_COPY.gate.loading}</p>
      </main>
    );
  }

  if (!features.keys) {
    return (
      <main className={rootClass}>
        <div className={styles.gate}>
          <h1>{KEYS_COPY.gate.title}</h1>
          <p>{KEYS_COPY.gate.body}</p>
          <button type="button" className={`${styles.btn} ${styles.ink}`} onClick={() => void setFeature("keys", true)}>
            {KEYS_COPY.gate.turnOn}
          </button>
          <Link href="/" className={`${styles.btn} ${styles.chalk}`}>
            {KEYS_COPY.backToBoards}
          </Link>
        </div>
      </main>
    );
  }

  const count = state.items.length;
  const stars = starsOf(state);

  return (
    <main className={rootClass}>
      <header className={styles.topBar}>
        <Link href="/" className={styles.round} aria-label={KEYS_COPY.backToBoards}>
          <ChevronLeft size={26} strokeWidth={2.6} aria-hidden="true" />
        </Link>
        <div className={styles.titleBlock}>
          <h1 className={styles.title}>{KEYS_COPY.title}</h1>
          <p className={styles.subtitle}>{state.finished ? KEYS_COPY.allDone : KEYS_COPY.problemOf(state.index + 1, count)}</p>
        </div>
        <div className={`${styles.barRight} ${styles.barAnchor}`}>
          <span className={styles.starsPill} aria-label={`Stars: ${KEYS_COPY.starsOf(stars, count)}`}>
            <StarIcon />
            <span aria-hidden="true">{KEYS_COPY.starsOf(stars, count)}</span>
          </span>
          {!state.finished && (
            <button type="button" className={`${styles.btn} ${styles.sunny} ${styles.helpMe}`} onClick={() => dispatch({ type: "help" })} aria-keyshortcuts="?">
              <HelpMark size={30} />
              <span className={styles.label}>{KEYS_COPY.helpMe}</span>
              <span className={styles.kbd} aria-hidden="true">
                ?
              </span>
            </button>
          )}
          <button type="button" className={`${styles.btn} ${styles.ink} ${styles.askBtn}`} aria-disabled="true" title={KEYS_COPY.askSoon} aria-label={`${KEYS_COPY.ask}. ${KEYS_COPY.askSoon}`}>
            {KEYS_COPY.ask}
          </button>
          <button type="button" className={styles.round} aria-label={`${KEYS_COPY.more}: the keys`} aria-expanded={moreOpen} aria-controls="keys-list" onClick={() => setMoreOpen((o) => !o)}>
            <MoreHorizontal size={24} strokeWidth={2.6} aria-hidden="true" />
          </button>
          {moreOpen && (
            <div id="keys-list" className={styles.keysCard} role="region" aria-label="The keys">
              <h2>{KEYS_COPY.keysTitle}</h2>
              <dl>
                {KEY_LIST.map(([k, what]) => (
                  <div key={k} style={{ display: "contents" }}>
                    <dt>
                      <span className={styles.kbd}>{k}</span>
                    </dt>
                    <dd>{what}</dd>
                  </div>
                ))}
              </dl>
            </div>
          )}
        </div>
      </header>

      <section className={styles.page} aria-label={state.finished ? KEYS_COPY.allDone : KEYS_COPY.problemOf(state.index + 1, count)}>
        {state.finished ? (
          <AllDone outcomes={state.outcomes} onMore={onMore} />
        ) : (
          <TypedLines key={`${round}:${state.index}`} problem={state.problem} dispatch={problemDispatch} last={state.index === count - 1} onNext={onNext} />
        )}
      </section>
    </main>
  );
}
