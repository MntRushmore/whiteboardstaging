"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, RefreshCw, UserPlus, Users } from "lucide-react";
import { toast } from "sonner";
import { AuthErrorBanner, useAuth } from "@/components/AuthProvider";
import { AppHeader, APP_CONTENT_CLASS } from "@/components/app/AppHeader";
import { switchProfile } from "@/lib/family/client";
import { MAX_KIDS, type FamilyMember } from "@/lib/family/contracts";
import { FAMILY_COPY } from "@/lib/family/copy";
import { openProfilePicker } from "@/lib/family/picker";
import { switchErrorView } from "@/lib/family/switchError";
import { reportUserError } from "@/lib/reportAppError";
import { Alert } from "@/registry/components/alert/alert";
import { Button } from "@/registry/components/button/button";
import { EmptyState } from "@/registry/components/empty-state/empty-state";
import { Skeleton } from "@/registry/components/skeleton/skeleton";
import { KidCard } from "./KidCard";
import { KidDialog } from "./KidDialog";
import { PinCard } from "./PinCard";
import { RemoveKidDialog } from "./RemoveKidDialog";
import { useFamily } from "./useFamily";
import styles from "./familyPage.module.css";

/**
 * /family: the grown-up's page for their kids. Set the PIN (first), add a kid (name, grade,
 * picture), and for each kid this week's numbers, "Switch to <name>", "See progress", edit and
 * remove. A kid who lands here is told it is for grown-ups, with a way to switch profile. Signed-in
 * only (signed out goes to /login), never paywalled: a grown-up sets up the family before or after
 * the plan. Reads GET /api/family fresh on every visit (the numbers move).
 */
export function FamilyScreen() {
  const router = useRouter();
  const { user, loading: authLoading, authError } = useAuth();
  // the numbers move: read fresh on arrival, past the tab's kept copy
  const { state, loading, failed, reload } = useFamily(user?.id, { fresh: true });
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
  const full = kids.length >= MAX_KIDS;

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
              <p className={styles.sectionHint}>{!state.hasPin ? FAMILY_COPY.kidsNeedPin : full ? FAMILY_COPY.tooMany : FAMILY_COPY.kidsEmptyHint}</p>
            </div>
            <Button className={styles.sectionAction} onClick={() => setDialog({ kid: null })} disabled={!state.hasPin || full} data-testid="add-kid">
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
        </section>
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
