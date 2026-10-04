"use client";

import { useState, type CSSProperties, type KeyboardEvent, type PointerEvent } from "react";
import type { ActivityChartView } from "@/lib/learning/progressView";
import styles from "./progress.module.css";

/**
 * The last 28 days as columns of minutes, today last on a faint band. Plain CSS bars (no chart
 * library): one series, so no legend; the scale's two gridlines are labelled on the left. Hover,
 * tap or the arrow keys (once the chart has focus) show one day's numbers; a screen reader hears
 * the same line, and the table under it lists every day. The sentence below says it in words.
 */
export function ActivityChart({ chart }: { chart: ActivityChartView }) {
  const [active, setActive] = useState<number | null>(null);
  const { bars } = chart;
  const last = bars.length - 1;

  function indexAt(e: PointerEvent<HTMLDivElement>): number {
    const rect = e.currentTarget.getBoundingClientRect();
    const x = Math.min(Math.max(e.clientX - rect.left, 0), rect.width - 1);
    return Math.min(last, Math.max(0, Math.floor((x / rect.width) * bars.length)));
  }

  function onKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    const from = active ?? last;
    let next: number | null = null;
    if (e.key === "ArrowLeft") next = Math.max(0, from - 1);
    else if (e.key === "ArrowRight") next = Math.min(last, from + 1);
    else if (e.key === "Home") next = 0;
    else if (e.key === "End") next = last;
    else if (e.key === "Escape") return setActive(null);
    if (next === null) return;
    e.preventDefault();
    setActive(next);
  }

  const shown = active === null ? null : bars[active];
  // the tooltip sits over its bar, held inside the chart at both ends
  const tipStyle: CSSProperties | undefined =
    active === null || !shown
      ? undefined
      : {
          bottom: `calc(${(shown.ratio * 100).toFixed(2)}% + var(--space-2))`,
          ...(active < 5
            ? { left: `${(active / bars.length) * 100}%` }
            : active > last - 5
              ? { right: `${((last - active) / bars.length) * 100}%` }
              : { left: `${((active + 0.5) / bars.length) * 100}%`, transform: "translateX(-50%)" }),
        };

  return (
    <div>
      <div className={styles.chart}>
        <ul className={styles.ticks} aria-hidden>
          {chart.ticks.map((t) => (
            <li key={t.minutes} className={styles.tick} style={{ bottom: `${t.ratio * 100}%` }}>
              {t.label}
            </li>
          ))}
        </ul>
        <div
          className={styles.plot}
          role="group"
          aria-label="Minutes of practice each day. Use the left and right arrow keys to hear each day."
          tabIndex={0}
          onKeyDown={onKeyDown}
          onFocus={() => setActive((a) => a ?? last)}
          onBlur={() => setActive(null)}
          onPointerMove={(e) => setActive(indexAt(e))}
          onPointerDown={(e) => setActive(indexAt(e))}
          onPointerLeave={(e) => {
            if (e.pointerType === "mouse") setActive(null);
          }}
        >
          {chart.ticks.map((t) => (
            <span key={t.minutes} aria-hidden className={styles.gridline} style={{ bottom: `${t.ratio * 100}%` }} />
          ))}
          {bars.map((b, i) => (
            <div key={b.date} aria-hidden className={styles.slot} data-today={b.isToday || undefined} data-active={i === active || undefined}>
              <div
                className={styles.bar}
                data-some={b.ratio > 0 || b.problems > 0 || undefined}
                style={{ height: `${(b.ratio * 100).toFixed(2)}%` }}
              />
            </div>
          ))}
          {shown && (
            <div aria-hidden className={styles.tooltip} style={tipStyle}>
              <span className={styles.tooltipValue}>{shown.value}</span>
              <br />
              <span className={styles.tooltipDay}>{shown.isToday ? `Today, ${shown.day}` : shown.day}</span>
            </div>
          )}
        </div>
        <ul className={styles.axis} aria-hidden>
          {bars.map((b, i) =>
            b.axisLabel ? (
              <li
                key={b.date}
                className={styles.axisLabel}
                data-today={b.isToday || undefined}
                data-edge={i === 0 ? "start" : b.isToday ? "end" : undefined}
                style={b.isToday ? undefined : { left: i === 0 ? 0 : `${((i + 0.5) / bars.length) * 100}%` }}
              >
                {b.axisLabel}
              </li>
            ) : null,
          )}
        </ul>
      </div>
      <p className={styles.srOnly} aria-live="polite">
        {shown ? shown.label : ""}
      </p>
      <p className={styles.chartSummary}>{chart.summary}</p>
      <table className={styles.srOnly}>
        <caption>Practice each day, the last 4 weeks</caption>
        <thead>
          <tr>
            <th scope="col">Day</th>
            <th scope="col">Minutes</th>
            <th scope="col">Problems</th>
          </tr>
        </thead>
        <tbody>
          {bars.map((b) => (
            <tr key={b.date}>
              <th scope="row">{b.isToday ? `Today, ${b.day}` : b.day}</th>
              <td>{b.minutes}</td>
              <td>{b.problems}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
