"use client";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { SectionError } from "@/components/account/SectionError";
import { ACCOUNT_COPY } from "@/lib/billing/accountState";
import {
  formatCredits,
  monthlyTotal,
  periodEndLabel,
  remainingTone,
  usedPercent,
  type CreditSummary,
} from "@/lib/billing/viewModel";
import { cn } from "@/lib/utils";

const BAR_CLASS = { ok: "bg-primary", low: "bg-amber-500", empty: "bg-red-500" } as const;

/** Plan name, remaining / monthly with a bar, the reset date and this month's usage. */
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

  return (
    <Card data-tone={tone}>
      <CardHeader>
        <div className="flex items-center justify-between gap-3">
          <CardTitle>Plan &amp; credits</CardTitle>
          <span className="rounded-full border bg-muted px-2.5 py-0.5 text-xs font-medium">{summary.plan_name}</span>
        </div>
        <CardDescription>Credits are spent when the tutor does work for you and reset each month.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div>
          <div className="flex items-baseline justify-between gap-3">
            <p className="text-3xl font-semibold tabular-nums" data-testid="credits-remaining">
              {formatCredits(Math.max(0, summary.remaining))}
              <span className="ml-1 text-sm font-normal text-muted-foreground">/ {formatCredits(total)} credits</span>
            </p>
            {resets && <p className="text-sm text-muted-foreground">resets on {resets}</p>}
          </div>
          <div
            className="mt-2 h-2 w-full overflow-hidden rounded-full bg-muted"
            role="progressbar"
            aria-label="Credits used this month"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={pct}
          >
            <div className={cn("h-full rounded-full transition-all", BAR_CLASS[tone])} style={{ width: `${pct}%` }} />
          </div>
        </div>
        <dl className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-3">
          <div>
            <dt className="text-muted-foreground">Used this month</dt>
            <dd className="font-medium tabular-nums">{formatCredits(summary.used)}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">Monthly allowance</dt>
            <dd className="font-medium tabular-nums">{formatCredits(summary.monthly_credits)}</dd>
          </div>
          {summary.granted > 0 && (
            <div>
              <dt className="text-muted-foreground">Extra this month</dt>
              <dd className="font-medium tabular-nums">+{formatCredits(summary.granted)}</dd>
            </div>
          )}
        </dl>
        {error && (
          <SectionError title={ACCOUNT_COPY.loadFailedTitle} message={error} onRetry={onRetry} retrying={refreshing} />
        )}
      </CardContent>
    </Card>
  );
}
