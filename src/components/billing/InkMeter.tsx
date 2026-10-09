"use client";

import { useEffect } from "react";
import { InfinityIcon } from "lucide-react";
import { useAuth } from "@/components/AuthProvider";
import { InkBottle } from "@/components/billing/InkBottle";
import { openInkDialog } from "@/lib/billing/inkDialog";
import { INK_COPY, bottleFill, formatInk, inkTone } from "@/lib/billing/inkSummary";
import { UNLIMITED_METER_COPY, hasPlan, isUnlimited } from "@/lib/billing/unlimited";
import { useInkSummary } from "@/lib/billing/useInkSummary";
import { useUnlimited } from "@/lib/billing/useUnlimited";
import { isKidEmail } from "@/lib/family/contracts";
import { cn } from "@/lib/utils";

const TONE_CLASS = {
  ok: "border-input bg-white text-foreground hover:bg-accent",
  low: "border-amber-300 bg-amber-50 text-amber-900 hover:bg-amber-100",
  empty: "border-red-300 bg-red-50 text-red-800 hover:bg-red-100",
} as const;

const PILL = "inline-flex h-8 items-center gap-1.5 rounded-full border px-2.5 text-xs font-medium tabular-nums shadow-sm transition-colors";

/**
 * The board bar's ink meter: the bottle (its fill is the balance) and the number ("80 ink" on a
 * board 1024 px wide or more, `@5xl/bar`; the bottle and the number alone on a narrower one, so an
 * upright iPad's bar keeps one row; the aria-label always says "80 ink left"). A calm amber under
 * LOW_INK, red at zero. Tapping it opens the board's ink dialog (what the plan is doing, and its
 * fix) through openInkDialog, so the student never leaves the board. Hidden until the balance has
 * loaded, and silent on failure: the bar is not where a metering hiccup is explained.
 *
 * There is no free plan and no ink packs (2026-10-05). A count shows only while a plan is not
 * giving free help (a second plan before its first charge, a payment to fix): then help spends
 * that ink. Without a plan — the guided first board, the tour before the plan screen — there is
 * no meter: its starter ink is the tour's, not something to watch.
 *
 * With Agathon Unlimited on (trialing or active), help spends no ink, so the count would only
 * worry the student: the meter shows ∞ and "Unlimited" instead, quietly, and offers no packs (it
 * is not a button). The board is told the balance is unlimited, so an "out of ink" left over from
 * before the plan arrived clears and the refused help runs.
 *
 * A kid profile (src/lib/family) sees no meter at all: kids never see billing.
 */
export function InkMeter({ className, onBalance }: { className?: string; onBalance?: (balance: number) => void }) {
  const { user } = useAuth();
  const { summary } = useInkSummary();
  const { state } = useUnlimited();
  const unlimited = isUnlimited(state);
  const balance = summary?.balance ?? null;
  // The board clears a stale "out of ink" error here once ink is back (bought in another tab).
  useEffect(() => {
    if (balance === null) return;
    onBalance?.(unlimited ? Number.POSITIVE_INFINITY : balance);
  }, [balance, unlimited, onBalance]);
  if (!summary) return null;
  // A kid profile shares the grown-up's plan and never sees billing: no meter (as in the app bar),
  // so no way into the plan's dialog. The balance above still reaches the board.
  if (isKidEmail(user?.email)) return null;
  if (!unlimited && !hasPlan(state)) return null;
  if (unlimited) {
    return (
      <span
        role="status"
        data-testid="ink-meter"
        data-tone="unlimited"
        title={UNLIMITED_METER_COPY.label}
        aria-label={UNLIMITED_METER_COPY.label}
        className={cn(PILL, "border-input bg-white text-foreground", className)}
      >
        <InfinityIcon className="size-4 shrink-0" aria-hidden />
        <span className="hidden @5xl/bar:inline">{UNLIMITED_METER_COPY.word}</span>
      </span>
    );
  }
  const tone = inkTone(summary.balance);
  const label = INK_COPY.meterLabel(summary.balance);
  return (
    <button
      type="button"
      onClick={openInkDialog}
      data-testid="ink-meter"
      data-tone={tone}
      title={label}
      aria-label={label}
      className={cn(PILL, TONE_CLASS[tone], className)}
    >
      <InkBottle fill={bottleFill(summary.balance)} tone={tone} className="shrink-0" />
      <span>{formatInk(summary.balance)}</span>
      <span className="hidden @5xl/bar:inline">ink</span>
    </button>
  );
}
