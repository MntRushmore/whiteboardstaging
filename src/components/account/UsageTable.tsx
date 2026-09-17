"use client";

import { useCallback } from "react";
import { supabase } from "@/lib/supabase";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { SectionError } from "@/components/account/SectionError";
import { useSection } from "@/components/account/useSection";
import { ACCOUNT_COPY } from "@/lib/billing/accountState";
import { formatCredits, usageRowsFor, type UsageEvent } from "@/lib/billing/viewModel";

export const USAGE_PAGE_SIZE = 50;

/**
 * The user's last 50 metered calls. `usage_events` is RLS-protected (select
 * own), so no user filter is needed here; the query is scoped by the JWT.
 */
export function UsageTable({ userId }: { userId: string }) {
  const read = useCallback(async (): Promise<UsageEvent[]> => {
    const { data, error } = await supabase
      .from("usage_events")
      .select("*")
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .limit(USAGE_PAGE_SIZE);
    if (error) throw error;
    return (data ?? []) as UsageEvent[];
  }, [userId]);
  const { state, retry } = useSection<UsageEvent[]>(read, true, ACCOUNT_COPY.usageFallback);
  const rows = usageRowsFor(state.data ?? []);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Usage</CardTitle>
        <CardDescription>Your most recent {USAGE_PAGE_SIZE} credit charges, newest first.</CardDescription>
      </CardHeader>
      <CardContent>
        {state.status === "loading" && !state.data ? (
          <div className="space-y-2" data-state="loading">
            {[1, 2, 3, 4].map((i) => (
              <div key={i} className="h-8 animate-pulse rounded bg-muted/50" />
            ))}
          </div>
        ) : state.status === "error" && !state.data ? (
          <SectionError title={ACCOUNT_COPY.usageFailedTitle} message={state.error} onRetry={retry} />
        ) : rows.length === 0 ? (
          <p className="text-sm text-muted-foreground" data-state="empty">
            {ACCOUNT_COPY.usageEmpty}
          </p>
        ) : (
          <div className="space-y-3">
            <div className="overflow-x-auto" data-state="list">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-left text-xs uppercase tracking-wide text-muted-foreground">
                    <th className="py-2 pr-3 font-medium">When</th>
                    <th className="py-2 pr-3 font-medium">What</th>
                    <th className="py-2 text-right font-medium">Credits</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row) => (
                    <tr key={row.id} className="border-b last:border-0">
                      <td className="py-2 pr-3 whitespace-nowrap text-muted-foreground">
                        {row.whenIso ? <time dateTime={row.whenIso}>{row.when}</time> : "—"}
                      </td>
                      <td className="py-2 pr-3">{row.what}</td>
                      <td className="py-2 text-right tabular-nums">{formatCredits(row.credits)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {state.status === "error" && state.data && (
              <SectionError title={ACCOUNT_COPY.usageFailedTitle} message={state.error} onRetry={retry} />
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
