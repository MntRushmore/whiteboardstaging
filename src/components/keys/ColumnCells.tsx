"use client";

import type { KeyboardEvent } from "react";
import type { Mark } from "@/lib/keys/check";
import { cellLabel } from "@/lib/keys/a11y";
import { placeName, type ColumnsLayout, type MathItem, type Values } from "@/lib/keys/item";
import type { Pointer } from "@/lib/keys/session";
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
  /** Help me's nudge points here: the tutor's cobalt marker under that column */
  point: Pointer | null;
  onKey: (cellId: string, e: KeyboardEvent<HTMLInputElement>) => void;
  onInput: (cellId: string, value: string) => void;
}

/**
 * A sum, a difference or a product set out in columns (docs/KEYS.md): place headers, the carry or
 * regroup row (tomato), the tutor's digits in cobalt, a product's partial rows, the kid's cells in
 * ink, filled right to left. Keys are the work surface's
 * (`TypedLines`); this draws.
 */
export function ColumnCells({ item, values, marks, ringed, readOnly, carried, point, onKey, onInput }: ColumnCellsProps) {
  const layout = item.layout as ColumnsLayout;
  const places = Array.from({ length: layout.places }, (_, i) => layout.places - 1 - i);
  const spare = new Set(layout.lines.flatMap((l) => l.cells.filter((c) => c?.spare).map((c) => c!.place)));

  return (
    <div className={styles.column} role="group" aria-label={`The column: ${item.words}`}>
      <div className={styles.colRow} aria-hidden="true">
        <span className={styles.opSlot} />
        {places.map((p) => (
          <span key={p} className={`${styles.slot} ${styles.placeHead}`} data-pointed={point?.place === p ? "" : undefined}>
            {spare.has(p) ? "" : layout.places - spare.size >= 3 ? placeInitial(p) : placeName(p)}
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
                      aria-label={cellLabel(item, c, values[c.id] ?? "", ringed.includes(c.id))}
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
            <span className={styles.markSlot}>{marks[line.id] === "tick" && <Tick label={`${line.id === "result" ? "The answer" : line.role === "partial" ? "This row" : "This line"} is right`} />}</span>
          </div>
          {line.op && <div className={styles.rule} style={{ width: layout.places * 64 - 8 }} aria-hidden="true" />}
        </div>
      ))}
      {point?.place !== null && point?.place !== undefined && (
        <div className={styles.colRow} aria-hidden="true">
          <span className={styles.opSlot} />
          {places.map((p) => (
            <span key={p} className={styles.slot}>
              {p === point.place && <PointerArrow />}
            </span>
          ))}
          <span className={styles.markSlot} />
        </div>
      )}
    </div>
  );
}

/** Three columns or more: the headers a worksheet uses (H T O), so they never run into each other. */
function placeInitial(place: number): string {
  return ["O", "T", "H", "Th"][place] ?? placeName(place);
}

/** The tutor's pointer under a column (Help me's nudge): a short cobalt arrow, drawn in one stroke. */
function PointerArrow() {
  return (
    <svg className={styles.pointer} viewBox="0 0 40 32" aria-hidden="true">
      <path className={styles.draw} pathLength={1} d="M20 30 L20 6 M10 15 L20 4 L30 15" fill="none" stroke="#2D5BFF" strokeWidth={4} strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
