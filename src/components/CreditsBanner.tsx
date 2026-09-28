"use client";

import Link from "next/link";
import { AlertTriangle, OctagonAlert } from "lucide-react";
import { useCreditSummary } from "@/lib/billing/useCreditSummary";
import {
  ACCOUNT_PATH,
  BILLING_COPY,
  bannerMessageFor,
  creditsBannerStateFor,
  remainingTone,
} from "@/lib/billing/viewModel";
import { cn } from "@/lib/utils";

const POLL_MS = 60_000;

/**
 * The header credits chip's colours (AppHeader CHIP_TONE), so "low" reads the same everywhere:
 * amber at 10 % or less of the month's credits, red when they are gone.
 */
const TONE_CLASS = {
  low: "border-amber-300 bg-amber-50 text-amber-900",
  empty: "border-red-300 bg-red-50 text-red-900",
} as const;

/**
 * Low / exhausted credits notice for the signed-in user, from their own
 * `credit_summary()` RPC. Hidden while credits are fine.
 *
 * Low credits are a nudge, not an alarm: same threshold and amber as the header chip
 * (remainingTone), announced politely (`role="status"`). Only "out of credits" is an alert.
 *
 * This component no longer calls GET /api/credits: that route reports the
 * OPERATOR's OpenRouter balance and stays available for operators/smoke
 * tests, but a student's banner is about their own monthly credits.
 */
export function CreditsBanner({ className = "" }: { className?: string }) {
  const { summary, error } = useCreditSummary({ pollMs: POLL_MS });

  // Hidden on failure by design: the banner is advisory, and the request also
  // fails when signed out. The state is still explicit in the DOM so it is
  // visible *why* nothing rendered; the next poll retries.
  const state = creditsBannerStateFor(summary, !!error && !summary);
  if (state === "hidden-error") {
    return <span hidden data-state="hidden-error" data-banner="credits" />;
  }
  const message = bannerMessageFor(summary);
  if (state !== "visible" || !summary || !message) return null;

  const tone = remainingTone(summary);
  const isExhausted = tone === "empty";

  return (
    <div
      className={cn(
        "flex items-center gap-2 rounded-lg border px-3 text-sm",
        isExhausted ? "py-2" : "py-1.5 text-xs",
        isExhausted ? TONE_CLASS.empty : TONE_CLASS.low,
        className,
      )}
      role={isExhausted ? "alert" : "status"}
      data-state="visible"
      data-tone={tone}
      data-banner="credits"
    >
      {isExhausted ? (
        <OctagonAlert className="w-4 h-4 shrink-0" />
      ) : (
        <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
      )}
      <span className="flex-1 min-w-0">{message}</span>
      <Link href={ACCOUNT_PATH} className="font-medium underline underline-offset-2 whitespace-nowrap">
        {isExhausted ? BILLING_COPY.seePlans : BILLING_COPY.viewAccount}
      </Link>
    </div>
  );
}
