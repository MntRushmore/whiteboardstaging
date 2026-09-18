"use client";

import { AlertTriangle, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { ACCOUNT_COPY } from "@/lib/billing/accountState";

/**
 * Inline error row with an optional Retry, shown next to the card or control
 * that failed (same shape as the dashboard's InlineError).
 */
export function SectionError({
  title,
  message,
  onRetry,
  retrying = false,
  className,
}: {
  title: string;
  message: string;
  onRetry?: () => void;
  retrying?: boolean;
  className?: string;
}) {
  return (
    <div
      role="alert"
      data-state="error"
      className={cn(
        "flex flex-col sm:flex-row sm:items-center gap-2 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800",
        className,
      )}
    >
      <AlertTriangle className="w-4 h-4 shrink-0 hidden sm:block" />
      <div className="flex-1 min-w-0">
        <span className="font-medium">{title}.</span> <span>{message}</span>
      </div>
      {onRetry && (
        <Button variant="outline" size="sm" className="bg-white" onClick={onRetry} disabled={retrying}>
          <RefreshCw className={cn("w-3.5 h-3.5 mr-1.5", retrying && "animate-spin")} />
          {ACCOUNT_COPY.retry}
        </Button>
      )}
    </div>
  );
}
