"use client";

import { useCallback, useState } from "react";
import { CheckCircle2, ExternalLink } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/components/AuthProvider";
import { useSection } from "@/components/account/useSection";
import { InkBottle } from "@/components/billing/InkBottle";
import { Button } from "@/components/ui/button";
import { payerLinks } from "@/lib/billing/checkout";
import { PACKS_COPY, allComingSoon, packCardsFor, parseInkPacks, type InkPack } from "@/lib/billing/inkPacks";
import { ACCOUNT_PATH, bottleFill, inkTone } from "@/lib/billing/inkSummary";
import { billingLinks } from "@/lib/billing/links";
import { OUT_OF_INK_COPY, inkArrived, inkPanelMood } from "@/lib/billing/outOfInk";
import { useInkSummary, watchInkCheckout } from "@/lib/billing/useInkSummary";
import { cn } from "@/lib/utils";

async function readPacks(): Promise<InkPack[]> {
  const { data, error } = await supabase.from("ink_packs").select("id,name,ink,price_cents,sort,active").eq("active", true).order("sort");
  if (error) throw error;
  return parseInkPacks(data);
}

/**
 * Ink and the way to more of it, shared by the board's dialog and the Ask and lecture panels so
 * all three say the same thing: out of ink (or just getting more), the three packs with their
 * prices and a buy button each (its Stripe Payment Link with this user's id and email, in a NEW
 * TAB so the board stays as it is), and "Ink added" once the purchase lands while it is open
 * (useInkSummary watches for it after a buy). Without NEXT_PUBLIC_BILLING_LINKS the buttons say
 * "Coming soon". Loaded lazily: nothing here is in the board's first load.
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
  /** A 402 brought the student here: it reads "You're out of ink" until the balance says otherwise. */
  outOfInk?: boolean;
  /** The dialog passes its accessible Title / Description; the inline panel uses plain text. */
  titleAs?: React.ElementType;
  bodyAs?: React.ElementType;
  className?: string;
  /** Extra buttons next to "See your ink" (the dialog's "Not now"). */
  footer?: React.ReactNode;
  /** "Back to the board" once ink arrived (the dialog closes itself). */
  onDone?: () => void;
}) {
  const { user } = useAuth();
  const { summary } = useInkSummary();
  const read = useCallback(() => readPacks(), []);
  const { state: packs } = useSection<InkPack[]>(read, true, PACKS_COPY.loadFallback);
  const links = payerLinks(billingLinks(), user ? { userId: user.id, email: user.email } : null);
  const cards = packCardsFor(packs.data ?? [], links);
  const inline = variant === "inline";

  // The balance the panel opened with (its first read): ink above it arrived while it was open.
  // Set during render, once, rather than in an effect (React's "adjusting state on a prop change").
  const [openedWith, setOpenedWith] = useState<number | null>(null);
  const balance = summary?.balance ?? null;
  if (openedWith === null && balance !== null) setOpenedWith(balance);
  const arrived = openedWith !== null && inkArrived(openedWith, balance);
  const mood = inkPanelMood(balance, outOfInk);

  if (arrived && balance !== null) {
    return (
      <div className={cn("space-y-3", className)} data-testid="out-of-ink" data-variant={variant} data-state="added" role="status">
        <div className="flex items-center gap-3">
          <InkBottle size="sm" fill={bottleFill(balance)} tone={inkTone(balance)} className="size-8 shrink-0 text-gray-700" />
          <div className="space-y-0.5">
            <Title className={cn("font-semibold", inline ? "text-sm text-emerald-800" : "text-lg")}>
              <CheckCircle2 className="mr-1.5 inline size-4 align-[-2px] text-emerald-600" aria-hidden />
              {OUT_OF_INK_COPY.added}
            </Title>
            <Body className="text-sm text-muted-foreground">{OUT_OF_INK_COPY.addedBody(balance)}</Body>
          </div>
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

  const comingSoon = allComingSoon(cards);
  return (
    <div className={cn("space-y-3", className)} data-testid="out-of-ink" data-variant={variant} data-state={mood}>
      <div className="space-y-1">
        <Title className={cn("font-semibold", inline ? (mood === "empty" ? "text-sm text-red-800" : "text-sm") : "text-lg")}>
          {mood === "empty" ? OUT_OF_INK_COPY.title : OUT_OF_INK_COPY.buyTitle}
        </Title>
        <Body className={cn("text-sm", inline && mood === "empty" ? "text-red-800/90" : "text-muted-foreground")}>
          {mood === "empty" || balance === null ? OUT_OF_INK_COPY.body : OUT_OF_INK_COPY.buyBody(balance)}
        </Body>
      </div>
      {cards.length > 0 && <p className={cn("text-sm", inline ? "text-gray-700" : "text-foreground")}>{OUT_OF_INK_COPY.lead}</p>}
      {packs.status === "loading" && !packs.data ? (
        <ul className="space-y-2" aria-busy data-state="loading">
          {[1, 2, 3].map((i) => (
            <li key={i} className="h-12 animate-pulse rounded-lg border bg-muted/40" />
          ))}
        </ul>
      ) : (
        <ul className="space-y-2">
          {cards.map((card) => (
            <li
              key={card.id}
              data-pack={card.id}
              className={cn("flex items-center justify-between gap-3 rounded-lg border bg-white", inline ? "px-2.5 py-2" : "px-3 py-2.5", card.bestValue && "border-indigo-200")}
            >
              <div className="min-w-0">
                <p className="text-sm font-medium">
                  {card.name}
                  <span className="font-normal text-muted-foreground"> · {card.inkLabel}</span>
                  {card.bestValue && (
                    <span className="ml-1.5 rounded-full bg-indigo-50 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-indigo-700">
                      {PACKS_COPY.bestValue}
                    </span>
                  )}
                </p>
                <p className="text-xs text-muted-foreground">{card.bonus ? `${card.value} (${card.bonus.replace(" per $1", "")})` : card.value}</p>
              </div>
              {card.href ? (
                <Button asChild size="sm" className="shrink-0 tabular-nums">
                  <a href={card.href} target="_blank" rel="noopener noreferrer" onClick={() => watchInkCheckout(summary?.last_purchase?.id ?? null)} data-testid={`buy-ink-${card.id}`}>
                    {card.price}
                    <ExternalLink className="size-3.5" />
                  </a>
                </Button>
              ) : (
                <Button size="sm" variant="outline" className="shrink-0" disabled aria-disabled>
                  {PACKS_COPY.comingSoon}
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}
      <p className="text-xs text-muted-foreground">{comingSoon ? OUT_OF_INK_COPY.comingSoon : OUT_OF_INK_COPY.newTab}</p>
      <div className={cn("flex flex-wrap items-center gap-2", inline ? "" : "justify-end pt-1")}>
        {footer}
        <Button asChild variant={inline ? "link" : "outline"} size="sm" className={inline ? "h-auto px-0 text-gray-900" : ""}>
          <a href={ACCOUNT_PATH} target="_blank" rel="noopener noreferrer">
            {OUT_OF_INK_COPY.seeAccount}
          </a>
        </Button>
      </div>
    </div>
  );
}
