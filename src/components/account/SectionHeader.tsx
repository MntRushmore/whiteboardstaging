import type { ReactNode } from "react";
import { CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";

/**
 * The one header every /account card uses: title and a one-line description on the
 * left, an optional badge or figure on the right (it wraps under the title on a phone).
 */
export function SectionHeader({
  title,
  description,
  aside,
  titleClassName,
}: {
  title: ReactNode;
  description?: ReactNode;
  aside?: ReactNode;
  titleClassName?: string;
}) {
  return (
    <CardHeader className="flex-row flex-wrap items-start justify-between gap-x-4 gap-y-2 space-y-0 p-5 sm:p-6">
      <div className="min-w-0 flex-1 space-y-1.5">
        <CardTitle className={cn("text-base", titleClassName)}>{title}</CardTitle>
        {description && <CardDescription>{description}</CardDescription>}
      </div>
      {aside && <div className="shrink-0">{aside}</div>}
    </CardHeader>
  );
}

/** Card body padding that matches SectionHeader. */
export const SECTION_BODY = "p-5 pt-0 sm:p-6 sm:pt-0";
