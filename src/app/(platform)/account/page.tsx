"use client";

import { useEffect } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AlertTriangle, ArrowLeft, Loader2, RefreshCw } from "lucide-react";
import { AuthErrorBanner, useAuth } from "@/components/AuthProvider";
import { AppHeader } from "@/components/app/AppHeader";
import { Button } from "@/components/ui/button";
import { ProfileCard } from "@/components/account/ProfileCard";
import { DangerZone } from "@/components/account/DangerZone";
import { BillingCard } from "@/components/account/BillingCard";
import { GradeSection } from "@/components/account/GradeSection";
import { FamilySection } from "@/components/account/FamilySection";
import { ReferralCard } from "@/components/referral/ReferralCard";
import { useInkSummary } from "@/lib/billing/useInkSummary";
import { ACCOUNT_COPY, accountPageStateFor } from "@/lib/billing/accountState";
import { isKidEmail } from "@/lib/family/contracts";
import { FAMILY_COPY } from "@/lib/family/copy";

/** Shaped like the ink and usage cards, so the page does not jump when they arrive. */
function AccountSkeleton() {
  const bar = "animate-pulse rounded bg-muted";
  return (
    <div className="space-y-6" data-state="loading" aria-busy>
      <div className="rounded-xl border bg-card p-5 shadow sm:p-6">
        <div className="flex justify-between gap-4">
          <div className={`${bar} h-5 w-32`} />
          <div className={`${bar} h-5 w-12 rounded-full`} />
        </div>
        <div className={`${bar} mt-2 h-4 w-3/4`} />
        <div className={`${bar} mt-6 h-9 w-40`} />
        <div className={`${bar} mt-3 h-2 w-full rounded-full`} />
        <div className={`${bar} mt-5 h-28 w-full rounded-lg`} />
      </div>
      <div className="rounded-xl border bg-card p-5 shadow sm:p-6">
        <div className={`${bar} h-5 w-24`} />
        <div className={`${bar} mt-2 h-4 w-1/2`} />
        <div className="mt-6 space-y-3">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className={`${bar} h-6 w-full`} />
          ))}
        </div>
      </div>
    </div>
  );
}

/**
 * /account: Billing (`#billing`: Agathon Unlimited, its next charge, the card and invoices, cancel),
 * then the profile and account deletion, in one ~768 px column. There is no free plan and no ink
 * to buy (2026-10-05), so Billing comes first: every way in is about the plan (the header's
 * "Unlimited", its menu's Billing, the ink dialog's "See your plan"). Auth-gated like the
 * dashboard, but never paywalled: a student without a plan must still reach Billing, their
 * profile and Delete account. Every card loads its own data through the user's own Supabase
 * session (RLS / RPCs); nothing here talks to /api/*.
 */
export default function AccountPage() {
  const router = useRouter();
  const { user, loading: authLoading, authError } = useAuth();
  // The plan is part of the ink summary (one shared read): Billing waits for it.
  const ink = useInkSummary();

  useEffect(() => {
    if (!authLoading && !user && !authError) {
      router.replace("/login");
    }
  }, [user, authLoading, authError, router]);

  if (!user && authError) {
    return (
      <div className="flex grow items-center justify-center bg-gray-50 p-4">
        <div className="w-full max-w-md">
          <AuthErrorBanner />
        </div>
      </div>
    );
  }

  if (authLoading || !user) {
    return (
      <div className="flex grow items-center justify-center bg-gray-50">
        <Loader2 className="w-6 h-6 animate-spin text-blue-600" />
      </div>
    );
  }

  const pageState = accountPageStateFor(ink.state);
  const email = user.email ?? "";

  return (
    <div className="grow bg-muted/40">
      <AppHeader />
      <main className="max-w-3xl mx-auto px-4 sm:px-6 py-8 sm:py-12">
        <AuthErrorBanner className="mb-4" />
        <div className="mb-8">
          <Link
            href="/"
            className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
          >
            <ArrowLeft className="w-4 h-4" />
            {ACCOUNT_COPY.back}
          </Link>
          <h1 className="mt-3 text-3xl font-bold tracking-tight">{ACCOUNT_COPY.title}</h1>
          <p className="mt-1 text-sm text-muted-foreground">{isKidEmail(email) ? FAMILY_COPY.kidAccountSubtitle : ACCOUNT_COPY.subtitle}</p>
        </div>

        {pageState === "loading" ? (
          <AccountSkeleton />
        ) : pageState === "error" ? (
          <div
            role="alert"
            data-state="error"
            className="flex flex-col items-center justify-center text-center bg-card border border-red-200 rounded-xl shadow-sm px-6 py-14"
          >
            <div className="w-16 h-16 bg-red-50 rounded-full flex items-center justify-center mb-4">
              <AlertTriangle className="w-8 h-8 text-red-600" />
            </div>
            <h3 className="text-lg font-semibold">{ACCOUNT_COPY.loadFailedTitle}</h3>
            <p className="text-muted-foreground mt-2 max-w-md">{ink.error}</p>
            <Button onClick={ink.reload} className="mt-6" variant="outline" disabled={ink.loading}>
              <RefreshCw className={`w-4 h-4 mr-2 ${ink.loading ? "animate-spin" : ""}`} />
              {ACCOUNT_COPY.retry}
            </Button>
          </div>
        ) : (
          <div className="space-y-6" data-state="ready">
            <BillingCard email={email} />
            <ProfileCard userId={user.id} email={email} />
            <GradeSection userId={user.id} kid={isKidEmail(email)} />
            <FamilySection email={email} />
            <ReferralCard />
            <DangerZone email={email} />
          </div>
        )}
      </main>
    </div>
  );
}
