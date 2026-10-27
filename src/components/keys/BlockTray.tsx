"use client";

import type { BaseTenBlocks } from "@/lib/keys/shrink";
import styles from "./keys.module.css";

type RodKind = "carried" | "tutor" | "kid" | "empty";

/** One ten: a flat rod, coloured by whose it is. A new rod of the kid's drops in. */
function Rod({ kind, fresh = false }: { kind: RodKind; fresh?: boolean }) {
  return <span className={`${styles.rod} ${styles[`rod_${kind}`]} ${fresh ? styles.rodIn : ""}`} aria-hidden="true" />;
}

function tens(n: number): string {
  return n === 1 ? "1 ten" : `${n} tens`;
}

/**
 * Base-ten blocks for the smaller problem (docs/KEYS.md): the carried ten in tomato, the tutor's tens
 * in cobalt, and the box's group, which the kid builds (Space adds, Backspace takes away) in ink.
 * When the box is an addend, its group shows the room left up to the total as empty rods, so the kid
 * can see how many more make it.
 */
export function BlockTray({ blocks, built, total }: { blocks: BaseTenBlocks; built: number; total: number | null }) {
  const others = blocks.groups.filter((g) => !g.box).reduce((s, g) => s + g.count, 0);
  const room = total === null ? 0 : Math.max(0, total - others);
  return (
    <div className={styles.tray} aria-hidden="true">
      {blocks.groups.map((g, i) => {
        const count = g.box ? built : g.count;
        const kind: RodKind = g.box ? "kid" : g.carried ? "carried" : "tutor";
        // a box that is the total comes after "="; an addend box after "+"
        const op = i === 0 ? null : g.box && total === null ? "=" : "+";
        const empty = g.box ? Math.max(0, room - built) : 0;
        return (
          <div key={i} style={{ display: "contents" }}>
            {op && <span className={styles.trayOp}>{op}</span>}
            <div className={styles.group}>
              <div className={`${styles.rods} ${g.box ? styles.boxGroup : ""}`}>
                {Array.from({ length: count }, (_, k) => (
                  <Rod key={k} kind={kind} fresh={g.box && k === count - 1} />
                ))}
                {Array.from({ length: empty }, (_, k) => (
                  <Rod key={`e${k}`} kind="empty" />
                ))}
              </div>
              <span className={styles.groupLabel}>{g.box ? (built ? tens(built) : "How many more?") : g.carried ? "carried" : tens(g.count)}</span>
            </div>
          </div>
        );
      })}
      {total !== null && (
        <>
          <span className={styles.trayOp}>=</span>
          <span className={styles.trayTotal}>{tens(total)}</span>
        </>
      )}
    </div>
  );
}
