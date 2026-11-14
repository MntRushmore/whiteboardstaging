"use client";

import type { BaseTenBlocks } from "@/lib/keys/shrink";
import styles from "./keys.module.css";

const COLORS = { carried: "#FF5A36", tutor: "#2D5BFF", kid: "#14151F" } as const;

/** One ten: a rod of ten flat squares. */
function Rod({ color }: { color: string }) {
  return (
    <svg width="16" height="64" viewBox="0 0 16 64" aria-hidden="true">
      <rect x="0" y="0" width="16" height="64" rx="3" fill={color} />
      {Array.from({ length: 9 }, (_, i) => (
        <rect key={i} x="2" y={6.2 * (i + 1) - 0.6} width="12" height="1.2" fill="#FFFFFF" />
      ))}
    </svg>
  );
}

function tens(n: number): string {
  return n === 1 ? "1 ten" : `${n} tens`;
}

/**
 * Base-ten blocks for the smaller problem (docs/KEYS.md): the carried ten in tomato, the tutor's tens
 * in cobalt, and the box's group, which the kid builds (Space adds, Backspace takes away) in ink.
 */
export function BlockTray({ blocks, built, total }: { blocks: BaseTenBlocks; built: number; total: number | null }) {
  return (
    <div className={styles.tray} aria-hidden="true">
      {blocks.groups.map((g, i) => {
        const count = g.box ? built : g.count;
        const color = g.box ? COLORS.kid : g.carried ? COLORS.carried : COLORS.tutor;
        // a box that is the total comes after "="; an addend box after "+"
        const op = i === 0 ? null : g.box && total === null ? "=" : "+";
        return (
          <div key={i} style={{ display: "contents" }}>
            {op && <span className={styles.trayOp}>{op}</span>}
            <div className={styles.group}>
              <div className={`${styles.rods} ${g.box ? styles.boxGroup : ""}`}>
                {Array.from({ length: count }, (_, k) => (
                  <Rod key={k} color={color} />
                ))}
              </div>
              <span className={styles.groupLabel}>{g.box ? (built ? tens(built) : "?") : g.carried ? "carried" : tens(g.count)}</span>
            </div>
          </div>
        );
      })}
      {total !== null && (
        <>
          <span className={styles.trayOp}>=</span>
          <div className={styles.group}>
            <div className={styles.rods}>
              {Array.from({ length: total }, (_, k) => (
                <Rod key={k} color={COLORS.tutor} />
              ))}
            </div>
            <span className={styles.groupLabel}>{tens(total)}</span>
          </div>
        </>
      )}
    </div>
  );
}
