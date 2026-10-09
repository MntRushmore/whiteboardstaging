"use client";

import Link from "next/link";
import { CheckCircle2, ExternalLink, HeartHandshake, Loader2, RefreshCw, Sparkles } from "lucide-react";
import { useAuth } from "@/components/AuthProvider";
import { Button } from "@/components/ui/button";
import { ACCOUNT_PATH } from "@/lib/billing/inkSummary";
import { OUT_OF_INK_COPY, inkPanelMood } from "@/lib/billing/outOfInk";
import { billingPortalUrl, unlimitedLink } from "@/lib/billing/unlimited";
import { unlimitedPlanView } from "@/lib/billing/unlimitedPlan";
import { useUnlimited } from "@/lib/billing/useUnlimited";
import { isKidEmail } from "@/lib/family/contracts";
import { FAMILY_COPY } from "@/lib/family/copy";
import { PLAN_PATH } from "@/lib/onboarding/planMarker";
import { cn } from "@/lib/utils";

/**
 * Help that needs the plan, shared by the board's dialog and the Ask and lecture panels so all
 * three say the same thing. There is no free plan and no ink packs (owner, 2026-10-05), so:
 *  - no plan (the guided first board's starter ink ran out): Agathon Unlimited, free for 7 days,
 *    and Start the free trial, which opens the plan screen in this tab (the board is saved);
 *  - a plan whose help spends ink right now (a second plan before its first charge, a payment to
 *    fix, one being set up): what it is doing, and its fix (the billing portal, in a new tab);
 *  - the plan arrived while it was open: all set, back to the board;
 *  - a kid profile (src/lib/family), whose plan is their grown-up's: "Ask your grown-up", and
 *    nothing else. Kids never see billing: no price, no plan screen, no portal (its sign-in would
 *    be prefilled with the kid's address, which has no mailbox).
 * Loaded lazily: nothing here is in the board's first load.
 */
export function OutOfInkPanel({
  variant,
  outOfInk = false,
  titleAs: Title = "h2",
  bodyAs: Body = "p",
  className,
  footer,
  onDone,
}: {
  variant: "dialog" | "inline";
  /** A 402 brought the student here (rather than a tap on the meter). */
  outOfInk?: boolean;
  /** The dialog passes its accessible Title / Description; the inline panel uses plain text. */
  titleAs?: React.ElementType;
  bodyAs?: React.ElementType;
  className?: string;
  /** Extra buttons next to "See your plan" (the dialog's "Not now"). */
  footer?: React.ReactNode;
  /** "Back to the board" once the plan is on (the dialog closes itself). */
  onDone?: () => void;
}) {
  const { user } = useAuth();
  const { state, loading, refresh } = useUnlimited();
  const mood = inkPanelMood(state);
  const inline = variant === "inline";
  const titleClass = cn("font-semibold", inline ? "text-sm" : "text-lg");

  if (mood === "unlimited") {
    return (
      <div className={cn("space-y-3", className)} data-testid="out-of-ink" data-variant={variant} data-state="unlimited" role="status">
        <div className="space-y-0.5">
          <Title className={cn(titleClass, inline && "text-emerald-800")}>
            <CheckCircle2 className="mr-1.5 inline size-4 align-[-2px] text-emerald-600" aria-hidden />
            {OUT_OF_INK_COPY.allSet}
          </Title>
          <Body className="text-sm text-muted-foreground">{OUT_OF_INK_COPY.allSetBody}</Body>
        </div>
        {onDone && (
          <div className="flex justify-end">
            <Button size="sm" onClick={onDone}>
              {OUT_OF_INK_COPY.backToBoard}
            </Button>
          </div>
        )}
      </div>
    );
  }

  const actions = (main: React.ReactNode) => (
    <div className={cn("flex flex-wrap items-center gap-2", inline ? "" : "justify-end pt-1")}>
      {footer}
      {main}
    </div>
  );

  if (isKidEmail(user?.email)) {
    return (
      <div className={cn("space-y-3", className)} data-testid="out-of-ink" data-variant={variant} data-state="kid">
        <div className="space-y-1">
          <Title className={titleClass}>
            <HeartHandshake className="mr-1.5 inline size-4 align-[-2px] text-muted-foreground" aria-hidden />
            {FAMILY_COPY.kidHelpPausedTitle}
          </Title>
          <Body className={cn("text-sm", inline ? "text-gray-700" : "text-muted-foreground")}>{FAMILY_COPY.kidHelpPaused}</Body>
        </div>
        {footer && actions(null)}
      </div>
    );
  }

  const seePlan = (
    <Button asChild variant={inline ? "link" : "outline"} size="sm" className={inline ? "h-auto px-0 text-gray-900" : ""}>
      <a href={`${ACCOUNT_PATH}#billing`} target="_blank" rel="noopener noreferrer">
        {OUT_OF_INK_COPY.seePlan}
      </a>
    </Button>
  );

  if (mood === "offer") {
    const restart = state.status === "canceled";
    return (
      <div className={cn("space-y-3", className)} data-testid="out-of-ink" data-variant={variant} data-state="offer">
        <div className="space-y-1">
          <Title className={titleClass}>{OUT_OF_INK_COPY.title}</Title>
          <Body className={cn("text-sm", inline ? "text-gray-700" : "text-muted-foreground")}>{OUT_OF_INK_COPY.offerBody}</Body>
        </div>
        {actions(
          unlimitedLink() ? (
            // Same tab: the plan screen opens checkout, which comes back to the home.
            <Button asChild size="sm">
              <Link href={PLAN_PATH} data-testid="plan-offer-start">
                <Sparkles className="size-3.5" aria-hidden />
                {restart ? OUT_OF_INK_COPY.restart : OUT_OF_INK_COPY.start}
              </Link>
            </Button>
          ) : (
            <Button size="sm" variant="outline" disabled aria-disabled>
              {OUT_OF_INK_COPY.comingSoon}
            </Button>
          ),
        )}
      </div>
    );
  }

  // A plan, but help spends ink right now: what the plan is doing, and the one thing to do.
  const view = unlimitedPlanView(state, { now: new Date() });
  const portal = billingPortalUrl(user?.email ?? null);
  return (
    <div className={cn("space-y-3", className)} data-testid="out-of-ink" data-variant={variant} data-state="plan">
      <div className="space-y-1">
        <Title className={titleClass}>{outOfInk ? OUT_OF_INK_COPY.outOfInk : OUT_OF_INK_COPY.planTitle}</Title>
        <Body className={cn("text-sm", inline ? "text-gray-700" : "text-muted-foreground")}>
          {view.headline}
          {view.detail && ` ${view.detail}`}
        </Body>
      </div>
      {actions(
        view.action === "refresh" ? (
          <Button size="sm" variant="outline" onClick={refresh} disabled={loading}>
            {loading ? <Loader2 className="size-4 animate-spin" /> : <RefreshCw className="size-4" />}
            {view.actionLabel}
          </Button>
        ) : (view.action === "manage" || view.action === "fix-payment") && portal ? (
          <Button asChild size="sm" variant={view.action === "fix-payment" ? "default" : "outline"}>
            <a href={portal} target="_blank" rel="noopener noreferrer">
              {view.actionLabel}
              <ExternalLink className="size-3.5" />
            </a>
          </Button>
        ) : (
          seePlan
        ),
      )}
    </div>
  );
}
