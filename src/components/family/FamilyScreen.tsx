"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, CalendarCheck, RefreshCw, UserPlus, Users } from "lucide-react";
import { toast } from "sonner";
import { AuthErrorBanner, useAuth } from "@/components/AuthProvider";
import { AppHeader, APP_CONTENT_CLASS } from "@/components/app/AppHeader";
import { useUnlimited } from "@/lib/billing/useUnlimited";
import { switchProfile } from "@/lib/family/client";
import type { FamilyMember } from "@/lib/family/contracts";
import { FAMILY_COPY } from "@/lib/family/copy";
import { addKidBlock } from "@/lib/family/forms";
import { PLAN_PATH } from "@/lib/onboarding/planMarker";
import { openProfilePicker } from "@/lib/family/picker";
import { REPORT_MENU } from "@/lib/report/menu";
import { switchErrorView } from "@/lib/family/switchError";
import { reportUserError } from "@/lib/reportAppError";
import { Alert } from "@/registry/components/alert/alert";
import { Button } from "@/registry/components/button/button";
import { EmptyState } from "@/registry/components/empty-state/empty-state";
import { Skeleton } from "@/registry/components/skeleton/skeleton";
import { KidCard } from "./KidCard";
import { KidDialog } from "./KidDialog";
import { ReferralCard } from "@/components/referral/ReferralCard";
import { PinCard } from "./PinCard";
import { RemoveKidDialog } from "./RemoveKidDialog";
import { useFamily } from "./useFamily";
import styles from "./familyPage.module.css";

/**
 * /family: the grown-up's page for their kids. Set the PIN (first), add a kid (name, grade,
 * picture), and for each kid this week's numbers, "Switch to <name>", "See progress", edit and
 * remove. A kid who lands here is told it is for grown-ups, with a way to switch profile. Signed-in
 * only (signed out goes to /login), never paywalled: a grown-up sets the PIN before or after the
 * plan, but adds kids only with Agathon Unlimited on (kids share it and have no ink of their own;
 * the server refuses otherwise), so without it the Kids section says "Start your free trial" with a
 * link to the plan screen. Reads GET /api/family fresh on every visit (the numbers move).
 */
