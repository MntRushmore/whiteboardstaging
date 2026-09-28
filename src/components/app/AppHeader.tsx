"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Beaker, ChevronDown, Coins, LogOut, UserRound } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/components/AuthProvider";
import { FeatureLabsPanel } from "@/components/FeatureLabsPanel";
import { useCreditSummary } from "@/lib/billing/useCreditSummary";
import { ACCOUNT_PATH, formatCredits, remainingTone } from "@/lib/billing/viewModel";
import { cn } from "@/lib/utils";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

/** Content width shared by the header and the pages under it. */
export const APP_CONTENT_CLASS = "mx-auto w-full max-w-[1280px] px-4 sm:px-6 lg:px-8";

const CHIP_TONE = {
  ok: "text-muted-foreground hover:text-foreground",
  low: "border-amber-300 bg-amber-50 text-amber-900 hover:bg-amber-100",
  empty: "border-red-300 bg-red-50 text-red-900 hover:bg-red-100",
} as const;

/**
 * Credits left this month, linking to /account. Quiet unless credits are low or gone. Hidden
 * while loading and on failure: the header is not where a metering hiccup is explained.
 */
function CreditsChip() {
  const { summary } = useCreditSummary();
  if (!summary) return null;
  const tone = remainingTone(summary);
  const credits = formatCredits(summary.remaining);
  return (
    <Link
      href={ACCOUNT_PATH}
      data-tone={tone}
      title={`${summary.plan_name} plan: ${credits} credits left this month`}
      className={cn(
        "inline-flex h-8 items-center gap-1.5 rounded-full border bg-background px-3 text-xs font-medium transition-colors outline-none hover:bg-accent focus-visible:ring-[3px] focus-visible:ring-ring/50",
        CHIP_TONE[tone],
      )}
    >
      <Coins className="size-3.5" aria-hidden />
      <span className="tabular-nums">{credits}</span>
      <span>credits</span>
    </Link>
  );
}

/**
 * The app bar for signed-in pages: product name on the left; credits and the account menu
 * (Account, Feature Labs, Sign out) on the right. Self-contained (reads the session and the
 * credit summary itself), so any page can drop it in above an `APP_CONTENT_CLASS` container.
 */
export function AppHeader({ className }: { className?: string }) {
  const router = useRouter();
  const { user } = useAuth();
  const [labsOpen, setLabsOpen] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const email = user?.email ?? "";
  const initial = (email.trim()[0] ?? "?").toUpperCase();

  async function signOut() {
    if (signingOut) return;
    setSigningOut(true);
    const { error } = await supabase.auth.signOut();
    if (error) {
      setSigningOut(false);
      toast.error("Couldn't sign you out. Try again in a moment.");
      return;
    }
    router.replace("/login");
  }

  return (
    <header className={cn("sticky top-0 z-40 border-b bg-background/90 backdrop-blur-sm", className)}>
      <div className={cn(APP_CONTENT_CLASS, "flex h-14 items-center gap-3")}>
        <Link
          href="/"
          className="rounded-sm text-[15px] font-semibold tracking-tight outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
        >
          Agathon Classroom
        </Link>

        {user && (
          <div className="ml-auto flex items-center gap-2">
            <CreditsChip />
            {/* Not modal: Feature Labs opens a sheet from this menu, and a modal menu closing
                under an opening dialog can leave the page unclickable (Radix). */}
            <DropdownMenu modal={false}>
              <DropdownMenuTrigger asChild>
                <button
                  type="button"
                  aria-label={`Account menu for ${email}`}
                  className="inline-flex h-8 items-center gap-2 rounded-full py-0.5 pr-2 pl-0.5 text-sm transition-colors outline-none hover:bg-accent focus-visible:ring-[3px] focus-visible:ring-ring/50 data-[state=open]:bg-accent"
                >
                  <span
                    aria-hidden
                    className="grid size-7 place-items-center rounded-full border bg-secondary text-xs font-semibold text-secondary-foreground"
                  >
                    {initial}
                  </span>
                  <span className="hidden max-w-[200px] truncate text-muted-foreground md:inline">{email}</span>
                  <ChevronDown className="size-3.5 text-muted-foreground" aria-hidden />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-60">
                <DropdownMenuLabel className="font-normal">
                  <span className="block text-xs text-muted-foreground">Signed in as</span>
                  <span className="block truncate text-sm font-medium">{email}</span>
                </DropdownMenuLabel>
                <DropdownMenuSeparator />
                <DropdownMenuItem asChild className="gap-2">
                  <Link href={ACCOUNT_PATH}>
                    <UserRound className="size-4 text-muted-foreground" />
                    Account
                  </Link>
                </DropdownMenuItem>
                <DropdownMenuItem className="gap-2" onSelect={() => setLabsOpen(true)}>
                  <Beaker className="size-4 text-muted-foreground" />
                  Feature Labs
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  className="gap-2"
                  disabled={signingOut}
                  onSelect={(e) => {
                    e.preventDefault();
                    void signOut();
                  }}
                >
                  <LogOut className="size-4 text-muted-foreground" />
                  Sign out
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        )}
      </div>
      <FeatureLabsPanel open={labsOpen} onOpenChange={setLabsOpen} />
    </header>
  );
}
