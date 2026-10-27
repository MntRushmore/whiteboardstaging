"use client";

import type { KeyboardEvent } from "react";
import { KEYS_COPY, leadOf } from "@/lib/keys/copy";
import type { Mark } from "@/lib/keys/check";
import type { MathItem, Values } from "@/lib/keys/item";
import type { Help, SolvedStep } from "@/lib/keys/session";
import type { SubStep } from "@/lib/keys/shrink";
import { ManipulativeTray, manipulativeHint } from "./Manipulatives";
import styles from "./keys.module.css";
import { Ring, Tick } from "./TutorMarks";

/** A smaller problem as one line: the tutor's numbers in cobalt, the kid's box (or answer) in ink. */
function EquationLine({
  item,
  values,
  box,
}: {
  item: MathItem;
  values: Values;
  box: ((cellId: string) => React.ReactNode) | null;
}) {
  if (item.layout.kind !== "equation") return null;
  return (
    <>
      {item.layout.line.parts.map((p, i) =>
        typeof p === "string" ? (
          <span key={i} className={styles.eqPart} aria-hidden="true">
            {p}
          </span>
        ) : p.role === "given" ? (
          <span key={i} className={styles.eqPart} aria-hidden="true">
            {p.value}
          </span>
        ) : box ? (
          <span key={i} style={{ position: "relative" }}>
            {box(p.id)}
          </span>
        ) : (
          <span key={i} className={styles.kidNum}>
            {values[p.id]}
          </span>
        ),
      )}
    </>
  );
}

export interface TutorWritingProps {
  solved: readonly SolvedStep[];
  open: { step: SubStep; values: Values } | null;
  subMark: Mark | null;
  help: Help | null;
  /** the tutor's line for the help on the page now, as said (null while it is being worded) */
  line: string | null;
  /** the tutor's words are on their way: its "…" */
  pending: boolean;
  onBoxKey: (cellId: string, e: KeyboardEvent<HTMLInputElement>) => void;
  onBoxInput: (cellId: string, value: string) => void;
}

/** How many characters the smaller problem's box holds (a box for `12` is two wide). */
export function boxWidth(item: MathItem, id: string): number {
  if (item.layout.kind !== "equation") return 1;
  const cell = item.layout.line.parts.find((p) => typeof p !== "string" && p.id === id);
  return typeof cell === "object" ? (cell.width ?? 1) : 1;
}

/**
 * The tutor's writing under the work (docs/KEYS.md, "Help me"): a nudge line, or the smaller problem
 * with its blocks, and the smaller problems already solved, each with its tick. All in the tutor's
 * cobalt hand; only the kid's numbers are ink.
 */
export function TutorWriting({ solved, open, subMark, help, line, pending, onBoxKey, onBoxInput }: TutorWritingProps) {
  if (!solved.length && !open && help?.kind !== "nudge" && help?.kind !== "worked") return null;
  const thinking = (
    <p className={`${styles.handLine} ${styles.thinking}`} aria-hidden="true">
      {KEYS_COPY.thinking}
    </p>
  );
  // the smaller problem's lead is the tutor's line while it is the help on the page; under a worked
  // step it stays as written
  const lead = open ? (help?.kind === "smaller" ? line : leadOf(open.step)) : null;
  return (
    <div className={`${styles.help} ${styles.workFull}`}>
      {solved.map((s, i) => (
        <p key={i} className={styles.solvedStep}>
          <span>{leadOf(s.step)}</span>
          <EquationLine item={s.step.item} values={s.values} box={null} />
          <Tick label="The smaller problem is right" />
          <span>{KEYS_COPY.carriedBack(s.value)}</span>
        </p>
      ))}
      {help?.kind === "nudge" && (line ? <p className={styles.handLine}>{line}</p> : pending ? thinking : <p className={styles.handLine}>{help.text}</p>)}
      {open && (
        <>
          <div className={styles.leadRow}>
            {lead ? <p className={styles.handLine}>{lead}</p> : thinking}
            <p className={styles.blocksHint}>{manipulativeHint(open.step.manipulative)}</p>
          </div>
          <div className={styles.subRow}>
            <div className={styles.equation} role="group" aria-label={`Smaller problem: ${open.step.item.words}`}>
              <EquationLine
                item={open.step.item}
                values={open.values}
                box={(id) => (
                  <>
                    <input
                      data-slot="box"
                      className={styles.cell}
                      style={boxWidth(open.step.item, id) > 1 ? { width: `${boxWidth(open.step.item, id) * 1.6 + 1.5}rem` } : undefined}
                      value={open.values[id] ?? ""}
                      placeholder=" "
                      inputMode="numeric"
                      autoComplete="off"
                      spellCheck={false}
                      maxLength={boxWidth(open.step.item, id)}
                      aria-label={`The box in ${open.step.item.words}. ${manipulativeHint(open.step.manipulative)}${subMark === "ring" ? ` ${KEYS_COPY.lookAgain}` : ""}`}
                      onKeyDown={(e) => onBoxKey(id, e)}
                      onChange={(e) => onBoxInput(id, e.target.value.replace(/\D/g, "").slice(-boxWidth(open.step.item, id)))}
                    />
                    {subMark === "ring" && <Ring />}
                  </>
                )}
              />
            </div>
            {open.step.manipulative && (
              <ManipulativeTray
                m={open.step.manipulative}
                built={(open.values.x ?? "") === "" ? null : Number(open.values.x)}
                total={open.step.item.answer === String(open.step.item.total) ? null : open.step.item.total}
              />
            )}
          </div>
        </>
      )}
      {help?.kind === "worked" && (line ? <p className={`${styles.handLine} ${styles.worked}`}>{line}</p> : thinking)}
    </div>
  );
}