export function FamilyScreen() {
  const router = useRouter();
  const { user, loading: authLoading, authError } = useAuth();
  // the numbers move: read fresh on arrival, past the tab's kept copy
  const { state, loading, failed, reload } = useFamily(user?.id, { fresh: true });
  const plan = useUnlimited();
  const [dialog, setDialog] = useState<{ kid: FamilyMember | null } | null>(null);
  const [removing, setRemoving] = useState<FamilyMember | null>(null);
  const [busy, setBusy] = useState<{ id: string; what: "switch" | "progress" } | null>(null);

  useEffect(() => {
    if (!authLoading && !user && !authError) router.replace("/login");
  }, [user, authLoading, authError, router]);

  async function become(kid: FamilyMember, what: "switch" | "progress") {
    if (busy) return;
    setBusy({ id: kid.userId, what });
    try {
      await switchProfile(kid.userId, { dest: what === "progress" ? "/progress" : "/" });
    } catch (err) {
      const view = switchErrorView(err);
      toast.error(view.message);
      if (!view.expected) reportUserError({ kind: "live.account", code: view.code, message: view.message });
      setBusy(null);
    }
  }

  const kids = state?.members.filter((m) => !m.isParent) ?? [];
  const block = addKidBlock({ hasPin: state?.hasPin ?? false, kids: kids.length, plan: { known: plan.known, status: plan.state.status } });
  const kidsHint =
    block === "plan" ? (
      <>
        {FAMILY_COPY.kidsNeedPlan}{" "}
        <Link href={PLAN_PATH} className={styles.planLink} data-testid="kids-need-plan">
          {FAMILY_COPY.kidsNeedPlanLink}
        </Link>
      </>
    ) : block === "active_plan" ? (
      <>
        {FAMILY_COPY.kidsNeedActivePlan}{" "}
        <Link href="/account" className={styles.planLink}>
          {FAMILY_COPY.kidsNeedActivePlanLink}
        </Link>
      </>
    ) : block === "pin" ? (
      FAMILY_COPY.kidsNeedPin
    ) : block === "full" ? (
      FAMILY_COPY.tooMany
    ) : (
      FAMILY_COPY.kidsEmptyHint
    );

  let body: React.ReactNode;
  if (authLoading || !user || (loading && !state)) {
    body = <Skeleton lines={6} avatar label="Loading your family" />;
  } else if (!state) {
    body = (
      <Alert tone="danger" title={FAMILY_COPY.loadFailedTitle}>
        <p>{failed ? FAMILY_COPY.loadFailed : null}</p>
        <Button variant="secondary" size="sm" onClick={() => reload()} className={styles.retry}>
          <RefreshCw size={14} aria-hidden />
          {FAMILY_COPY.retry}
        </Button>
      </Alert>
    );
  } else if (state.role === "kid") {
    body = (
      <EmptyState
        title={FAMILY_COPY.kidsOnly}
        description={FAMILY_COPY.kidsOnlyHint}
        icon={<Users aria-hidden />}
        action={<Button onClick={openProfilePicker}>{FAMILY_COPY.switchProfile}</Button>}
      />
    );
  } else {
    body = (
      <div className={styles.stack}>
        <PinCard hasPin={state.hasPin} />

        <section className={styles.section} aria-labelledby="family-kids-title">
          <div className={styles.sectionHead}>
            <span className={styles.sectionIcon} aria-hidden>
              <Users size={18} strokeWidth={1.9} />
            </span>
            <div>
              <h2 id="family-kids-title" className={styles.sectionTitle}>
                {FAMILY_COPY.kidsTitle}
              </h2>
              <p className={styles.sectionHint}>{kidsHint}</p>
            </div>
            <Button className={styles.sectionAction} onClick={() => setDialog({ kid: null })} disabled={block !== null} data-testid="add-kid">
              <UserPlus size={16} strokeWidth={1.9} aria-hidden />
              {FAMILY_COPY.addKid}
            </Button>
          </div>

          {kids.length === 0 ? (
            <p className={styles.emptyKids}>{FAMILY_COPY.kidsEmpty}</p>
          ) : (
            <ul className={styles.kids}>
              {kids.map((kid) => (
                <KidCard
                  key={kid.userId}
                  kid={kid}
                  busy={busy?.id === kid.userId ? busy.what : null}
                  locked={busy !== null && busy.id !== kid.userId}
                  onSwitch={() => void become(kid, "switch")}
                  onProgress={() => void become(kid, "progress")}
                  onEdit={() => setDialog({ kid })}
                  onRemove={() => setRemoving(kid)}
                />
              ))}
            </ul>
          )}
          {kids.length > 0 && (
            <div className={styles.kidActions}>
              <Button variant="secondary" onClick={() => router.push(REPORT_MENU.path)} data-testid="family-report">
                <CalendarCheck size={16} strokeWidth={1.9} aria-hidden />
                {REPORT_MENU.familyButton}
              </Button>
            </div>
          )}
        </section>

        <ReferralCard />
      </div>
    );
  }

  return (
    <div className={styles.page}>
      <AppHeader />
      <main className={`${APP_CONTENT_CLASS} ${styles.main}`}>
        <div className={styles.inner}>
          <AuthErrorBanner />
          <div className={styles.titleBlock}>
            <Link href="/" className={styles.back}>
              <ArrowLeft size={16} aria-hidden />
              {FAMILY_COPY.back}
            </Link>
            <h1 className={styles.title}>{FAMILY_COPY.pageTitle}</h1>
            <p className={styles.subtitle}>{FAMILY_COPY.pageSubtitle}</p>
          </div>
          {body}
        </div>
      </main>

      <KidDialog
        open={dialog !== null}
        kid={dialog?.kid ?? null}
        onOpenChange={(open) => !open && setDialog(null)}
        // the write itself makes every reader re-read (FAMILY_CHANGED_EVENT)
        onSaved={(name) => {
          if (!dialog?.kid) toast.success(FAMILY_COPY.addKidAdded(name));
        }}
      />
      <RemoveKidDialog kid={removing} onOpenChange={(open) => !open && setRemoving(null)} onRemoved={(name) => toast.success(FAMILY_COPY.removed(name))} />
    </div>
  );
}
