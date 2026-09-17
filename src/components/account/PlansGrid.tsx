"use client";

import { useCallback } from "react";
import { Check, ExternalLink } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { SectionError } from "@/components/account/SectionError";
import { useSection } from "@/components/account/useSection";
import { ACCOUNT_COPY } from "@/lib/billing/accountState";
import { billingLinks } from "@/lib/billing/links";
import { BILLING_COPY, parsePlans, planCardsFor, type CreditSummary, type Plan, type PlanCard } from "@/lib/billing/viewModel";
import { cn } from "@/lib/utils";

async function readPlans(): Promise<Plan[]> {
  const { data, error } = await supabase.from("plans").select("*").eq("active", true).order("sort");
  if (error) throw error;
  return parsePlans(data);
}

function PlanButton({ card }: { card: PlanCard }) {
  if (card.action === "coming-soon") {
    return (
      <Button variant="outline" size="sm" className="w-full" disabled aria-disabled>
        {BILLING_COPY.comingSoon}
      </Button>
    );
  }
  if (!card.href) {
    // current plan with no portal link
    return (
      <Button variant="secondary" size="sm" className="w-full" disabled aria-disabled>
        <Check className="w-4 h-4" />
        {BILLING_COPY.currentPlan}
      </Button>
    );
  }
  const label =
    card.action === "current" ? BILLING_COPY.manage : card.action === "upgrade" ? BILLING_COPY.upgrade : BILLING_COPY.downgrade;
  return (
    <Button asChild variant={card.action === "upgrade" ? "default" : "outline"} size="sm" className="w-full">
      <a href={card.href} target="_blank" rel="noopener noreferrer">
        {label}
        <ExternalLink className="w-3.5 h-3.5" />
      </a>
    </Button>
  );
}

/** One card per active plan; buttons are real links only when NEXT_PUBLIC_BILLING_LINKS provides them. */
export function PlansGrid({ summary }: { summary: CreditSummary | null }) {
  // readPlans is module-level, so it is already stable; useCallback keeps the hook contract explicit.
  const read = useCallback(() => readPlans(), []);
  const { state, retry } = useSection<Plan[]>(read, true, ACCOUNT_COPY.plansFallback);
  const cards = planCardsFor(state.data ?? [], summary, billingLinks());
  const anyComingSoon = cards.some((c) => c.action === "coming-soon");

  return (
    <Card>
      <CardHeader>
        <CardTitle>Plans</CardTitle>
        <CardDescription>Every plan includes the same tutor; bigger plans include more credits each month.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {state.status === "loading" && !state.data ? (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3" data-state="loading">
            {[1, 2, 3].map((i) => (
              <div key={i} className="h-36 animate-pulse rounded-lg border bg-muted/40" />
            ))}
          </div>
        ) : state.status === "error" && !state.data ? (
          <SectionError title={ACCOUNT_COPY.plansFailedTitle} message={state.error} onRetry={retry} />
        ) : cards.length === 0 ? (
          <p className="text-sm text-muted-foreground" data-state="empty">
            No plans are available right now.
          </p>
        ) : (
          <>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3" data-state="list">
              {cards.map((card) => (
                <div
                  key={card.id}
                  data-plan={card.id}
                  data-action={card.action}
                  className={cn(
                    "flex flex-col gap-3 rounded-lg border p-4",
                    card.current ? "border-primary/60 bg-primary/5" : "bg-card",
                  )}
                >
                  <div className="flex items-center justify-between gap-2">
                    <h4 className="font-semibold">{card.name}</h4>
                    {card.current && (
                      <span className="rounded-full bg-primary px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-primary-foreground">
                        Current
                      </span>
                    )}
                  </div>
                  <p className="text-lg font-medium tabular-nums">{card.price}</p>
                  <p className="text-sm text-muted-foreground">{card.credits} credits / month</p>
                  {card.features.length > 0 && (
                    <ul className="space-y-1 text-sm text-muted-foreground">
                      {card.features.map((feature) => (
                        <li key={feature} className="flex items-start gap-1.5">
                          <Check className="mt-0.5 w-3.5 h-3.5 shrink-0 text-primary" />
                          <span>{feature}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                  <div className="mt-auto pt-1">
                    <PlanButton card={card} />
                  </div>
                </div>
              ))}
            </div>
            {anyComingSoon && <p className="text-xs text-muted-foreground">{BILLING_COPY.comingSoonNote}</p>}
            {state.status === "error" && state.data && (
              <SectionError title={ACCOUNT_COPY.plansFailedTitle} message={state.error} onRetry={retry} />
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}
