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

const POLL_MS = 60_000;

/**
 * Low / exhausted credits notice for the signed-in user, from their own
 * `credit_summary()` RPC. Hidden while credits are fine.
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
      className={`flex items-center gap-2 px-3 py-2 rounded-lg border text-sm ${
        isExhausted ? "bg-red-50 border-red-200 text-red-800" : "bg-yellow-50 border-yellow-200 text-yellow-900"
      } ${className}`}
      role="alert"
      data-state="visible"
      data-tone={tone}
      data-banner="credits"
    >
      {isExhausted ? (
        <OctagonAlert className="w-4 h-4 shrink-0" />
      ) : (
        <AlertTriangle className="w-4 h-4 shrink-0" />
      )}
      <span className="flex-1 min-w-0">{message}</span>
      <Link href={ACCOUNT_PATH} className="font-medium underline underline-offset-2 whitespace-nowrap">
        {BILLING_COPY.viewAccount}
      </Link>
    </div>
  );
}
