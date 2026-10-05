"use client";

import { useCallback } from "react";
import { ExternalLink } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { SectionError } from "@/components/account/SectionError";
import { SECTION_BODY, SectionHeader } from "@/components/account/SectionHeader";
import { useSection } from "@/components/account/useSection";
import { payerLinks, type Payer } from "@/lib/billing/checkout";
import { PACKS_COPY, allComingSoon, packCardsFor, parseInkPacks, type InkPack, type PackCard } from "@/lib/billing/inkPacks";
import { billingLinks } from "@/lib/billing/links";
import { watchInkCheckout } from "@/lib/billing/useInkSummary";
import { cn } from "@/lib/utils";

async function readPacks(): Promise<InkPack[]> {
  const { data, error } = await supabase.from("ink_packs").select("id,name,ink,price_cents,sort,active").eq("active", true).order("sort");
  if (error) throw error;
  return parseInkPacks(data);
}

function BuyButton({ card, lastPurchaseId }: { card: PackCard; lastPurchaseId: number | null }) {
  if (!card.href) {
    return (
      <Button variant="outline" size="sm" className="w-full" disabled aria-disabled>
        {PACKS_COPY.comingSoon}
      </Button>
    );
  }
  // Same tab: the Payment Link comes back to /account?ink=<pack>, where InkReturnNotice waits for it.
  return (
    <Button asChild variant={card.bestValue ? "default" : "outline"} size="sm" className="w-full">
      <a href={card.href} onClick={() => watchInkCheckout(lastPurchaseId)} data-testid={`buy-ink-${card.id}`}>
        {PACKS_COPY.buy(card.price)}
        <ExternalLink className="size-3.5" />
      </a>
    </Button>
  );
}

/**
 * One card per active ink pack: the ink, the price, how much ink a dollar buys and the bonus over
 * the smallest pack. Buttons are real links only when NEXT_PUBLIC_BILLING_LINKS provides them (the
 * pack's Stripe Payment Link carrying this user's id and email); otherwise "Coming soon".
 */
export function InkPacksGrid({ payer, lastPurchaseId = null }: { payer: Payer | null; lastPurchaseId?: number | null }) {
  // readPacks is module-level, so it is already stable; useCallback keeps the hook contract explicit.
  const read = useCallback(() => readPacks(), []);
  const { state, retry } = useSection<InkPack[]>(read, true, PACKS_COPY.loadFallback);
  const cards = packCardsFor(state.data ?? [], payerLinks(billingLinks(), payer));

  return (
    <Card id="ink-packs" className="scroll-mt-6">
      <SectionHeader title={PACKS_COPY.title} description={PACKS_COPY.description} />
      <CardContent className={cn(SECTION_BODY, "space-y-3")}>
        {state.status === "loading" && !state.data ? (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3" data-state="loading" aria-busy>
            {[1, 2, 3].map((i) => (
              <div key={i} className="h-44 animate-pulse rounded-lg border bg-muted/40" />
            ))}
          </div>
        ) : state.status === "error" && !state.data ? (
          <SectionError kind="live.ink" code="packs_load_failed" title={PACKS_COPY.loadFailedTitle} message={state.error} onRetry={retry} />
        ) : (
          <>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3" data-state="list">
              {cards.map((card) => (
                <div
                  key={card.id}
                  data-pack={card.id}
                  className={cn("relative flex flex-col rounded-lg border p-4", card.bestValue ? "border-indigo-300 bg-indigo-50/40" : "bg-card")}
                >
                  <div className="flex items-center justify-between gap-2">
                    <h4 className="font-semibold">{card.name}</h4>
                    {card.bestValue && (
                      <span className="rounded-full bg-indigo-600 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-white">{PACKS_COPY.bestValue}</span>
                    )}
                  </div>
                  <p className="mt-2">
                    <span className="text-2xl font-semibold tracking-tight tabular-nums">{card.price}</span>
                    <span className="text-sm text-muted-foreground"> once</span>
                  </p>
                  <p className="mt-0.5 text-sm">
                    <span className="font-medium tabular-nums">{card.inkLabel}</span>
                  </p>
                  <p className="mt-2 text-xs text-muted-foreground">
                    {card.value}
                    {card.bonus && <span className="ml-1 font-medium text-emerald-700">{card.bonus.replace(" per $1", "")}</span>}
                  </p>
                  <div className="mt-auto pt-4">
                    <BuyButton card={card} lastPurchaseId={lastPurchaseId} />
                  </div>
                </div>
              ))}
            </div>
            {allComingSoon(cards) && <p className="text-xs text-muted-foreground">{PACKS_COPY.comingSoonNote}</p>}
            {state.status === "error" && state.data && <SectionError kind="live.ink" code="packs_load_failed" title={PACKS_COPY.loadFailedTitle} message={state.error} onRetry={retry} />}
          </>
        )}
      </CardContent>
    </Card>
  );
}
