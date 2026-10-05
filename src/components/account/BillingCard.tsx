"use client";

import { ExternalLink, Loader2, RefreshCw } from "lucide-react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { SECTION_BODY, SectionHeader } from "@/components/account/SectionHeader";
import { billingPortalUrl, unlimitedCheckoutUrl } from "@/lib/billing/unlimited";
import { PLAN_COPY, billingFacts, unlimitedPlanView } from "@/lib/billing/unlimitedPlan";
import { useUnlimited } from "@/lib/billing/useUnlimited";
import { cn } from "@/lib/utils";

const BADGE_CLASS: Record<string, string> = {
  "Free week": "bg-indigo-50 text-indigo-800 border-indigo-200",
  Starting: "bg-indigo-50 text-indigo-800 border-indigo-200",
  Active: "bg-emerald-50 text-emerald-800 border-emerald-200",
  "Payment needed": "bg-amber-50 text-amber-900 border-amber-200",
};

/**
 * Billing on the account page (`#billing`, the header menu's Billing): Agathon Unlimited, the one
 * plan. What it costs, where it stands and the next day money moves (`billingFacts`), what that
 * means in a sentence for the grown-up who pays (`unlimitedPlanView`), and the one way forward:
 * start the free week (the plan's Payment Link, same tab; it comes back to the home), or Stripe's
 * customer portal through its login page (NEXT_PUBLIC_BILLING_PORTAL_URL, a new tab) to change the
 * card, see invoices or cancel. The app holds no Stripe key, so the portal is the only place a plan
 * is cancelled. The plan re-reads when this tab gets focus again (useUnlimited), so a cancellation
 * shows once the webhook has it. The checkout carries the account's checkout reference from the
 * same read (never the user id), so the start button shows "Coming soon" until that read has landed.
 */
export function BillingCard({ email }: { email: string }) {
  const { state, loading, refresh } = useUnlimited();
  const view = unlimitedPlanView(state, { now: new Date() });
  const facts = billingFacts(state);
  const checkout = unlimitedCheckoutUrl({ checkoutRef: state.checkoutRef, email });
  const portal = billingPortalUrl(email);

  return (
    <Card id="billing" className="scroll-mt-6" data-plan={view.kind}>
      <SectionHeader
        title={PLAN_COPY.billingTitle}
        description={PLAN_COPY.billingSubtitle}
        aside={
          view.badge && (
            <span className={cn("rounded-full border px-2.5 py-0.5 text-xs font-medium", BADGE_CLASS[view.badge] ?? "bg-muted")}>{view.badge}</span>
          )
        }
      />
      <CardContent className={cn(SECTION_BODY, "space-y-4")}>
        <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-2 rounded-lg border bg-muted/30 px-4 py-3 text-sm" data-testid="billing-facts">
          {facts.map((f) => (
            <div key={f.id} className="contents">
              <dt className="text-muted-foreground">{f.label}</dt>
              <dd className="font-medium tabular-nums">{f.value}</dd>
            </div>
          ))}
        </dl>

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

        {/* The plan's terms (renewal, cancelling, fair use) and refunds, for the grown-up who pays. */}
        <p className="text-xs text-muted-foreground">
          <Link href="/terms#unlimited" className="underline underline-offset-2 hover:text-foreground">
            How the plan works
          </Link>
          {" · "}
          <Link href="/refunds#subscriptions" className="underline underline-offset-2 hover:text-foreground">
            Refunds
          </Link>
        </p>
      </CardContent>
    </Card>
  );
}
