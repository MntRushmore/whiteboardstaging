"use client";

import { useEffect, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { CheckCircle2, Clock, Loader2, RefreshCw, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { notifyInkChanged, useInkSummary } from "@/lib/billing/useInkSummary";
import { CHECKOUT_COPY, INK_RETURN_POLL_MS, inkReturnState, parseInkReturn } from "@/lib/billing/checkout";
import { inkLabel } from "@/lib/billing/inkSummary";
import { cn } from "@/lib/utils";

/** "medium" -> "Medium" until ink_summary names the pack. */
function titleCase(id: string): string {
  return id.charAt(0).toUpperCase() + id.slice(1);
}

/**
 * Back from a Stripe Payment Link (`/account?ink=medium`): the payment is done, but the ink
 * arrives only when Stripe's webhook reaches /api/billing/webhook, usually a few seconds later
 * (sometimes before the redirect). Shows a calm "Adding your Medium pack…" while it re-reads
 * ink_summary every 2 s, "Ink added" when the purchase is there (and tells every ink surface, in
 * this tab and the board's, to re-read), and after a minute without it says so instead of
 * spinning forever. Needs a Suspense boundary (useSearchParams).
 */
export function InkReturnNotice() {
  const params = useSearchParams();
  const target = parseInkReturn(params);
  if (!target) return null;
  return <InkWait key={target} target={target} />;
}

function InkWait({ target }: { target: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const [startedAt, setStartedAt] = useState(() => Date.now());
  const [now, setNow] = useState(() => Date.now());
  const { summary, reload } = useInkSummary();
  const state = inkReturnState({ target, summary, startedAt, now });
  const last = summary?.last_purchase;
  const packName = last?.pack_id === target ? last.pack_name : titleCase(target);

  // Re-read while waiting; the ticking clock is what turns "waiting" into "timeout".
  useEffect(() => {
    if (state !== "waiting") return;
    const id = setInterval(() => {
      setNow(Date.now());
      reload();
    }, INK_RETURN_POLL_MS);
    return () => clearInterval(id);
  }, [state, reload]);

  // The ink arrived: every other ink surface (the header meter here, the board in its own tab) re-reads.
  useEffect(() => {
    if (state === "done") notifyInkChanged();
  }, [state]);

  const dismiss = () => router.replace(pathname);
  const checkAgain = () => {
    const t = Date.now();
    setStartedAt(t);
    setNow(t);
    reload();
  };

  const tone = {
    waiting: "border-blue-200 bg-blue-50 text-blue-950",
    done: "border-emerald-200 bg-emerald-50 text-emerald-950",
    timeout: "border-amber-200 bg-amber-50 text-amber-950",
  }[state];

  return (
    <div role="status" aria-live="polite" data-testid="ink-return" data-state={state} className={cn("mb-6 flex items-start gap-3 rounded-xl border px-4 py-3", tone)}>
      {state === "waiting" ? (
        <Loader2 className="mt-0.5 size-5 shrink-0 animate-spin" aria-hidden />
      ) : state === "done" ? (
        <CheckCircle2 className="mt-0.5 size-5 shrink-0" aria-hidden />
      ) : (
        <Clock className="mt-0.5 size-5 shrink-0" aria-hidden />
      )}
      <div className="min-w-0 flex-1">
        <p className="font-medium">{state === "waiting" ? CHECKOUT_COPY.waiting(packName) : state === "done" ? CHECKOUT_COPY.done : CHECKOUT_COPY.timeout}</p>
        <p className="mt-0.5 text-sm opacity-80">
          {state === "waiting"
            ? CHECKOUT_COPY.waitingDetail
            : state === "done"
              ? CHECKOUT_COPY.doneDetail(inkLabel(last?.ink), inkLabel(summary?.balance))
              : CHECKOUT_COPY.timeoutDetail}
        </p>
        {state === "timeout" && (
          <Button variant="outline" size="sm" className="mt-3 bg-white" onClick={checkAgain}>
            <RefreshCw className="size-3.5" />
            {CHECKOUT_COPY.checkAgain}
          </Button>
        )}
      </div>
      {state !== "waiting" && (
        <button
          type="button"
          onClick={dismiss}
          aria-label={CHECKOUT_COPY.dismiss}
          className="rounded-md p-1 opacity-60 outline-none hover:opacity-100 focus-visible:ring-[3px] focus-visible:ring-ring/50"
        >
          <X className="size-4" />
        </button>
      )}
    </div>
  );
}
