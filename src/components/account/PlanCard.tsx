"use client";

import { ExternalLink, Loader2, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { SECTION_BODY, SectionHeader } from "@/components/account/SectionHeader";
import type { Payer } from "@/lib/billing/checkout";
import { billingPortalUrl, unlimitedCheckoutUrl } from "@/lib/billing/unlimited";
import { PLAN_COPY, unlimitedPlanView } from "@/lib/billing/unlimitedPlan";
import { useUnlimited } from "@/lib/billing/useUnlimited";
import { cn } from "@/lib/utils";

const BADGE_CLASS: Record<string, string> = {
  "Free week": "bg-indigo-50 text-indigo-800 border-indigo-200",
  Active: "bg-emerald-50 text-emerald-800 border-emerald-200",
  "Payment needed": "bg-amber-50 text-amber-900 border-amber-200",
};

/**
 * Agathon Unlimited on the account page (`#plan`): what the plan is doing, in the words the
 * grown-up who pays needs (when the free week ends, the next charge, the day a cancelled plan
 * ends), and the one way forward: start the free week (the plan's Payment Link, same tab; it comes
 * back to the home), or manage it in Stripe's customer portal (cancel, change the card, invoices)
 * through its login page, NEXT_PUBLIC_BILLING_PORTAL_URL, in a new tab. The app holds no Stripe
 * key, so the portal is the only place a plan is cancelled. The plan re-reads when this tab gets
 * focus again (useUnlimited), so a cancellation shows once the webhook has it.
 */
export function PlanCard({ email, payer }: { email: string; payer: Payer | null }) {
  const { state, loading, refresh } = useUnlimited();
  const view = unlimitedPlanView(state, { now: new Date() });
  const checkout = unlimitedCheckoutUrl(payer);
  const portal = billingPortalUrl(email);

  return (
    <Card id="plan" className="scroll-mt-6" data-plan={view.kind}>
      <SectionHeader
        title={PLAN_COPY.title}
        aside={
          view.badge && (
            <span className={cn("rounded-full border px-2.5 py-0.5 text-xs font-medium", BADGE_CLASS[view.badge] ?? "bg-muted")}>{view.badge}</span>
          )
        }
      />
      <CardContent className={cn(SECTION_BODY, "space-y-4")}>
        <div className="space-y-1">
          <p className="text-sm font-medium" data-testid="plan-headline">
            {view.headline}
          </p>
          {view.detail && <p className="text-sm text-muted-foreground">{view.detail}</p>}
        </div>

        {view.action === "start" &&
          (checkout ? (
            // Same tab: the Payment Link comes back to /?unlimited=started, where the plan is watched for.
            <Button asChild size="sm">
              <a href={checkout} data-testid="plan-start">
                {view.actionLabel}
              </a>
            </Button>
          ) : (
            <Button size="sm" variant="outline" disabled aria-disabled>
              {PLAN_COPY.comingSoon}
            </Button>
          ))}

        {(view.action === "manage" || view.action === "fix-payment") &&
          (portal ? (
            <div className="space-y-1.5">
              <Button asChild size="sm" variant={view.action === "fix-payment" ? "default" : "outline"}>
                <a href={portal} target="_blank" rel="noopener noreferrer" data-testid="plan-manage">
                  {view.actionLabel}
                  <ExternalLink className="size-3.5" />
                </a>
              </Button>
              <p className="text-xs text-muted-foreground">{PLAN_COPY.portalHint}</p>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">{PLAN_COPY.noPortal}</p>
          ))}

        {view.action === "refresh" && (
          <Button size="sm" variant="outline" onClick={refresh} disabled={loading}>
            {loading ? <Loader2 className="size-4 animate-spin" /> : <RefreshCw className="size-4" />}
            {view.actionLabel}
          </Button>
        )}
      </CardContent>
    </Card>
  );
}
