"use client";

import { useCallback } from "react";
import { supabase } from "@/lib/supabase";
import { Card, CardContent } from "@/components/ui/card";
import { SectionError } from "@/components/account/SectionError";
import { SECTION_BODY, SectionHeader } from "@/components/account/SectionHeader";
import { useSection } from "@/components/account/useSection";
import { parseInkPacks } from "@/lib/billing/inkPacks";
import { PURCHASES_COPY, PURCHASE_COLUMNS, parsePurchases, purchaseLinesFor, type PurchaseLine } from "@/lib/billing/purchases";
import { cn } from "@/lib/utils";

type HistoryRead = { lines: PurchaseLine[] };

/**
 * The student's own purchases (RLS: `ink_purchases: owner select`), the last 50, newest first,
 * with the pack's name from `ink_packs` (inactive packs included, so an old purchase keeps its
 * name).
 */
async function readHistory(): Promise<HistoryRead> {
  const [purchases, packs] = await Promise.all([
    supabase.from("ink_purchases").select(PURCHASE_COLUMNS).order("created_at", { ascending: false }).limit(50),
    supabase.from("ink_packs").select("id,name,ink,price_cents,sort,active"),
  ]);
  if (purchases.error) throw purchases.error;
  const names = Object.fromEntries(parseInkPacks(packs.data ?? []).map((p) => [p.id, p.name]));
  return { lines: purchaseLinesFor(parsePurchases(purchases.data), names) };
}

const STATUS_CLASS = {
  paid: "bg-emerald-50 text-emerald-800 border-emerald-200",
  partially_refunded: "bg-amber-50 text-amber-900 border-amber-200",
  refunded: "bg-muted text-muted-foreground",
} as const;

/** Purchase history: date, pack, ink, amount, and what a refund did to the ink. */
export function PurchaseHistory({ purchases }: { purchases?: number }) {
  const read = useCallback(() => {
    // Re-read whenever the summary's purchase count moves (a purchase landed while the page was open).
    void purchases;
    return readHistory();
  }, [purchases]);
  const { state, retry } = useSection<HistoryRead>(read, true, PURCHASES_COPY.fallback);
  const lines = state.data?.lines ?? [];

  return (
    <Card>
      <SectionHeader title={PURCHASES_COPY.title} description={PURCHASES_COPY.description} />
      <CardContent className={SECTION_BODY}>
        {state.status === "loading" && !state.data ? (
          <div className="space-y-2" data-state="loading" aria-busy>
            {[1, 2].map((i) => (
              <div key={i} className="h-10 animate-pulse rounded-md bg-muted/60" />
            ))}
          </div>
        ) : state.status === "error" && !state.data ? (
          <SectionError kind="live.ink" code="purchases_load_failed" title={PURCHASES_COPY.failedTitle} message={state.error} onRetry={retry} />
        ) : lines.length === 0 ? (
          <div className="rounded-lg border border-dashed px-4 py-6 text-center" data-state="empty">
            <p className="text-sm font-medium">{PURCHASES_COPY.empty}</p>
            <p className="mt-1 text-sm text-muted-foreground">{PURCHASES_COPY.emptyHint}</p>
          </div>
        ) : (
          <ul className="divide-y" data-state="list" data-testid="purchase-history">
            {lines.map((line) => (
              <li key={line.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2.5 text-sm" data-status={line.status}>
                <span className="w-28 shrink-0 text-muted-foreground tabular-nums">{line.date}</span>
                <span className="min-w-0 flex-1 font-medium">
                  {line.pack}
                  <span className={cn("ml-2 font-normal tabular-nums", line.status === "refunded" ? "text-muted-foreground line-through" : "text-emerald-700")}>{line.ink}</span>
                  {line.refundNote && <span className="block text-xs font-normal text-muted-foreground">{line.refundNote}</span>}
                </span>
                <span className="tabular-nums">{line.amount}</span>
                <span className={cn("rounded-full border px-2 py-0.5 text-xs font-medium", STATUS_CLASS[line.status])}>{line.statusLabel}</span>
              </li>
            ))}
          </ul>
        )}
        {state.status === "error" && state.data && <SectionError className="mt-3" kind="live.ink" code="purchases_load_failed" title={PURCHASES_COPY.failedTitle} message={state.error} onRetry={retry} />}
      </CardContent>
    </Card>
  );
}
