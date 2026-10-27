"use client";

import type { AreaModel, FractionBars, Manipulative, NumberLine } from "@/lib/keys/shrink";
import { BlockTray } from "./BlockTray";
import styles from "./keys.module.css";

const COBALT = "#2D5BFF";
const TOMATO = "#FF5A36";
const INK = "#14151F";
const EMPTY = "#E2E4EB";

/**
 * Fraction bars (docs/KEYS.md, Phase 3): the tutor's bar with its parts shaded in cobalt (and tomato
 * for the second fraction), and the kid's bar under it, shaded one part per Space. An equivalent
 * fraction shows the bar to match above.
 */
function FractionBarTray({ bars, built }: { bars: FractionBars; built: number }) {
  const width = Math.min(520, Math.max(240, bars.parts * 34));
  const bar = (parts: number, fill: (i: number) => string, label: string) => (
    <div className={styles.barRow}>
      <svg className={styles.fit} style={{ maxWidth: width }} viewBox={`0 0 ${width} 34`} aria-hidden="true">
        {Array.from({ length: parts }, (_, i) => {
          const w = width / parts;
          return <rect key={i} x={i * w + 1} y="1" width={w - 2} height="32" rx="5" fill={fill(i)} />;
        })}
      </svg>
      <span className={styles.groupLabel}>{label}</span>
    </div>
  );
  const tutor = bars.shaded.flatMap((g) => Array.from({ length: g.count }, () => (g.carried ? TOMATO : COBALT)));
  const shown = bars.shaded.reduce((n, g) => n + g.count, 0);
  return (
    <div className={styles.bars} aria-hidden="true">
      {bars.match && bar(bars.match.parts, (i) => (i < bars.match!.shaded ? COBALT : EMPTY), `${bars.match.shaded} of ${bars.match.parts}`)}
      {tutor.length > 0 && bar(bars.parts, (i) => tutor[i] ?? EMPTY, `${shown} of ${bars.parts}`)}
      {bar(bars.parts, (i) => (i < built ? INK : EMPTY), built ? `yours: ${built} of ${bars.parts}` : "yours: Space shades a part")}
    </div>
  );
}

/** A number line: ticks, the start in cobalt, the kid's marker in ink (← → move it). */
function NumberLineTray({ line, value }: { line: NumberLine; value: number | null }) {
  const n = line.max - line.min;
  const width = Math.min(560, Math.max(280, n * 26));
  const x = (v: number) => 16 + ((v - line.min) / n) * (width - 32);
  return (
    <div className={styles.tray} style={{ width: "100%", maxWidth: width }} aria-hidden="true">
      <svg className={styles.fit} viewBox={`0 0 ${width} 74`}>
        <line x1="10" y1="40" x2={width - 10} y2="40" stroke={INK} strokeWidth="2.5" strokeLinecap="round" />
        {Array.from({ length: n + 1 }, (_, i) => {
          const v = line.min + i;
          const big = v % 5 === 0;
          return (
            <g key={v}>
              <line x1={x(v)} y1={big ? 32 : 35} x2={x(v)} y2={big ? 48 : 45} stroke={INK} strokeWidth={big ? 2.5 : 1.5} />
              {(big || v === line.start) && (
                <text x={x(v)} y="68" textAnchor="middle" fontSize="13" fill={v === line.start ? COBALT : "#5B5E6E"} fontWeight={v === line.start ? 700 : 400}>
                  {v}
                </text>
              )}
            </g>
          );
        })}
        <circle cx={x(line.start)} cy="40" r="7" fill={COBALT} />
        {value !== null && value !== line.start && (
          <path d={`M${x(line.start)} 30 Q ${(x(line.start) + x(value)) / 2} ${4} ${x(value)} 30`} fill="none" stroke={TOMATO} strokeWidth="3" strokeLinecap="round" />
        )}
        {value !== null && <path d={`M${x(value) - 8} 14 L${x(value) + 8} 14 L${x(value)} 28 Z`} fill={INK} />}
      </svg>
    </div>
  );
}

/** An area model: rows × cols squares, the split in tomato, the rows the kid has shaded in ink. */
function AreaTray({ area, built }: { area: AreaModel; built: number }) {
  const size = Math.max(10, Math.min(22, Math.floor(240 / Math.max(area.cols, area.rows))));
  const rows = Math.floor(built / area.cols);
  const w = area.cols * size;
  const h = area.rows * size;
  return (
    <div className={styles.tray} aria-hidden="true">
      <div className={styles.group}>
        <svg width={w + 2} height={h + 2} viewBox={`0 0 ${w + 2} ${h + 2}`}>
          {Array.from({ length: area.rows * area.cols }, (_, k) => {
            const r = Math.floor(k / area.cols);
            const c = k % area.cols;
            const fill = r < rows ? INK : c < area.split || !area.split ? "#D9E1FF" : "#FFE0D7";
            return <rect key={k} x={1 + c * size + 1} y={1 + r * size + 1} width={size - 2} height={size - 2} rx="2" fill={fill} />;
          })}
          {area.split > 0 && <line x1={1 + area.split * size} y1="0" x2={1 + area.split * size} y2={h + 2} stroke={TOMATO} strokeWidth="2.5" />}
        </svg>
        <span className={styles.groupLabel}>
          {rows} {rows === 1 ? "row" : "rows"} of {area.cols}
        </span>
      </div>
    </div>
  );
}

/** The smaller problem's manipulative, drawn from the box's value (`built`). */
export function ManipulativeTray({ m, built, total }: { m: Manipulative; built: number | null; total: number | null }) {
  switch (m.kind) {
    case "base_ten":
      return <BlockTray blocks={m} built={built ?? 0} total={total} />;
    case "fraction_bar":
      return <FractionBarTray bars={m} built={built ?? 0} />;
    case "number_line":
      return <NumberLineTray line={m} value={built} />;
    case "area":
      return <AreaTray area={m} built={built ?? 0} />;
  }
}

/** What the keys do on this manipulative, for the hint under the smaller problem's lead. */
export function manipulativeHint(m: Manipulative | null): string {
  switch (m?.kind) {
    case "base_ten":
      return m.unit === "ten" ? "Space adds a ten. Backspace takes one away. Enter checks it." : "Space adds a one. Backspace takes one away. Enter checks it.";
    case "fraction_bar":
      return "Space shades a part. Backspace takes one away. Enter checks it.";
    case "number_line":
      return "← → move along the line. Enter checks it.";
    case "area":
      return "Space adds a row. Backspace takes one away. Enter checks it.";
    default:
      return "Type the number. Enter checks it.";
  }
}
