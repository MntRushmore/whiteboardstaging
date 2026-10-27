"use client";

import type { KeyboardEvent } from "react";
import type { Mark } from "@/lib/keys/check";
import { placeName, type Cell, type ColumnsLayout, type MathItem, type Values } from "@/lib/keys/item";
import styles from "./keys.module.css";
import { Ring, Tick } from "./TutorMarks";

export interface ColumnCellsProps {
  item: MathItem;
  values: Values;
  marks: Record<string, Mark>;
  ringed: readonly string[];
  readOnly: boolean;
  /** a cell the tutor just carried a value back into */
  carried: string | null;
  onKey: (cellId: string, e: KeyboardEvent<HTMLInputElement>) => void;
  onInput: (cellId: string, value: string) => void;
}

function cellLabel(c: Cell, ringed: boolean): string {
  const where =
    c.role === "carry"
      ? `Carry into the ${placeName(c.place)}`
      : c.role === "blank"
        ? `Missing ${placeName(c.place)} digit`
        : c.spare
          ? "Spare box, left of the answer"
          : `Answer, ${placeName(c.place)} digit`;
  return ringed ? `${where}. Look again.` : where;
}

/**
 * A sum set out in columns (docs/KEYS.md, "Focus"): place headers, the carry row (tomato), the
 * problem's digits printed in ink, the kid's boxes filled right to left. The tutor's marks (ticks,
 * rings) are the only cobalt. Keys are the work surface's (`TypedLines`); this draws.
 */
export function ColumnCells({ item, values, marks, ringed, readOnly, carried, onKey, onInput }: ColumnCellsProps) {
  const layout = item.layout as ColumnsLayout;
  const places = Array.from({ length: layout.places }, (_, i) => layout.places - 1 - i);
  const spare = new Set(layout.lines.flatMap((l) => l.cells.filter((c) => c?.spare).map((c) => c!.place)));

  return (
    <div className={styles.column} role="group" aria-label={`The column: ${item.words}`}>
      <div className={styles.colRow} aria-hidden="true">
        <span className={styles.opSlot} />
        {places.map((p) => (
          <span key={p} className={`${styles.slot} ${styles.placeHead}`}>
            {spare.has(p) ? "" : placeName(p)}
          </span>
        ))}
        <span className={styles.markSlot} />
      </div>
      {layout.lines.map((line) => (
        <div key={line.id}>
          <div className={styles.colRow} data-line={line.id}>
            <span className={styles.opSlot} aria-hidden="true">
              {line.op ?? ""}
            </span>
            {line.cells.map((c, i) => (
              <span key={c?.id ?? `empty-${i}`} className={styles.slot}>
                {c === null ? null : c.role === "given" ? (
                  <span className={styles.given} aria-hidden="true">
                    {c.value}
                  </span>
                ) : (
                  <>
                    <input
                      data-slot={`cell:${c.id}`}
                      className={[
                        styles.cell,
                        c.role === "carry" ? styles.carryCell : "",
                        c.spare ? styles.spare : "",
                        carried === c.id ? styles.arrived : "",
                      ].join(" ")}
                      value={values[c.id] ?? ""}
                      placeholder=" "
                      inputMode="numeric"
                      autoComplete="off"
                      spellCheck={false}
                      maxLength={1}
                      readOnly={readOnly}
                      aria-label={cellLabel(c, ringed.includes(c.id))}
                      onKeyDown={(e) => onKey(c.id, e)}
                      onChange={(e) => {
                        // typing is handled on keydown; this catches paste, IME and on-screen keyboards
                        const d = e.target.value.replace(/\D/g, "").slice(-1);
                        onInput(c.id, d);
                      }}
                    />
                    {ringed.includes(c.id) && <Ring />}
                  </>
                )}
              </span>
            ))}
            <span className={styles.markSlot}>{marks[line.id] === "tick" && <Tick label={`${line.id === "result" ? "The answer" : "This line"} is right`} />}</span>
          </div>
          {line.op && <div className={styles.rule} style={{ ["--places" as string]: layout.places }} aria-hidden="true" />}
        </div>
      ))}
    </div>
  );
}
