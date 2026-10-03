"use client";

import { InkBottle } from "@/components/billing/InkBottle";
import { openInkDialog } from "@/lib/billing/inkDialog";
import { INK_COPY, bottleFill, formatInk, inkTone } from "@/lib/billing/inkSummary";
import { useInkSummary } from "@/lib/billing/useInkSummary";
import { cn } from "@/lib/utils";

const TONE_CLASS = {
  ok: "border-input bg-white text-foreground hover:bg-accent",
  low: "border-amber-300 bg-amber-50 text-amber-900 hover:bg-amber-100",
  empty: "border-red-300 bg-red-50 text-red-800 hover:bg-red-100",
} as const;

/**
 * The board bar's ink meter: the bottle (its fill is the balance) and the number. A calm amber
 * with "Get ink" under LOW_INK, red at zero. Tapping it opens the board's ink dialog (the packs,
 * bought in a new tab) through openInkDialog, so the student never leaves the board. Hidden until
 * the balance has loaded, and silent on failure: the bar is not where a metering hiccup is
 * explained. The balance re-reads on focus, on return to the tab and after a checkout
 * (useInkSummary), so bought ink appears without a reload.
 */
export function InkMeter({ className }: { className?: string }) {
  const { summary } = useInkSummary();
  if (!summary) return null;
  const tone = inkTone(summary.balance);
  const label = INK_COPY.meterLabel(summary.balance);
  return (
    <button
      type="button"
      onClick={openInkDialog}
      data-testid="ink-meter"
      data-tone={tone}
      title={tone === "ok" ? label : `${label}: ${INK_COPY.getInk.toLowerCase()}`}
      aria-label={tone === "ok" ? label : `${label}. ${INK_COPY.getInk}`}
      className={cn(
        "inline-flex h-8 items-center gap-1.5 rounded-full border px-2.5 text-xs font-medium tabular-nums shadow-sm transition-colors",
        TONE_CLASS[tone],
        className,
      )}
    >
      <InkBottle fill={bottleFill(summary.balance)} tone={tone} className="shrink-0" />
      <span>{formatInk(summary.balance)}</span>
      <span className="hidden sm:inline">ink</span>
      {tone !== "ok" && <span className="ml-0.5 font-semibold underline underline-offset-2">{INK_COPY.getInk}</span>}
    </button>
  );
}
