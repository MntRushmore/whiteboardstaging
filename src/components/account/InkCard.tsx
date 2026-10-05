"use client";

import { AlertTriangle, OctagonAlert } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { InkBottle } from "@/components/billing/InkBottle";
import { SectionError } from "@/components/account/SectionError";
import { SECTION_BODY, SectionHeader } from "@/components/account/SectionHeader";
import { ACCOUNT_COPY } from "@/lib/billing/accountState";
import { INK_COPY, LOW_INK, bottleFill, formatInk, inkTone, type InkSummary } from "@/lib/billing/inkSummary";
import { inkPriceSentence } from "@/lib/billing/usage";
import { PLAN_COPY } from "@/lib/billing/unlimitedPlan";
import { cn } from "@/lib/utils";

/** Same amber and red as the meter, so "low" and "out" look alike across the app. */
const NOTICE_CLASS = {
  low: "bg-amber-50 border-amber-200 text-amber-900",
  empty: "bg-red-50 border-red-200 text-red-800",
} as const;

const STAT = "flex items-center justify-between gap-3 px-3 py-2";

/**
 * The ink you have, as the page's headline: a big bottle filled to the balance, the number, and
 * where it came from (the starter, packs bought, refunds taken back) and went (used), in plain
 * words. Ink never expires, so there is no reset date. A calm notice and "Get ink" (the packs
 * just below) when it runs low or out.
 *
 * With Agathon Unlimited on (`unlimited`), help spends none of it: no low or out-of-ink warning,
 * just a note that the ink is kept for later (a subscriber with 0 ink is not out of anything).
 */
export function InkCard({
  summary,
  error,
  refreshing = false,
  unlimited = false,
  onRetry,
}: {
  summary: InkSummary;
  /** A refresh failed after a successful load; the last good numbers stay on screen. */
  error?: string | null;
  refreshing?: boolean;
  /** Agathon Unlimited is on: the balance is not being spent. */
  unlimited?: boolean;
  onRetry: () => void;
}) {
  const tone = unlimited ? "ok" : inkTone(summary.balance);
  return (
    <Card data-tone={unlimited ? "unlimited" : tone}>
      <SectionHeader title="Ink" description="Ink pays for the tutor's work, and it never runs out on a date. Drawing on your own is always free." />
      <CardContent className={cn(SECTION_BODY, "space-y-5")}>
        {unlimited && (
          <div role="status" data-tone="unlimited" className="rounded-lg border border-indigo-200 bg-indigo-50 px-3 py-2 text-sm text-indigo-900">
            {PLAN_COPY.inkNote}
          </div>
        )}
        {tone !== "ok" && (
          <div role={tone === "empty" ? "alert" : "status"} data-tone={tone} className={cn("flex items-start gap-2 rounded-lg border px-3 py-2 text-sm", NOTICE_CLASS[tone])}>
            {tone === "empty" ? <OctagonAlert className="mt-0.5 size-4 shrink-0" /> : <AlertTriangle className="mt-0.5 size-4 shrink-0" />}
            <span>
              {tone === "empty"
                ? "You're out of ink. The tutor can't read new work until you add some."
                : `You have less than ${formatInk(LOW_INK)} ink left.`}{" "}
              <a href="#ink-packs" className="font-medium underline underline-offset-2">
                {INK_COPY.getInk}
              </a>
            </span>
          </div>
        )}

        <div className="flex flex-col items-center gap-5 sm:flex-row sm:items-center">
          <InkBottle size="lg" fill={bottleFill(summary.balance)} tone={tone} className="h-36 w-auto shrink-0 text-gray-700" />
          <div className="w-full min-w-0 flex-1">
            <p className="flex flex-wrap items-baseline gap-x-2">
              <span className="text-5xl font-semibold tracking-tight tabular-nums" data-testid="ink-balance">
                {formatInk(summary.balance)}
              </span>
              <span className="text-sm text-muted-foreground">ink left</span>
            </p>
            <dl className="mt-4 divide-y rounded-lg border text-sm" data-testid="ink-ledger">
              <div className={STAT}>
                <dt className="text-muted-foreground">Starter ink</dt>
                <dd className="font-medium tabular-nums">{summary.starter > 0 ? `+${formatInk(summary.starter)}` : "0"}</dd>
              </div>
              {summary.purchased > 0 && (
                <div className={STAT}>
                  <dt className="text-muted-foreground">
                    From {summary.purchases} pack{summary.purchases === 1 ? "" : "s"}
                  </dt>
                  <dd className="font-medium tabular-nums">+{formatInk(summary.purchased)}</dd>
                </div>
              )}
              {summary.granted - summary.starter - summary.purchased + summary.refunded !== 0 && (
                <div className={STAT}>
                  {/* a correction we made by hand can take ink away too (a lost chargeback) */}
                  <dt className="text-muted-foreground">
                    {summary.granted - summary.starter - summary.purchased + summary.refunded > 0 ? "Added by us" : "Adjusted by us"}
                  </dt>
                  <dd className="font-medium tabular-nums">
                    {signed(summary.granted - summary.starter - summary.purchased + summary.refunded)}
                  </dd>
                </div>
              )}
              {summary.refunded > 0 && (
                <div className={STAT}>
                  <dt className="text-muted-foreground">Taken back by refunds</dt>
                  <dd className="font-medium tabular-nums">−{formatInk(summary.refunded)}</dd>
                </div>
              )}
              <div className={STAT}>
                <dt className="text-muted-foreground">Used so far</dt>
                <dd className="font-medium tabular-nums">{summary.used > 0 ? `−${formatInk(summary.used)}` : "0"}</dd>
              </div>
            </dl>
            <p className="mt-2 text-xs text-muted-foreground">Ink never expires: what you don&apos;t use today is still here next month.</p>
          </div>
        </div>

        <div className="border-t pt-4">
          <h4 className="text-sm font-medium">What ink buys</h4>
          <p className="mt-1 text-sm text-muted-foreground">{inkPriceSentence()}</p>
        </div>

        {error && <SectionError kind="live.ink" code="balance_load_failed" title={ACCOUNT_COPY.loadFailedTitle} message={error} onRetry={onRetry} retrying={refreshing} />}
      </CardContent>
    </Card>
  );
}

/** "+25" / "−100" for a manual grant or correction. */
function signed(n: number): string {
  return n > 0 ? `+${formatInk(n)}` : `−${formatInk(-n)}`;
}
