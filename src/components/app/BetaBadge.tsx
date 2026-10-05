import { cn } from "@/lib/utils";

/** The beta words, in one place: the badge, its hover text, and the note new students read. */
export const BETA_COPY = {
  badge: "Beta",
  hint: "Agathon is in beta: some things may break. Spot a bug? Tap Report a bug.",
  note: "Agathon is brand new and still in beta. If something looks wrong, tap Report a bug. We read every report.",
} as const;

/** "Beta", beside the product name wherever it appears. */
export function BetaBadge({ className }: { className?: string }) {
  return (
    <span
      title={BETA_COPY.hint}
      className={cn(
        "inline-flex items-center rounded-full bg-violet-100 px-2 py-0.5 text-[11px] leading-none font-semibold tracking-wider text-violet-700 uppercase ring-1 ring-violet-200 ring-inset",
        className,
      )}
    >
      {BETA_COPY.badge}
    </span>
  );
}
