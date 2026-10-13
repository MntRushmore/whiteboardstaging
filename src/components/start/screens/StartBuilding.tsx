"use client";

import { useEffect, useState, type Ref } from "react";
import type { FlowCopy } from "@/lib/start/flow";
import { TutorCheck } from "../parts";
import styles from "../start.module.css";

export interface StartBuildingProps {
  copy: FlowCopy["building"];
  /** the plan's first skill, by name ("Times tables"); null with none */
  firstSkill: string | null;
  onDone: () => void;
  titleRef: Ref<HTMLHeadingElement>;
}

/** When each line shows, and when the tutor checks it (ms after the screen shows). */
const ROW_EVERY_MS = 720;
const CHECK_AFTER_MS = 380;
/** The beat is over this long after the last check. */
const HOLD_MS = 520;

function reducedMotion(): boolean {
  try {
    return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  } catch {
    return false;
  }
}

/**
 * A short beat, "Making Sam's plan…": three true lines about the plan (the grade's problems, the
 * first skill, a board ready to write on), all there from the start, and the tutor checks them one
 * by one. Then the plan. With reduced motion, all three are checked at once and the plan follows a
 * moment later.
 */
export function StartBuilding({ copy, firstSkill, onDone, titleRef }: StartBuildingProps) {
  const rows = [copy.level, copy.start(firstSkill), copy.board];
  // each row: 1 waiting, 2 checked
  const [shown, setShown] = useState<number[]>(() => rows.map(() => 1));

  useEffect(() => {
    const timers: ReturnType<typeof setTimeout>[] = [];
    if (reducedMotion()) {
      setShown(rows.map(() => 2));
      timers.push(setTimeout(onDone, 1200));
    } else {
      rows.forEach((_, i) => {
        timers.push(setTimeout(() => setShown((s) => s.map((v, j) => (j === i ? 2 : v))), 180 + i * ROW_EVERY_MS + CHECK_AFTER_MS));
      });
      timers.push(setTimeout(onDone, 180 + (rows.length - 1) * ROW_EVERY_MS + CHECK_AFTER_MS + HOLD_MS));
    }
    return () => timers.forEach(clearTimeout);
    // once, when the screen shows
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <>
      <div className={styles.head}>
        <h1 ref={titleRef} tabIndex={-1} className={styles.title} aria-live="polite">
          {copy.title}
        </h1>
      </div>
      <ul className={styles.steps}>
        {rows.map((row, i) => (
          <li key={i} className={styles.stepRow} data-state={shown[i] === 2 ? "done" : "on"}>
            <span className={styles.box}>{shown[i] === 2 && <TutorCheck seed={i * 7 + 4} />}</span>
            <span>{row}</span>
          </li>
        ))}
      </ul>
    </>
  );
}
