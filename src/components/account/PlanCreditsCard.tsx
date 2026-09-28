"use client";

import { AlertTriangle, OctagonAlert } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { SectionError } from "@/components/account/SectionError";
import { SECTION_BODY, SectionHeader } from "@/components/account/SectionHeader";
import { ACCOUNT_COPY } from "@/lib/billing/accountState";
import { creditPriceSentence } from "@/lib/billing/usage";
import {
  allowanceLinesFor,
  creditsNoticeFor,
  formatCredits,
  monthlyTotal,
  periodEndLabel,
  remainingTone,
  resetSentenceFor,
  usedPercent,
  type CreditSummary,
} from "@/lib/billing/viewModel";
import { cn } from "@/lib/utils";

const BAR_CLASS = { ok: "bg-primary", low: "bg-amber-500", empty: "bg-red-500" } as const;

/** Same colours and icons as CreditsBanner, so "low" and "out" look alike across the app. */
const NOTICE_CLASS = {
  low: "bg-yellow-50 border-yellow-200 text-yellow-900",
  empty: "bg-red-50 border-red-200 text-red-800",
} as const;

/**
 * Credits left as the headline, a bar of what is used, the reset date, where this
 * month's total comes from (plan allowance + extra grants − used) in plain words,
 * what a credit buys, and a calm notice when credits run low or out.
 */
export function PlanCreditsCard({
  summary,
  error,
  refreshing = false,
  onRetry,
}: {
  summary: CreditSummary;
  /** A refresh failed after a successful load; the last good numbers stay on screen. */
  error?: string | null;
  refreshing?: boolean;
  onRetry: () => void;
}) {
  const tone = remainingTone(summary);
  const pct = usedPercent(summary);
  const total = monthlyTotal(summary);
  const resets = periodEndLabel(summary.period_end);
  const notice = creditsNoticeFor(summary);

  return (
    <Card data-tone={tone}>
      <SectionHeader
        title="Plan & credits"
        description="Credits pay for the tutor's work. Each month starts with a fresh allowance."
        aside={
          <span className="rounded-full border bg-muted px-2.5 py-0.5 text-xs font-medium" data-testid="plan-name">
            {summary.plan_name}
          </span>
        }
      />
      <CardContent className={cn(SECTION_BODY, "space-y-5")}>
        {notice && (
          <div
            role="status"
            data-tone={notice.tone}
            className={cn("flex items-start gap-2 rounded-lg border px-3 py-2 text-sm", NOTICE_CLASS[notice.tone])}
          >
            {notice.tone === "empty" ? (
              <OctagonAlert className="mt-0.5 w-4 h-4 shrink-0" />
            ) : (
              <AlertTriangle className="mt-0.5 w-4 h-4 shrink-0" />
            )}
            <span>{notice.message}</span>
          </div>
        )}

        <div>
          <p className="flex flex-wrap items-baseline gap-x-2">
            <span className="text-4xl font-semibold tracking-tight tabular-nums" data-testid="credits-remaining">
              {formatCredits(Math.max(0, summary.remaining))}
            </span>
            <span className="text-sm text-muted-foreground">
              credits left of {formatCredits(total)} this month
            </span>
          </p>
          <div
            className="mt-3 h-2 w-full overflow-hidden rounded-full bg-muted"
            role="progressbar"
            aria-label="Credits used this month"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={pct}
          >
            <div className={cn("h-full rounded-full transition-all", BAR_CLASS[tone])} style={{ width: `${pct}%` }} />
          </div>
          <div className="mt-2 flex justify-between gap-3 text-xs text-muted-foreground">
            <span className="tabular-nums">{formatCredits(summary.used)} used</span>
            {resets && <span>Resets on {resets}</span>}
          </div>
        </div>

        <div>
          <dl className="divide-y rounded-lg border text-sm" data-testid="credits-ledger">
            {allowanceLinesFor(summary).map((line) => (
              <div key={line.key} className="flex items-center justify-between gap-3 px-3 py-2">
                <dt className="text-muted-foreground">{line.label}</dt>
                <dd className="font-medium tabular-nums">{line.value}</dd>
              </div>
            ))}
          </dl>
          <p className="mt-2 text-xs text-muted-foreground">{resetSentenceFor(summary)}</p>
        </div>

        <div className="border-t pt-4">
          <h4 className="text-sm font-medium">What a credit buys</h4>
          <p className="mt-1 text-sm text-muted-foreground">{creditPriceSentence()}</p>
        </div>

        {error && (
          <SectionError title={ACCOUNT_COPY.loadFailedTitle} message={error} onRetry={onRetry} retrying={refreshing} />
        )}
      </CardContent>
    </Card>
  );
}
