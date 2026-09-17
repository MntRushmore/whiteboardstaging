"use client";

import { useEffect, useState } from "react";
import { AlertTriangle, OctagonAlert } from "lucide-react";
import { authedFetch } from "@/lib/api-client";
import { creditsBannerStateFor } from "@/lib/bannerState";
import { CREDITS_EXHAUSTED_MESSAGE } from "@/hooks/useApiErrorHandler";

type Credits = {
  total: number;
  used: number;
  remaining: number;
};

const LOW_THRESHOLD = 3.0; // dollars

export function CreditsBanner({ className = "" }: { className?: string }) {
  const [credits, setCredits] = useState<Credits | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;

    async function fetchCredits() {
      try {
        const res = await authedFetch("/api/credits", {
          method: "GET",
          cache: "no-store",
        });
        if (!res.ok) {
          if (!cancelled) setFailed(true);
          return;
        }
        const data = (await res.json()) as Credits;
        if (!cancelled) {
          setCredits(data);
          setFailed(false);
        }
      } catch {
        // By design the banner hides on failure: it is advisory only, and the
        // request also fails when signed out (authedFetch throws ApiError(401)).
        // The state is still made explicit as data-state="hidden-error" so the
        // DOM shows *why* nothing is rendered; the next 60 s poll retries.
        if (!cancelled) setFailed(true);
      }
    }

    fetchCredits();
    const interval = setInterval(fetchCredits, 60_000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, []);

  const state = creditsBannerStateFor(credits, failed, LOW_THRESHOLD);
  if (state === "hidden-error") {
    return <span hidden data-state="hidden-error" data-banner="credits" />;
  }
  if (state !== "visible" || !credits) return null;

  const isExhausted = credits.remaining <= 0;

  return (
    <div
      className={`flex items-center gap-2 px-3 py-2 rounded-lg border text-sm ${
        isExhausted
          ? "bg-red-50 border-red-200 text-red-800"
          : "bg-yellow-50 border-yellow-200 text-yellow-900"
      } ${className}`}
      role="alert"
      data-state="visible"
    >
      {isExhausted ? (
        <OctagonAlert className="w-4 h-4 flex-shrink-0" />
      ) : (
        <AlertTriangle className="w-4 h-4 flex-shrink-0" />
      )}
      <span>
        {isExhausted
          ? CREDITS_EXHAUSTED_MESSAGE
          : `Low credits: $${credits.remaining.toFixed(
              2,
            )} left — talk to Rushil to refill before things stop working.`}
      </span>
    </div>
  );
}
