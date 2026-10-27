"use client";

import type { BaseTenBlocks } from "@/lib/keys/shrink";
import styles from "./keys.module.css";

type BlockKind = "carried" | "tutor" | "kid" | "empty";

/** One block, flat and coloured by whose it is: a rod (a ten) or a cube (a one). A new one of the kid's drops in. */
function Block({ kind, unit, fresh = false }: { kind: BlockKind; unit: "ten" | "one"; fresh?: boolean }) {
  return <span className={`${unit === "one" ? styles.cube : styles.rod} ${styles[`rod_${kind}`]} ${fresh ? styles.rodIn : ""}`} aria-hidden="true" />;
}

function count(n: number, unit: "ten" | "one"): string {
  return n === 1 ? `1 ${unit}` : `${n} ${unit}s`;
}

/**
 * Base-ten blocks for the smaller problem (docs/KEYS.md): rods (tens) or cubes (ones); the carried or
 * lent group in tomato, the tutor's in cobalt, and the box's group, which the kid builds (Space adds,
 * Backspace takes away) in ink. A group may carry its own sign (`−` when taking away). When the box is
 * an addend of a sum, its group shows the room left up to the total as empty blocks, so the kid can
 * see how many more make it.
 */
export function BlockTray({ blocks, built, total }: { blocks: BaseTenBlocks; built: number; total: number | null }) {
  const unit = blocks.unit;
  const adding = blocks.groups.every((g) => !g.op || g.op === "+");
  const others = blocks.groups.filter((g) => !g.box).reduce((s, g) => s + g.count, 0);
  const room = total === null || !adding ? 0 : Math.max(0, total - others);
  return (
    <div className={styles.tray} aria-hidden="true">
      {blocks.groups.map((g, i) => {
        const n = g.box ? built : g.count;
        const kind: BlockKind = g.box ? "kid" : g.carried ? "carried" : "tutor";
        // a group's own sign (taking away); else a box that is the total comes after "=", an addend after "+"
        const op = i === 0 ? null : (g.op ?? (g.box && total === null ? "=" : "+"));
        const empty = g.box ? Math.max(0, room - built) : 0;
        return (
          <div key={i} style={{ display: "contents" }}>
            {op && <span className={styles.trayOp}>{op}</span>}
            <div className={styles.group}>
              <div className={`${styles.rods} ${g.box ? styles.boxGroup : ""} ${unit === "one" ? styles.cubes : ""}`}>
                {Array.from({ length: n }, (_, k) => (
                  <Block key={k} kind={kind} unit={unit} fresh={g.box && k === n - 1} />
                ))}
                {Array.from({ length: empty }, (_, k) => (
                  <Block key={`e${k}`} kind="empty" unit={unit} />
                ))}
              </div>
              <span className={styles.groupLabel}>
                {g.box ? (built ? count(built, unit) : room ? "How many more?" : "?") : g.carried ? (unit === "one" && g.count === 10 ? "1 ten as 10 ones" : "carried") : count(g.count, unit)}
              </span>
            </div>
          </div>
        );
      })}
      {total !== null && (
        <>
          <span className={styles.trayOp}>=</span>
          <span className={styles.trayTotal}>{count(total, unit)}</span>
        </>
      )}
    </div>
  );
}
