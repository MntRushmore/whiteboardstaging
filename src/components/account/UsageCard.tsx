"use client";

import { useCallback, useId, useState } from "react";
import { ChevronRight } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { SectionError } from "@/components/account/SectionError";
import { SECTION_BODY, SectionHeader } from "@/components/account/SectionHeader";
import { useSection } from "@/components/account/useSection";
import { ACCOUNT_COPY } from "@/lib/billing/accountState";
import {
  USAGE_WINDOW_DAYS,
  localDayKey,
  parseUsageDayRows,
  runtimeTimeZone,
  usageSummaryFor,
  type UsageDay,
  type UsageDayRow,
  type UsageKindTotal,
} from "@/lib/billing/usage";
import { formatInk, inkLabel } from "@/lib/billing/inkSummary";
import { cn } from "@/lib/utils";

/** Days shown before "Show earlier days"; a busy month has ~30. */
const USAGE_DAYS_SHOWN = 7;

type UsageRead = { rows: UsageDayRow[]; timeZone: string };

/**
 * The last 30 days of usage from the RPC `usage_by_day(p_time_zone, p_days)`, grouped in the
 * database (a month can be thousands of ledger rows). The RPC is SECURITY INVOKER
 * over `usage_events`, whose RLS policy limits it to the caller's own rows. A zone
 * Postgres does not know (22023) is retried once in UTC, and the days are then
 * labelled in UTC too.
 */
async function readUsage(): Promise<UsageRead> {
  const zone = runtimeTimeZone();
  const first = await supabase.rpc("usage_by_day", { p_time_zone: zone, p_days: USAGE_WINDOW_DAYS });
  if (!first.error) return { rows: parseUsageDayRows(first.data), timeZone: zone };
  if (first.error.code !== "22023" || zone === "UTC") throw first.error;
  const utc = await supabase.rpc("usage_by_day", { p_time_zone: "UTC", p_days: USAGE_WINDOW_DAYS });
  if (utc.error) throw utc.error;
  return { rows: parseUsageDayRows(utc.data), timeZone: "UTC" };
}

/**
 * "Handwriting reading · 342 reads ........ 342 ink". On a phone the count drops
 * to its own line instead of wrapping mid-phrase. With `share`, a thin bar shows the
 * kind's part of the window; `nested` is the lighter variant inside an open day.
 */
function KindRow({ kind, share, nested = false }: { kind: UsageKindTotal; share?: number; nested?: boolean }) {
  return (
    <li className={nested ? "py-2" : undefined} data-kind={kind.key}>
      <div className="flex items-baseline justify-between gap-3 text-sm">
        <span className="min-w-0">
          <span className={nested ? undefined : "font-medium"}>{kind.label}</span>
          <span className="hidden text-muted-foreground sm:inline"> · </span>
          <span className="block text-xs text-muted-foreground sm:inline sm:text-sm">{kind.countLabel}</span>
        </span>
        <span className={cn("shrink-0 tabular-nums", nested && "text-muted-foreground")}>{inkLabel(kind.ink)}</span>
      </div>
      {share !== undefined && (
        <div className="mt-1.5 h-1 w-full overflow-hidden rounded-full bg-muted" aria-hidden>
          <div className="h-full rounded-full bg-primary/60" style={{ width: `${Math.max(1, Math.round(share * 100))}%` }} />
        </div>
      )}
    </li>
  );
}

function DayRow({ day }: { day: UsageDay }) {
  const [open, setOpen] = useState(false);
  const panelId = useId();
  return (
    <li data-day={day.day} data-open={open}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-controls={panelId}
        className="-mx-2 flex w-[calc(100%+1rem)] items-center gap-2 rounded-md px-2 py-2.5 text-left text-sm transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <ChevronRight
          className={cn("w-4 h-4 shrink-0 text-muted-foreground transition-transform", open && "rotate-90")}
          aria-hidden
        />
        <span className="min-w-0 flex-1">
          <span className="font-medium">{day.label}</span>
          {day.date && <span className="text-muted-foreground"> · {day.date}</span>}
        </span>
        <span className="shrink-0 tabular-nums">{inkLabel(day.ink)}</span>
      </button>
      {open && (
        <ul id={panelId} className="mb-2 ml-2 border-l pl-4" data-state="expanded">
          {day.kinds.map((kind) => (
            <KindRow key={kind.key} kind={kind} nested />
          ))}
        </ul>
      )}
    </li>
  );
}

