"use client";

import { lazy, Suspense, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ChartColumn, CreditCard, FlaskConical, InfinityIcon, ShieldCheck, UserRound } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/lib/supabase";
import { reportUserError } from "@/lib/reportAppError";
import { useAuth } from "@/components/AuthProvider";
import { FeatureLabsPanel } from "@/components/FeatureLabsPanel";
import { BugReportButton } from "@/components/BugReportButton";
import { BetaBadge } from "@/components/app/BetaBadge";
// The is_admin() hint only (no admin page code): asked once the page is idle, then remembered.
import { useIsAdmin } from "@/components/admin/useIsAdmin";
// Nothing imported here may reach tldraw: this header renders on prerendered pages (see InkBottle).
import { InkBottle } from "@/components/billing/InkBottle";
import { useInkSummary } from "@/lib/billing/useInkSummary";
import { ACCOUNT_PATH, BILLING_PATH, INK_COPY, bottleFill, formatInk, inkTone, type InkTone } from "@/lib/billing/inkSummary";
import { UNLIMITED_METER_COPY, hasPlan, isUnlimited } from "@/lib/billing/unlimited";
import { useUnlimited } from "@/lib/billing/useUnlimited";
import { Badge, type BadgeTone } from "@/registry/components/badge/badge";
import { UserMenu } from "@/registry/components/user-menu/user-menu";
import styles from "./appShell.module.css";

// Who's practising (the family's profiles): after the page, and nothing for an account with no kids.
const ProfileSwitcher = lazy(() => import("@/components/family/ProfileSwitcher"));

/** Content width shared by the header and the pages under it (a CSS module class). */
export const APP_CONTENT_CLASS = styles.content;

const BADGE_TONE: Record<InkTone, BadgeTone> = {
  ok: "neutral",
  low: "warning",
  empty: "danger",
};

/**
 * The ink meter: the bottle (filled to the balance) and the ink left, linking to Billing. Shown
 * only while a plan is not giving free help (a second plan before its first charge, a payment to
 * fix): then help spends this ink. There are no ink packs to buy (2026-10-05). Amber under
 * LOW_INK, red at zero. Hidden while loading and on failure: the header is not where a metering
 * hiccup is explained. The balance re-reads on focus and after a checkout (useInkSummary).
 */
function InkLink({ balance }: { balance: number }) {
  const tone = inkTone(balance);
  const ink = formatInk(balance);
  return (
    <Link href={BILLING_PATH} data-tone={tone} data-testid="ink-meter" title={INK_COPY.meterLabel(balance)} className={styles.ink}>
      <Badge tone={BADGE_TONE[tone]} icon={<InkBottle fill={bottleFill(balance)} tone={tone} />}>
        {ink}
        <span className={styles.inkWord}>&nbsp;ink</span>
      </Badge>
    </Link>
  );
}

/**
 * The meter for an Agathon Unlimited subscriber: ∞ and "Unlimited" instead of a count help does
 * not spend, linking to the account page's Billing section. Never amber or red.
 */
function UnlimitedLink() {
  return (
    <Link href={BILLING_PATH} data-tone="unlimited" data-testid="ink-meter" title={UNLIMITED_METER_COPY.label} className={styles.ink}>
      <Badge tone="neutral" icon={<InfinityIcon size={14} strokeWidth={2} aria-hidden />}>
        {UNLIMITED_METER_COPY.word}
      </Badge>
    </Link>
  );
}

/**
 * The app bar for signed-in pages: product name and the beta badge on the left; Report a bug,
 * the plan's meter and the account menu (Progress, Account, Billing, Feature Labs, Admin for admins,
 * Sign out) on the right. Self-contained
 * (reads the session and the ink summary itself), so any page can drop it in above an
 * `APP_CONTENT_CLASS` container.
 * The menu is Arc's UserMenu: a panel on desktop, a bottom sheet below 640 px.
 */
export function AppHeader({ className }: { className?: string }) {
  const router = useRouter();
  const { user } = useAuth();
  const { summary } = useInkSummary({ enabled: Boolean(user) });
  // The same shared read: the plan is part of the ink summary.
  const plan = useUnlimited().state;
  const unlimited = isUnlimited(plan);
  const [labsOpen, setLabsOpen] = useState(false);
  // Asked once the page is idle and remembered for the tab session: a student's header never waits on it.
  const isAdmin = useIsAdmin(user?.id);
  const email = user?.email ?? "";
  // No display name in the session; the address before the @ stands in (initial on the avatar).
  const name = email.split("@")[0] || "Account";

  // The menu shows "Signing out" until this settles, then closes.
  async function signOut() {
    const { error } = await supabase.auth.signOut();
    if (error) {
      const message = "Couldn't sign you out. Try again in a moment.";
      toast.error(message);
      reportUserError({ kind: "live.auth", code: "signout_failed", message });
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
            <Suspense fallback={null}>
              <ProfileSwitcher />
            </Suspense>
            {/* no meter without a plan: the paywall says what there is to say (usePlanGate) */}
            {summary && (unlimited ? <UnlimitedLink /> : hasPlan(plan) ? <InkLink balance={summary.balance} /> : null)}
            <UserMenu
              user={{ name, email }}
              showName
              showTheme={false}
              items={[
                {
                  // the path only: importing the Progress page's modules here would load them on every page
                  label: "Progress",
                  icon: <ChartColumn size={16} strokeWidth={1.75} />,
                  onSelect: () => router.push("/progress"),
                },
                {
                  label: "Account",
                  icon: <UserRound size={16} strokeWidth={1.75} />,
                  onSelect: () => router.push(ACCOUNT_PATH),
                },
                {
                  label: "Billing",
                  icon: <CreditCard size={16} strokeWidth={1.75} />,
                  onSelect: () => router.push(BILLING_PATH),
                },
                {
                  label: "Feature Labs",
                  icon: <FlaskConical size={16} strokeWidth={1.75} />,
                  onSelect: () => setLabsOpen(true),
                },
                ...(isAdmin
                  ? [
                      {
                        label: "Admin",
                        icon: <ShieldCheck size={16} strokeWidth={1.75} />,
                        onSelect: () => router.push("/admin"),
                      },
                    ]
                  : []),
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
