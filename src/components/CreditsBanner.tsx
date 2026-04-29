"use client";

import { useEffect, useState } from "react";
import { AlertTriangle, OctagonAlert } from "lucide-react";

type Credits = {
  total: number;
  used: number;
  remaining: number;
};

const LOW_THRESHOLD = 3.0; // dollars

export function CreditsBanner({ className = "" }: { className?: string }) {
  const [credits, setCredits] = useState<Credits | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function fetchCredits() {
      try {
        const res = await fetch("/api/credits", { cache: "no-store" });
        if (!res.ok) return;
        const data = (await res.json()) as Credits;
        if (!cancelled) setCredits(data);
      } catch {
        // Silent — banner just hides.
      }
    }

    fetchCredits();
    const interval = setInterval(fetchCredits, 60_000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, []);

  if (!credits) return null;
  if (credits.remaining > LOW_THRESHOLD) return null;

  const isExhausted = credits.remaining <= 0;

  return (
    <div
      className={`flex items-center gap-2 px-3 py-2 rounded-lg border text-sm ${
        isExhausted
          ? "bg-red-50 border-red-200 text-red-800"
          : "bg-yellow-50 border-yellow-200 text-yellow-900"
      } ${className}`}
      role="alert"
    >
      {isExhausted ? (
        <OctagonAlert className="w-4 h-4 flex-shrink-0" />
      ) : (
        <AlertTriangle className="w-4 h-4 flex-shrink-0" />
      )}
      <span>
        {isExhausted
          ? "Account credits depleted — please talk to Rushil to refill your account!"
          : `Low credits: $${credits.remaining.toFixed(
              2,
            )} left — talk to Rushil to refill before things stop working.`}
      </span>
    </div>
  );
}
