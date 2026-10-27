"use client";

import type { KeyboardEvent } from "react";
import type { Mark } from "@/lib/keys/check";
import { FRACTION_LINE, type Cell, type FracPart, type FractionLayout, type MathItem, type Values } from "@/lib/keys/item";
import styles from "./keys.module.css";
import { Ring, Tick } from "./TutorMarks";

/** A fraction the tutor wrote: its top over its bottom, in cobalt. */
export function GivenFraction({ part }: { part: FracPart }) {
  return (
    <span className={styles.frac} aria-hidden="true">
      <span className={styles.fracGiven}>{part.num.value}</span>
      <span className={styles.fracBar} />
      <span className={styles.fracGiven}>{part.den.value}</span>
    </span>
  );
}

/** The problem as the tutor writes it, its fractions stacked (`3/4 = ?/12`). */
export function FractionText({ text }: { text: string }) {
  const tokens = text.split(/\s+/);
  return (
    <>
      {tokens.map((t, i) => {
        const m = /^([\d?]+)\/(\d+)$/.exec(t);
        if (!m) return <span key={i}>{` ${t} `}</span>;
        return (
          <span key={i} className={`${styles.frac} ${styles.fracBig}`}>
            <span>{m[1] === "?" ? "□" : m[1]}</span>
            <span className={styles.fracBar} />
            <span>{m[2]}</span>
          </span>
        );
      })}
    </>
  );
}

export interface FractionCellsProps {
  item: MathItem;
  values: Values;
  marks: Record<string, Mark>;
  ringed: readonly string[];
  readOnly: boolean;
  carried: string | null;
  onKey: (cellId: string, e: KeyboardEvent<HTMLInputElement>) => void;
  onInput: (cellId: string, value: string) => void;
}

function label(c: Cell, ringed: boolean): string {
  const where = c.place === 0 ? "Top number of your fraction, the numerator" : "Bottom number of your fraction, the denominator";
  return ringed ? `${where}. Look again.` : where;
}

/**
 * Fractions set out on the page (docs/KEYS.md, Phase 3): the tutor's stacked in cobalt, the kid's as
 * two boxes, a top over a bottom. Digits fill a box; `/` goes from the top to the bottom; arrows move
 * between them. Keys are the work surface's (`TypedLines`); this draws.
 */
export function FractionCells({ item, values, marks, ringed, readOnly, carried, onKey, onInput }: FractionCellsProps) {
  const layout = item.layout as FractionLayout;
  const box = (c: Cell) =>
    c.role === "given" ? (
      <span className={styles.fracGiven}>{c.value}</span>
    ) : (
      <span className={styles.fracCellWrap}>
        <input
          data-slot={`cell:${c.id}`}
          className={`${styles.cell} ${styles.fracCell} ${carried === c.id ? styles.arrived : ""}`}
          value={values[c.id] ?? ""}
          placeholder=" "
          inputMode="numeric"
          autoComplete="off"
          spellCheck={false}
          maxLength={c.width ?? 3}
          readOnly={readOnly}
          aria-label={label(c, ringed.includes(c.id))}
          onKeyDown={(e) => onKey(c.id, e)}
          onChange={(e) => onInput(c.id, e.target.value.replace(/\D/g, "").slice(0, c.width ?? 3))}
        />
        {ringed.includes(c.id) && <Ring />}
      </span>
    );
  return (
    <div className={styles.fractions} role="group" aria-label={`The fractions: ${item.words}`} data-line={FRACTION_LINE}>
      {layout.parts.map((p, i) =>
        typeof p === "string" ? (
          <span key={i} className={styles.eqPart} aria-hidden="true">
            {p}
          </span>
        ) : p.num.role === "given" && p.den.role === "given" ? (
          <GivenFraction key={p.id} part={p} />
        ) : (
          <span key={p.id} className={styles.frac}>
            {box(p.num)}
            <span className={styles.fracBar} aria-hidden="true" />
            {box(p.den)}
          </span>
        ),
      )}
      <span className={styles.markSlot}>{marks[FRACTION_LINE] === "tick" && <Tick label="Your fraction is right" />}</span>
    </div>
  );
}
