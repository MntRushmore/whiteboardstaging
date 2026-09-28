"use client";

import { useCallback } from "react";
import Link from "next/link";
import { ExternalLink } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/components/AuthProvider";
import { useSection } from "@/components/account/useSection";
import { Button } from "@/components/ui/button";
import { payerLinks } from "@/lib/billing/checkout";
import { billingLinks } from "@/lib/billing/links";
import { OUT_OF_CREDITS_COPY, creditsResetLabel, upgradeLeadFor, upgradeOptionsFor } from "@/lib/billing/outOfCredits";
import { useCreditSummary } from "@/lib/billing/useCreditSummary";
import { ACCOUNT_PATH, parsePlans, type Plan } from "@/lib/billing/viewModel";
import { cn } from "@/lib/utils";

async function readPlans(): Promise<Plan[]> {
  const { data, error } = await supabase.from("plans").select("*").eq("active", true).order("sort");
  if (error) throw error;
  return parsePlans(data);
}

/**
 * The out-of-credits explanation and its way out, shared by the board's dialog and the Ask
 * panel so both say the same thing: what happened, when credits come back (the 1st, UTC), and
 * an Upgrade button per bigger plan (its Stripe Payment Link with this user's id and email; the
 * customer portal for a subscriber). Checkout opens in a new tab so the board stays as it is.
 * Loaded lazily: nothing here is in the board's first load.
 */
export function OutOfCreditsPanel({
  variant,
  titleAs: Title = "h2",
  bodyAs: Body = "p",
  className,
  footer,
}: {
  variant: "dialog" | "inline";
  /** The dialog passes its accessible Title / Description; the inline panel uses plain text. */
  titleAs?: React.ElementType;
  bodyAs?: React.ElementType;
  className?: string;
  /** Extra buttons next to "See your plan" (the dialog's "Not now"). */
  footer?: React.ReactNode;
}) {
  const { user } = useAuth();
  const { summary } = useCreditSummary();
  const read = useCallback(() => readPlans(), []);
  const { state: plans } = useSection<Plan[]>(read, true, "");
  const links = payerLinks(billingLinks(), user ? { userId: user.id, email: user.email } : null);
  const options = upgradeOptionsFor(plans.data ?? [], summary, links);
  const lead = upgradeLeadFor(options, summary);
  const inline = variant === "inline";

  return (
    <div className={cn("space-y-3", className)} data-testid="out-of-credits" data-variant={variant}>
      <div className="space-y-1">
        <Title className={cn("font-semibold", inline ? "text-sm text-red-800" : "text-lg")}>{OUT_OF_CREDITS_COPY.title}</Title>
        <Body className={cn(inline ? "text-sm text-red-800/90" : "text-sm text-muted-foreground")}>
          {OUT_OF_CREDITS_COPY.body(creditsResetLabel(summary))}
        </Body>
      </div>
      {lead && <p className={cn("text-sm", inline ? "text-gray-700" : "text-foreground")}>{lead}</p>}
      {options.length > 0 && (
        <ul className="space-y-2">
          {options.map((o) => (
            <li
              key={o.planId}
              className={cn("flex items-center justify-between gap-3 rounded-lg border bg-white", inline ? "px-2.5 py-2" : "px-3 py-2.5")}
            >
              <div className="min-w-0">
                <p className="text-sm font-medium">{o.name}</p>
                <p className="text-xs text-muted-foreground">{o.detail}</p>
              </div>
              <Button asChild size="sm" className="shrink-0">
                <a href={o.href} target="_blank" rel="noopener noreferrer" data-testid={`out-of-credits-${o.planId}`}>
                  {o.label}
                  <ExternalLink className="size-3.5" />
                </a>
              </Button>
            </li>
          ))}
        </ul>
      )}
      <div className={cn("flex flex-wrap items-center gap-2", inline ? "" : "justify-end pt-1")}>
        {footer}
        <Button asChild variant={inline ? "link" : "outline"} size="sm" className={inline ? "h-auto px-0 text-gray-900" : ""}>
          <Link href={ACCOUNT_PATH}>
            {OUT_OF_CREDITS_COPY.seePlans}
          </Link>
        </Button>
      </div>
    </div>
  );
}
