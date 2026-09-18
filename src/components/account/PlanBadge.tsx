"use client";

import Link from "next/link";
import { Coins } from "lucide-react";
import { useCreditSummary } from "@/lib/billing/useCreditSummary";
import { ACCOUNT_PATH, formatCredits, remainingTone } from "@/lib/billing/viewModel";
import { cn } from "@/lib/utils";

const TONE_CLASS = {
  ok: "border-border bg-card text-foreground hover:bg-accent",
  low: "border-amber-300 bg-amber-50 text-amber-900 hover:bg-amber-100",
  empty: "border-red-300 bg-red-50 text-red-900 hover:bg-red-100",
} as const;

/**
 * Small "Free · 260 credits" pill for the dashboard header, linking to
 * /account. Hidden while loading and silent on failure: the header is not the
 * place to explain a metering hiccup, /account is.
 */
export function PlanBadge({ className }: { className?: string }) {
  const { summary } = useCreditSummary();
  if (!summary) return null;
  const tone = remainingTone(summary);
  return (
    <Link
      href={ACCOUNT_PATH}
      data-tone={tone}
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium transition-colors",
        TONE_CLASS[tone],
        className,
      )}
      title="Plan and credits"
    >
      <Coins className="w-3.5 h-3.5" />
      <span>{summary.plan_name}</span>
      <span aria-hidden className="opacity-50">
        ·
      </span>
      <span>{formatCredits(summary.remaining)} credits</span>
    </Link>
  );
}
