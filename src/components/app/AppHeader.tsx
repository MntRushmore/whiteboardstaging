"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Coins, FlaskConical, UserRound } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/components/AuthProvider";
import { FeatureLabsPanel } from "@/components/FeatureLabsPanel";
import { useCreditSummary } from "@/lib/billing/useCreditSummary";
import { ACCOUNT_PATH, formatCredits, remainingTone, type CreditSummary } from "@/lib/billing/viewModel";
import { Badge, type BadgeTone } from "@/registry/components/badge/badge";
import { UserMenu } from "@/registry/components/user-menu/user-menu";
import styles from "./appShell.module.css";

/** Content width shared by the header and the pages under it (a CSS module class). */
export const APP_CONTENT_CLASS = styles.content;

const BADGE_TONE: Record<ReturnType<typeof remainingTone>, BadgeTone> = {
  ok: "neutral",
  low: "warning",
  empty: "danger",
};

/**
 * Credits left this month, linking to /account. Quiet unless credits are low (amber) or gone
 * (red), the same threshold as the home's banner. Hidden while loading and on failure: the header
 * is not where a metering hiccup is explained.
 */
function CreditsLink({ summary }: { summary: CreditSummary }) {
  const tone = remainingTone(summary);
  const credits = formatCredits(summary.remaining);
  return (
    <Link
      href={ACCOUNT_PATH}
      data-tone={tone}
      title={`${summary.plan_name} plan: ${credits} credits left this month`}
      className={styles.credits}
    >
      <Badge tone={BADGE_TONE[tone]} icon={<Coins size={13} strokeWidth={1.9} />}>
        {credits}
        <span className={styles.creditsWord}>&nbsp;credits</span>
      </Badge>
    </Link>
  );
}

/**
 * The app bar for signed-in pages: product name on the left; credits and the account menu
 * (Account, Feature Labs, Sign out) on the right. Self-contained (reads the session and the
 * credit summary itself), so any page can drop it in above an `APP_CONTENT_CLASS` container.
 * The menu is Arc's UserMenu: a panel on desktop, a bottom sheet below 640 px.
 */
export function AppHeader({ className }: { className?: string }) {
  const router = useRouter();
  const { user } = useAuth();
  const { summary } = useCreditSummary({ enabled: Boolean(user) });
  const [labsOpen, setLabsOpen] = useState(false);
  const email = user?.email ?? "";
  // No display name in the session; the address before the @ stands in (initial on the avatar).
  const name = email.split("@")[0] || "Account";

  // The menu shows "Signing out" until this settles, then closes.
  async function signOut() {
    const { error } = await supabase.auth.signOut();
    if (error) {
      toast.error("Couldn't sign you out. Try again in a moment.");
      return;
    }
    router.replace("/login");
  }

  return (
    <header className={[styles.header, className].filter(Boolean).join(" ")}>
      <div className={`${styles.content} ${styles.bar}`}>
        <Link href="/" className={styles.brand}>
          Agathon Classroom
        </Link>

        {user && (
          <div className={styles.end}>
            {summary && <CreditsLink summary={summary} />}
            <UserMenu
              user={{ name, email, plan: summary ? summary.plan_name : undefined }}
              showName
              showTheme={false}
              items={[
                {
                  label: "Account",
                  icon: <UserRound size={16} strokeWidth={1.75} />,
                  onSelect: () => router.push(ACCOUNT_PATH),
                },
                {
                  label: "Feature Labs",
                  icon: <FlaskConical size={16} strokeWidth={1.75} />,
                  onSelect: () => setLabsOpen(true),
                },
              ]}
              onSignOut={signOut}
            />
          </div>
        )}
      </div>
      <FeatureLabsPanel open={labsOpen} onOpenChange={setLabsOpen} />
    </header>
  );
}