function UsageSkeleton() {
  return (
    <div className="space-y-5" data-state="loading" aria-busy>
      <div className="space-y-3">
        {[1, 2, 3].map((i) => (
          <div key={i} className="space-y-1.5">
            <div className="flex justify-between gap-3">
              <div className="h-4 w-48 animate-pulse rounded bg-muted" />
              <div className="h-4 w-16 animate-pulse rounded bg-muted" />
            </div>
            <div className="h-1 w-full animate-pulse rounded-full bg-muted" />
          </div>
        ))}
      </div>
      <div className="space-y-2">
        {[1, 2, 3].map((i) => (
          <div key={i} className="h-9 animate-pulse rounded-md bg-muted/60" />
        ))}
      </div>
    </div>
  );
}

const SUBHEAD = "text-xs font-medium uppercase tracking-wide text-muted-foreground";

/**
 * The last 30 days of usage: totals by kind of work (with each kind's share), then one row
 * per day, newest first, that expands to that day's kinds. Individual ledger rows
 * are not shown: a busy day is hundreds of identical one-ink reads.
 */
export function UsageCard({ usedInk }: { usedInk?: number }) {
  const read = useCallback(() => {
    // Re-read whenever the Ink card's `used` moves (it refreshes on window focus), so the two agree.
    void usedInk;
    return readUsage();
  }, [usedInk]);
  const { state, retry } = useSection<UsageRead>(read, true, ACCOUNT_COPY.usageFallback);
  const [showAll, setShowAll] = useState(false);

  const data = state.data;
  const summary = data ? usageSummaryFor(data.rows, localDayKey(new Date(), data.timeZone)) : null;
  const days = summary ? (showAll ? summary.days : summary.days.slice(0, USAGE_DAYS_SHOWN)) : [];
  const hidden = summary ? summary.days.length - days.length : 0;

  return (
    <Card>
      <SectionHeader
        title="Usage"
        description="What your ink went to in the last 30 days."
        aside={
          summary && summary.ink > 0 ? (
            <span className="text-sm font-medium tabular-nums" data-testid="usage-total">
              {inkLabel(summary.ink)}
            </span>
          ) : undefined
        }
      />
      <CardContent className={SECTION_BODY}>
        {state.status === "loading" && !data ? (
          <UsageSkeleton />
        ) : state.status === "error" && !data ? (
          <SectionError title={ACCOUNT_COPY.usageFailedTitle} message={state.error} onRetry={retry} />
        ) : !summary || summary.days.length === 0 ? (
          <div className="space-y-3">
            <div className="rounded-lg border border-dashed px-4 py-8 text-center" data-state="empty">
              <p className="text-sm font-medium">{ACCOUNT_COPY.usageEmpty}</p>
              <p className="mt-1 text-sm text-muted-foreground">{ACCOUNT_COPY.usageEmptyHint}</p>
            </div>
            {state.status === "error" && (
              <SectionError title={ACCOUNT_COPY.usageFailedTitle} message={state.error} onRetry={retry} />
            )}
          </div>
        ) : (
          <div className="space-y-6" data-state="list">
            <section aria-label="The last 30 days by kind">
              <h4 className={SUBHEAD}>By kind</h4>
              <ul className="mt-3 space-y-3.5">
                {summary.kinds.map((kind) => (
                  <KindRow key={kind.key} kind={kind} share={summary.ink > 0 ? kind.ink / summary.ink : 0} />
                ))}
              </ul>
            </section>

            <section aria-label="The last 30 days by day">
              <h4 className={SUBHEAD}>By day</h4>
              <ul className="mt-1 divide-y">
                {days.map((day) => (
                  <DayRow key={day.day} day={day} />
                ))}
              </ul>
              {hidden > 0 && (
                <Button variant="ghost" size="sm" className="mt-1 -ml-2 text-muted-foreground" onClick={() => setShowAll(true)}>
                  Show {formatInk(hidden)} earlier day{hidden === 1 ? "" : "s"}
                </Button>
              )}
            </section>

            {state.status === "error" && (
              <SectionError title={ACCOUNT_COPY.usageFailedTitle} message={state.error} onRetry={retry} />
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
