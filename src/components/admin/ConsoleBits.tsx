"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { Check, Copy, RefreshCw, ShieldCheck, TriangleAlert } from "lucide-react";
import { CONSOLE_COPY, type SparkView, type Tone } from "@/lib/admin/consoleView";
import { Button } from "@/registry/components/button/button";
import { EmptyState } from "@/registry/components/empty-state/empty-state";
import styles from "./admin.module.css";
import c from "./console.module.css";

/** A small rounded label in a tone: plans, statuses, outcomes. The words always say what the colour does. */
export function Pill({ tone = "neutral", icon, children, title }: { tone?: Tone; icon?: ReactNode; children: ReactNode; title?: string }) {
  return (
    <span className={c.pill} data-tone={tone} title={title}>
      {icon && (
        <span aria-hidden className={c.pillIcon}>
          {icon}
        </span>
      )}
      {children}
    </span>
  );
}

/** The "Admin" mark beside an admin account. */
export function AdminMark() {
  return (
    <Pill tone="neutral" icon={<ShieldCheck size={12} strokeWidth={2.2} />}>
      {CONSOLE_COPY.admin}
    </Pill>
  );
}

/** Initials in a soft circle, one of four tones per account. */
export function Avatar({ initials, tone, size = "md", live = false }: { initials: string; tone: 1 | 2 | 3 | 4; size?: "sm" | "md" | "lg"; live?: boolean }) {
  return (
    <span className={c.avatar} data-tone={tone} data-size={size} aria-hidden>
      {initials}
      {live && <span className={c.liveDot} />}
    </span>
  );
}

/** A pulsing green dot: live right now. */
export function LiveDot({ label }: { label?: string }) {
  return (
    <span className={c.liveMark}>
      <span className={c.pulse} aria-hidden />
      {label && <span>{label}</span>}
    </span>
  );
}

/** Copies `value`; says "Copied" for a moment. */
export function CopyButton({ value, label }: { value: string; label: string }) {
  const [state, setState] = useState<"idle" | "copied" | "failed">("idle");
  const timer = useRef<number | null>(null);
  useEffect(() => () => void (timer.current && window.clearTimeout(timer.current)), []);
  async function copy() {
    try {
      await navigator.clipboard.writeText(value);
      setState("copied");
    } catch {
      setState("failed");
    }
    if (timer.current) window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setState("idle"), 1600);
  }
  const said = state === "copied" ? CONSOLE_COPY.copied : state === "failed" ? CONSOLE_COPY.copyFailed : `${CONSOLE_COPY.copy} ${label}`;
  return (
    <button type="button" className={c.copy} onClick={copy} aria-label={said} title={said} data-state={state}>
      {state === "copied" ? <Check size={14} strokeWidth={2.2} aria-hidden /> : <Copy size={14} strokeWidth={1.9} aria-hidden />}
      <span className={styles.srOnly} aria-live="polite">
        {state === "idle" ? "" : said}
      </span>
    </button>
  );
}

/** Monospace text with a copy button beside it. */
export function Copyable({ value, shown, label }: { value: string; shown?: string; label: string }) {
  return (
    <span className={c.copyable}>
      <code title={value}>{shown ?? value}</code>
      <CopyButton value={value} label={label} />
    </span>
  );
}

/** Per-day bars, scaled to the busiest; the numbers in words for a screen reader and a tooltip per bar. */
export function Sparkline({ spark, label }: { spark: SparkView; label: string }) {
  return (
    <span className={c.spark} role="img" aria-label={`${label}: ${spark.summary}`}>
      {spark.bars.map((b) => (
        <span key={b.key} className={c.sparkBar} data-zero={b.value === 0 || undefined} style={{ height: `${Math.max(b.ratio * 100, b.value > 0 ? 12 : 0).toFixed(1)}%` }} title={b.label} />
      ))}
    </span>
  );
}

