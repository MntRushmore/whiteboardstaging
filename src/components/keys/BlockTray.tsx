"use client";

import type { BaseTenBlocks } from "@/lib/keys/shrink";
import styles from "./keys.module.css";

const COLORS = { carried: "#FF5A36", tutor: "#2D5BFF", kid: "#14151F" } as const;

/** One one: a single flat square. */
function Cube({ color }: { color: string }) {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true">
      <rect x="0" y="0" width="14" height="14" rx="3" fill={color} />
    </svg>
  );
}

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

function count(n: number, unit: "ten" | "one"): string {
  return n === 1 ? `1 ${unit}` : `${n} ${unit}s`;
}

/**
 * Base-ten blocks for the smaller problem (docs/KEYS.md): rods (tens) or cubes (ones); the carried or
 * lent group in tomato, the tutor's in cobalt, and the box's group, which the kid builds (Space adds,
 * Backspace takes away) in ink. A group may carry its own sign (`−` when taking away).
 */
export function BlockTray({ blocks, built, total }: { blocks: BaseTenBlocks; built: number; total: number | null }) {
  return (
    <div className={styles.tray} aria-hidden="true">
      {blocks.groups.map((g, i) => {
        const n = g.box ? built : g.count;
        const color = g.box ? COLORS.kid : g.carried ? COLORS.carried : COLORS.tutor;
        // a group's own sign (taking away); else a box that is the total comes after "=", an addend after "+"
        const op = i === 0 ? null : (g.op ?? (g.box && total === null ? "=" : "+"));
        const unit = blocks.unit;
        return (
          <div key={i} style={{ display: "contents" }}>
            {op && <span className={styles.trayOp}>{op}</span>}
            <div className={styles.group}>
              <div className={`${styles.rods} ${g.box ? styles.boxGroup : ""} ${unit === "one" ? styles.cubes : ""}`}>
                {Array.from({ length: n }, (_, k) => (unit === "one" ? <Cube key={k} color={color} /> : <Rod key={k} color={color} />))}
              </div>
              <span className={styles.groupLabel}>{g.box ? (built ? count(built, unit) : "?") : g.carried ? (unit === "one" && g.count === 10 ? "1 ten as 10 ones" : "carried") : count(g.count, unit)}</span>
            </div>
          </div>
        );
      })}
      {total !== null && (
        <>
          <span className={styles.trayOp}>=</span>
          <div className={styles.group}>
            <div className={styles.rods}>
              {Array.from({ length: total }, (_, k) => (blocks.unit === "one" ? <Cube key={k} color={COLORS.tutor} /> : <Rod key={k} color={COLORS.tutor} />))}
            </div>
            <span className={styles.groupLabel}>{count(total, blocks.unit)}</span>
          </div>
        </>
      )}
    </div>
  );
}
