import type { ReactNode } from "react";
import { DASHBOARD_COPY } from "@/app/dashboardState";
import { PRODUCT_PICTURES } from "@/lib/onboarding/copy";

/**
 * The boards home with no boards (after the welcome, or for a student who skipped it or deleted
 * every board): the welcome's picture and words, and one next step — a new board.
 */
export function EmptyBoards({ action }: { action: ReactNode }) {
  const { checked } = PRODUCT_PICTURES;
  return (
    <div data-state="empty" className="flex flex-col items-center justify-center rounded-xl border bg-card px-6 py-12 text-center shadow-xs sm:py-16">
      <div className="w-56 overflow-hidden rounded-lg border bg-card shadow-sm sm:w-64">
        {/* eslint-disable-next-line @next/next/no-img-element -- a 9 KB static webp: next/image would add its runtime to the home's first load for nothing */}
        <img src={checked.src} alt={checked.alt} width={checked.width} height={checked.height} decoding="async" className="h-auto w-full" />
      </div>
      <h2 className="mt-6 text-base font-semibold">{DASHBOARD_COPY.emptyTitle}</h2>
      <p className="mt-1.5 max-w-md text-sm text-balance text-muted-foreground">{DASHBOARD_COPY.emptyHint}</p>
      <div className="mt-6">{action}</div>
    </div>
  );
}
