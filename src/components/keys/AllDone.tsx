"use client";

import Link from "next/link";
import { useEffect, useRef } from "react";
import { KEYS_COPY } from "@/lib/keys/copy";
import type { KeysOutcome } from "@/lib/keys/session";
import styles from "./keys.module.css";
import { Burst, ShapesCelebrate, Sticker } from "./TutorMarks";

/**
 * The end of a set (docs/PROBLEM-PAGES.md, "All done"): the shapes celebrating, the set's stickers (a
 * star: done on your own; a ring: done with help; and "5 for 5" when every one was on your own), Back
 * to my boards and More like these.
 */
export function AllDone({ outcomes, perfect, onMore }: { outcomes: readonly (KeysOutcome | null)[]; perfect: boolean; onMore: () => void }) {
  const own = outcomes.filter((o) => o === "first_try" || o === "self_corrected").length;
  const more = useRef<HTMLButtonElement>(null);
  useEffect(() => more.current?.focus(), []);
  return (
    <div className={styles.done}>
      <ShapesCelebrate />
      <h2 className={styles.doneTitle}>{KEYS_COPY.doneTitle}</h2>
      <p className={styles.doneLine}>{KEYS_COPY.doneLine(outcomes.length, own)}</p>
      <ul className={styles.stickers} aria-label="Your stickers">
        {outcomes.map((o, i) => {
          const kind = o === "with_help" ? "ring" : "star";
          return (
            <li key={i} aria-label={`Problem ${i + 1}: ${kind === "star" ? "a star, on your own" : "a ring, with help"}`}>
              <Sticker kind={kind} />
              <span aria-hidden="true">{i + 1}</span>
            </li>
          );
        })}
        {perfect && (
          <li aria-label={`${KEYS_COPY.perfect(outcomes.length)}: every problem on your own`} className={styles.perfectSticker}>
            <Sticker kind="perfect" />
            <span aria-hidden="true">{KEYS_COPY.perfect(outcomes.length)}</span>
          </li>
        )}
      </ul>
      <div className={styles.doneButtons}>
        <Link href="/" className={`${styles.btn} ${styles.chalk}`}>
          {KEYS_COPY.backToBoards}
        </Link>
        <button ref={more} type="button" className={`${styles.btn} ${styles.ink}`} onClick={onMore}>
          {KEYS_COPY.moreLikeThese}
        </button>
      </div>
      <Burst />
    </div>
  );
}
