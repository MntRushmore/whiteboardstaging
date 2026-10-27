"use client";

import type { KeyboardEvent } from "react";
import { KEYS_COPY } from "@/lib/keys/copy";
import type { Mark } from "@/lib/keys/check";
import type { MathItem, Values } from "@/lib/keys/item";
import type { Help, SolvedStep } from "@/lib/keys/session";
import type { SubStep } from "@/lib/keys/shrink";
import { BlockTray } from "./BlockTray";
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
  onBoxKey: (cellId: string, e: KeyboardEvent<HTMLInputElement>) => void;
  onBoxInput: (cellId: string, value: string) => void;
}

/**
 * The tutor's writing under the work (docs/KEYS.md, "Help me"): a nudge line, or the smaller problem
 * with its blocks, and the smaller problems already solved, each with its tick. All in the tutor's
 * cobalt hand; only the kid's numbers are ink.
 */
export function TutorWriting({ solved, open, subMark, help, onBoxKey, onBoxInput }: TutorWritingProps) {
  if (!solved.length && !open && help?.kind !== "nudge") return null;
  return (
    <div className={styles.help}>
      {solved.map((s, i) => (
        <p key={i} className={styles.solvedStep}>
          <span>{KEYS_COPY.lead[s.step.lead]}</span>
          <EquationLine item={s.step.item} values={s.values} box={null} />
          <Tick label="The smaller problem is right" />
          <span>{KEYS_COPY.carriedBack(s.value)}</span>
        </p>
      ))}
      {help?.kind === "nudge" && <p className={styles.handLine}>{help.text}</p>}
      {open && (
        <>
          <div className={styles.leadRow}>
            <p className={styles.handLine}>{KEYS_COPY.lead[open.step.lead]}</p>
            <p className={styles.blocksHint}>{KEYS_COPY.blocksHint}</p>
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
                      value={open.values[id] ?? ""}
                      placeholder=" "
                      inputMode="numeric"
                      autoComplete="off"
                      spellCheck={false}
                      maxLength={1}
                      aria-label={`The box in ${open.step.item.words}. ${KEYS_COPY.blocksHint}${subMark === "ring" ? ` ${KEYS_COPY.lookAgain}` : ""}`}
                      onKeyDown={(e) => onBoxKey(id, e)}
                      onChange={(e) => onBoxInput(id, e.target.value.replace(/\D/g, "").slice(-1))}
                    />
                    {subMark === "ring" && <Ring />}
                  </>
                )}
              />
            </div>
            {open.step.manipulative && (
              <BlockTray
                blocks={open.step.manipulative}
                built={Number(open.values.x ?? "") || 0}
                total={open.step.item.answer === String(open.step.item.total) ? null : open.step.item.total}
              />
            )}
          </div>
        </>
      )}
    </div>
  );
}