/** A read failed with nothing to show: what failed, and Try again. */
export function LoadFailed({ title, error, onRetry }: { title: string; error: string | null; onRetry: () => void }) {
  return (
    <div role="alert" className={styles.state}>
      <EmptyState
        icon={<TriangleAlert size={22} strokeWidth={1.6} />}
        title={title}
        description={error ?? CONSOLE_COPY.loadFallback}
        action={
          <Button variant="secondary" onClick={onRetry}>
            <RefreshCw size={15} strokeWidth={1.75} aria-hidden />
            {CONSOLE_COPY.retry}
          </Button>
        }
      />
    </div>
  );
}

/** Nothing here (yet): a calm box with a line or two. */
export function Empty({ icon, title, hint, action }: { icon: ReactNode; title: string; hint: string; action?: ReactNode }) {
  return (
    <div className={styles.state}>
      <EmptyState icon={icon} title={title} description={hint} action={action} />
    </div>
  );
}

/** Grey placeholder rows while the first read is out. */
export function SkeletonRows({ rows = 6, height = "3.5rem" }: { rows?: number; height?: string }) {
  return (
    <div className={c.skeletonRows} aria-hidden>
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className={styles.pulse} style={{ height, borderRadius: "var(--radius-control)" }} />
      ))}
    </div>
  );
}

/** Grey placeholder tiles (the board galleries). */
export function SkeletonTiles({ tiles = 8 }: { tiles?: number }) {
  return (
    <div className={c.skeletonTiles} aria-hidden>
      {Array.from({ length: tiles }, (_, i) => (
        <div key={i} className={`${styles.pulse} ${c.skeletonTile}`} />
      ))}
    </div>
  );
}

/** A toggle chip: a filter that is on or off, with how many it matches. */
export function Chip({ pressed, onToggle, count, tone, children }: { pressed: boolean; onToggle: () => void; count?: string; tone?: Tone; children: ReactNode }) {
  return (
    <button type="button" className={c.chip} aria-pressed={pressed} data-tone={tone} onClick={onToggle}>
      {tone && <span aria-hidden className={c.chipSwatch} />}
      <span>{children}</span>
      {count !== undefined && <span className={c.chipCount}>{count}</span>}
    </button>
  );
}

/**
 * A row of mutually exclusive choices with counts (the inbox's tabs, the issues' window): buttons
 * with aria-pressed, arrow keys to move along. Wraps to a scroller on a phone.
 */
export function ChoiceRow<K extends string>({
  label,
  options,
  value,
  onChange,
}: {
  label: string;
  options: readonly { key: K; label: string; count?: string; urgent?: boolean }[];
  value: K;
  onChange: (key: K) => void;
}) {
  const row = useRef<HTMLDivElement>(null);
  function onKeyDown(e: React.KeyboardEvent<HTMLButtonElement>) {
    const i = options.findIndex((o) => o.key === value);
    const next = e.key === "ArrowRight" ? Math.min(options.length - 1, i + 1) : e.key === "ArrowLeft" ? Math.max(0, i - 1) : e.key === "Home" ? 0 : e.key === "End" ? options.length - 1 : -1;
    if (next < 0 || next === i) return;
    e.preventDefault();
    onChange(options[next].key);
    row.current?.querySelectorAll<HTMLButtonElement>("button")[next]?.focus();
  }
  return (
    <div ref={row} role="group" aria-label={label} className={c.choices}>
      {options.map((o) => (
        <button key={o.key} type="button" className={c.choice} aria-pressed={o.key === value} tabIndex={o.key === value ? 0 : -1} onClick={() => onChange(o.key)} onKeyDown={onKeyDown}>
          <span>{o.label}</span>
          {o.count !== undefined && (
            <span className={c.choiceCount} data-urgent={o.urgent || undefined}>
              {o.count}
            </span>
          )}
        </button>
      ))}
    </div>
  );
}

/** A label and its value, as a definition list row. */
export function Facts({ facts }: { facts: readonly { key: string; label: string; value: string; title?: string; copy?: string }[] }) {
  return (
    <dl className={c.facts}>
      {facts.map((f) => (
        <div key={f.key} className={c.fact}>
          <dt>{f.label}</dt>
          <dd title={f.title || undefined}>{f.copy ? <Copyable value={f.copy} shown={f.value} label={f.label.toLowerCase()} /> : f.value}</dd>
        </div>
      ))}
    </dl>
  );
}
