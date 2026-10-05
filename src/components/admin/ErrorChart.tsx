"use client";

import { useState, type CSSProperties, type KeyboardEvent, type PointerEvent } from "react";
import type { ErrorChartView } from "@/lib/admin/view";
import styles from "./admin.module.css";

/**
 * The last 48 hours as stacked columns: errors on the baseline (red), warnings above them (amber),
 * a 2 px gap between, the current hour last. Plain CSS bars like the Progress page's chart (no
 * chart library). The legend names both colours; hover, tap or the arrow keys (once the chart has
 * focus) show one hour's numbers, which a screen reader hears too; "Show the numbers" lists every
 * hour that had something, so no value hides behind the tooltip.
 */
export function ErrorChart({ chart }: { chart: ErrorChartView }) {
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
  const height = shown ? shown.errorRatio + shown.warningRatio : 0;
  // the tooltip sits over its bar, held inside the chart at both ends
  const tipStyle: CSSProperties | undefined =
    active === null || !shown
      ? undefined
      : {
          bottom: `calc(${(Math.min(1, height) * 100).toFixed(2)}% + var(--space-2))`,
          ...(active < 8
            ? { left: `${(active / bars.length) * 100}%` }
            : active > last - 8
              ? { right: `${((last - active) / bars.length) * 100}%` }
              : { left: `${((active + 0.5) / bars.length) * 100}%`, transform: "translateX(-50%)" }),
        };
  const busy = bars.filter((b) => b.errors + b.warnings > 0);

  return (
    <div className={styles.chartWrap}>
      <ul className={styles.legend} aria-label="Legend">
        <li>
          <span aria-hidden className={styles.swatch} data-series="errors" />
          Errors
        </li>
        <li>
          <span aria-hidden className={styles.swatch} data-series="warnings" />
          Warnings
        </li>
      </ul>
      <div className={styles.chart}>
        <ul className={styles.ticks} aria-hidden>
          {chart.ticks.map((t) => (
            <li key={t.value} className={styles.tick} style={{ bottom: `${t.ratio * 100}%` }}>
              {t.label}
            </li>
          ))}
        </ul>
        <div
          className={styles.plot}
          role="group"
          aria-label="Errors and warnings each hour. Use the left and right arrow keys to hear each hour."
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
            <span key={t.value} aria-hidden className={styles.gridline} style={{ bottom: `${t.ratio * 100}%` }} />
          ))}
          {bars.map((b, i) => (
            <div key={b.hour} aria-hidden className={styles.slot} data-now={b.isNow || undefined} data-active={i === active || undefined}>
              <div className={styles.column}>
                {b.warnings > 0 && <div className={styles.segment} data-series="warnings" data-top style={{ height: `${(b.warningRatio * 100).toFixed(2)}%` }} />}
                {b.errors > 0 && (
                  <div className={styles.segment} data-series="errors" data-top={b.warnings === 0 || undefined} style={{ height: `${(b.errorRatio * 100).toFixed(2)}%` }} />
                )}
              </div>
            </div>
          ))}
          {shown && (
            <div aria-hidden className={styles.tooltip} style={tipStyle}>
              <span className={styles.tooltipRow}>
                <span className={styles.tooltipKey} data-series="errors" />
                <strong>{shown.errors}</strong> {shown.errors === 1 ? "error" : "errors"}
              </span>
              <span className={styles.tooltipRow}>
                <span className={styles.tooltipKey} data-series="warnings" />
                <strong>{shown.warnings}</strong> {shown.warnings === 1 ? "warning" : "warnings"}
              </span>
              <span className={styles.tooltipDay}>
                {shown.day}, {shown.time}
                {shown.isNow ? " (this hour)" : ""}
              </span>
            </div>
          )}
        </div>
        <ul className={styles.axis} aria-hidden>
          {bars.map((b, i) =>
            b.axisLabel ? (
              <li
                key={b.hour}
                className={styles.axisLabel}
                data-now={b.isNow || undefined}
                style={b.isNow ? undefined : { left: `${((i + 0.5) / bars.length) * 100}%` }}
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
      {busy.length > 0 && (
        <details className={styles.numbers}>
          <summary>Show the numbers</summary>
          <table className={styles.numbersTable}>
            <caption className={styles.srOnly}>Errors and warnings each hour with any, the last 48 hours</caption>
            <thead>
              <tr>
                <th scope="col">Hour</th>
                <th scope="col">Errors</th>
                <th scope="col">Warnings</th>
              </tr>
            </thead>
            <tbody>
              {busy.map((b) => (
                <tr key={b.hour}>
                  <th scope="row">
                    {b.day}, {b.time}
                  </th>
                  <td>{b.errors}</td>
                  <td>{b.warnings}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </details>
      )}
    </div>
  );
}
