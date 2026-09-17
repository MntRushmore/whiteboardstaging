"use client";

import { useEffect } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AlertTriangle, ArrowLeft, Loader2, RefreshCw } from "lucide-react";
import { AuthErrorBanner, useAuth } from "@/components/AuthProvider";
import { Button } from "@/components/ui/button";
import { ProfileCard } from "@/components/account/ProfileCard";
import { PlanCreditsCard } from "@/components/account/PlanCreditsCard";
import { PlansGrid } from "@/components/account/PlansGrid";
import { UsageTable } from "@/components/account/UsageTable";
import { DangerZone } from "@/components/account/DangerZone";
import { useCreditSummary } from "@/lib/billing/useCreditSummary";
import { ACCOUNT_COPY, accountPageStateFor } from "@/lib/billing/accountState";

/**
 * /account: profile, plan & credits, plans, usage and account deletion.
 * Auth-gated like the dashboard; every card loads its own data through the
 * user's own Supabase session (RLS / SECURITY DEFINER RPCs), nothing here
 * talks to /api/*.
 */
export default function AccountPage() {
  const router = useRouter();
  const { user, loading: authLoading, authError } = useAuth();
  const credits = useCreditSummary();

  useEffect(() => {
    if (!authLoading && !user && !authError) {
      router.replace("/login");
    }
  }, [user, authLoading, authError, router]);

  if (!user && authError) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gray-50 p-4">
        <div className="w-full max-w-md">
          <AuthErrorBanner />
        </div>
      </div>
    );
  }

  if (authLoading || !user) {
    return (
      <div className="flex h-screen items-center justify-center bg-gray-50">
        <Loader2 className="w-6 h-6 animate-spin text-blue-600" />
      </div>
    );
  }

  const pageState = accountPageStateFor(credits.state);
  const email = user.email ?? "";

  return (
    <div className="min-h-screen bg-background">
      <main className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 py-8 sm:py-12">
        <AuthErrorBanner className="mb-4" />
        <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <Link
              href="/"
              className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
            >
              <ArrowLeft className="w-4 h-4" />
              {ACCOUNT_COPY.back}
            </Link>
            <h1 className="mt-2 text-3xl font-bold tracking-tight">{ACCOUNT_COPY.title}</h1>
          </div>
          <p className="text-sm text-muted-foreground break-all">{email}</p>
        </div>

        {pageState === "loading" ? (
          <div className="space-y-4" data-state="loading">
            {[1, 2, 3].map((i) => (
              <div key={i} className="h-40 animate-pulse rounded-xl border bg-card shadow-sm" />
            ))}
          </div>
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
            <p className="text-muted-foreground mt-2 max-w-md">{credits.error}</p>
            <Button onClick={credits.reload} className="mt-6" variant="outline" disabled={credits.loading}>
              <RefreshCw className={`w-4 h-4 mr-2 ${credits.loading ? "animate-spin" : ""}`} />
              {ACCOUNT_COPY.retry}
            </Button>
          </div>
        ) : (
          <div className="space-y-4" data-state="ready">
            <ProfileCard userId={user.id} email={email} />
            {credits.summary && (
              <PlanCreditsCard
                summary={credits.summary}
                error={credits.error}
                refreshing={credits.loading}
                onRetry={credits.reload}
              />
            )}
            <PlansGrid summary={credits.summary} />
            <UsageTable userId={user.id} />
            <DangerZone email={email} />
          </div>
        )}
      </main>
    </div>
  );
}
