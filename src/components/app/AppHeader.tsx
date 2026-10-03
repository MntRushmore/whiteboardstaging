"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { FlaskConical, UserRound } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/components/AuthProvider";
import { FeatureLabsPanel } from "@/components/FeatureLabsPanel";
import { BugReportButton } from "@/components/BugReportButton";
import { BetaBadge } from "@/components/app/BetaBadge";
// Nothing imported here may reach tldraw: this header renders on prerendered pages (see InkBottle).
import { InkBottle } from "@/components/billing/InkBottle";
import { useInkSummary } from "@/lib/billing/useInkSummary";
import { ACCOUNT_PATH, INK_COPY, INK_PACKS_PATH, bottleFill, formatInk, inkTone, type InkTone } from "@/lib/billing/inkSummary";
import { Badge, type BadgeTone } from "@/registry/components/badge/badge";
import { UserMenu } from "@/registry/components/user-menu/user-menu";
import styles from "./appShell.module.css";

/** Content width shared by the header and the pages under it (a CSS module class). */
export const APP_CONTENT_CLASS = styles.content;

const BADGE_TONE: Record<InkTone, BadgeTone> = {
  ok: "neutral",
  low: "warning",
  empty: "danger",
};

/**
 * The ink meter: the bottle (filled to the balance) and the ink left, linking to /account. Quiet
 * unless ink is low (amber, under LOW_INK) or gone (red); then "Get ink" goes straight to the
 * packs. Hidden while loading and on failure: the header is not where a metering hiccup is
 * explained. The balance re-reads on focus and after a checkout (useInkSummary).
 */
function InkLink({ balance }: { balance: number }) {
  const tone = inkTone(balance);
  const ink = formatInk(balance);
  return (
    <>
      <Link href={ACCOUNT_PATH} data-tone={tone} data-testid="ink-meter" title={INK_COPY.meterLabel(balance)} className={styles.ink}>
        <Badge tone={BADGE_TONE[tone]} icon={<InkBottle fill={bottleFill(balance)} tone={tone} />}>
          {ink}
          <span className={styles.inkWord}>&nbsp;ink</span>
        </Badge>
      </Link>
      {tone !== "ok" && (
        <Link href={INK_PACKS_PATH} className={styles.getInk} data-tone={tone}>
          {INK_COPY.getInk}
        </Link>
      )}
    </>
  );
}

/**
 * The app bar for signed-in pages: product name and the beta badge on the left; Report a bug,
 * the ink meter and the account menu (Account, Feature Labs, Sign out) on the right. Self-contained
 * (reads the session and the ink summary itself), so any page can drop it in above an
 * `APP_CONTENT_CLASS` container.
 * The menu is Arc's UserMenu: a panel on desktop, a bottom sheet below 640 px.
 */
export function AppHeader({ className }: { className?: string }) {
  const router = useRouter();
  const { user } = useAuth();
  const { summary } = useInkSummary({ enabled: Boolean(user) });
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
        <div className={styles.brandRow}>
          <Link href="/" className={styles.brand}>
            Agathon
          </Link>
          <BetaBadge />
        </div>

        {user && (
          <div className={styles.end}>
            <BugReportButton variant="header" />
            {summary && <InkLink balance={summary.balance} />}
            <UserMenu
              user={{ name, email }}
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
