import Image from "next/image";
import { ChartSpline, ListChecks, PenLine } from "lucide-react";
import { cn } from "@/lib/utils";
import { BetaBadge } from "@/components/app/BetaBadge";

/**
 * What the product is, beside the sign-in form. Static and server-rendered:
 * the full panel (with real board screenshots) from lg up, and ProductLine,
 * a two-line version, above the form on phones and on /reset-password.
 */

export const PRODUCT_NAME = "Agathon";
export const PRODUCT_LINE = "The whiteboard that writes back.";
export const PRODUCT_DESCRIPTION =
  "Students write maths by hand. The tutor reads it, checks each step, and answers in its own handwriting.";

const POINTS = [
  { icon: ListChecks, text: "Checks every step" },
  { icon: PenLine, text: "Solves step by step, in its own hand" },
  { icon: ChartSpline, text: "Graphs, geometry and proofs" },
] as const;

export function ProductPanel({ className }: { className?: string }) {
  return (
    <aside
      aria-label={`About ${PRODUCT_NAME}`}
      // muted/50 (#fafafa), not darker: muted-foreground body text on it stays above 4.5:1.
      className={cn("flex-col border-r bg-muted/50 px-10 py-10 xl:px-16", className)}
    >
      <div className="mx-auto flex w-full max-w-xl flex-1 flex-col xl:max-w-160 2xl:max-w-176">
        <p className="flex items-center gap-2 text-sm font-semibold tracking-tight">
          {PRODUCT_NAME}
          <BetaBadge />
        </p>

        <div className="my-auto pt-10 pb-6">
          <h2 className="text-4xl font-bold tracking-tight text-balance 2xl:text-5xl">{PRODUCT_LINE}</h2>
          <p className="mt-4 max-w-md text-base leading-relaxed text-muted-foreground 2xl:max-w-lg 2xl:text-lg">
            {PRODUCT_DESCRIPTION}
          </p>

          <ul className="mt-6 space-y-2.5 text-sm font-medium">
            {POINTS.map(({ icon: Icon, text }) => (
              <li key={text} className="flex items-center gap-3">
                <span className="flex size-7 shrink-0 items-center justify-center rounded-md border bg-background text-foreground/80 shadow-xs">
                  <Icon className="size-4" aria-hidden />
                </span>
                {text}
              </li>
            ))}
          </ul>

          {/* Width follows the viewport height too, so the stack fits on a short laptop screen. */}
          <figure className="relative mt-10 mr-6 mb-6 w-[min(100%,calc((100dvh-29rem)*1.38))] min-w-72">
            <div className="overflow-hidden rounded-xl border bg-card shadow-sm">
              <Image
                src="/login/solved-lines.webp"
                alt="Two lines a student wrote, y = 2x + 1 and y = −x + 4, solved step by step and graphed by the tutor in handwriting, crossing at (1, 3)."
                width={1150}
                height={832}
                // Hidden below lg: the 1px slot makes phones fetch the smallest variant, not this one.
                sizes="(min-width: 1536px) 44rem, (min-width: 1280px) 40rem, (min-width: 1024px) 36rem, 1px"
                preload
                className="h-auto w-full"
              />
            </div>
            <div className="absolute -right-6 -bottom-6 w-[44%] overflow-hidden rounded-lg border bg-card shadow-md">
              <Image
                src="/login/checked-steps.webp"
                alt="A student's steps, 2x = 8 and x = 4, each ticked by the tutor."
                width={582}
                height={400}
                sizes="(min-width: 1536px) 20rem, (min-width: 1280px) 18rem, (min-width: 1024px) 16rem, 1px"
                className="h-auto w-full"
              />
            </div>
          </figure>
        </div>
      </div>
    </aside>
  );
}

/** Name and product line, compact: above the form where the panel does not fit. */
export function ProductLine({ className }: { className?: string }) {
  return (
    <div className={className}>
      <p className="flex items-center gap-2 text-sm font-semibold tracking-tight">
        {PRODUCT_NAME}
        <BetaBadge />
      </p>
      <p className="mt-1 text-sm text-muted-foreground">{PRODUCT_LINE}</p>
    </div>
  );
}
