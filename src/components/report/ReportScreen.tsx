"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { ArrowLeft, RefreshCw, Users } from "lucide-react";
import { toast } from "sonner";
import { AuthErrorBanner, useAuth } from "@/components/AuthProvider";
import { AppHeader, APP_CONTENT_CLASS } from "@/components/app/AppHeader";
import { FAMILY_PATH, switchProfile } from "@/lib/family/client";
import { switchErrorView } from "@/lib/family/switchError";
import { browserTimeZone, loadReport } from "@/lib/report/client";
import { REPORT_PATH, type ChildWeek, type ReportAnswer } from "@/lib/report/contracts";
import { REPORT_COPY } from "@/lib/report/copy";
import { weekLabel } from "@/lib/report/view";
import { isReportableWeek, localDayIn, parseWeek, weekDays, weekStartAt } from "@/lib/report/week";
import { reportUserError } from "@/lib/reportAppError";
import { Alert } from "@/registry/components/alert/alert";
import { Button } from "@/registry/components/button/button";
import { Skeleton } from "@/registry/components/skeleton/skeleton";
import { ChildWeekCard } from "./ChildWeekCard";
import { EmailCard } from "./EmailCard";
import { WeekPicker } from "./WeekPicker";
import styles from "./report.module.css";

/**
 * /report: the weekly report, for the grown-up who pays. One card per kid (their own week too when
 * they practised), a week picker (this week, last week, earlier), and, where the Sunday email is
 * sent, its on/off switch. A kid profile that opens it sees their own week. Signed-in only (signed
 * out goes to /login). The week is in the URL (`?week=`), so the email's "See the full report"
 * opens the week it was about; weeks are the browser's own zone, Monday to Sunday.
 */
export function ReportScreen() {
  const router = useRouter();
  const params = useSearchParams();
  const { user, loading: authLoading, authError } = useAuth();
  const [timeZone] = useState(browserTimeZone);
  const [now] = useState(() => Date.now());
  const asked = parseWeek(params.get("week"));
  // a week from a link that is in the future or over a year back reads as this week
  const weekStart = asked && isReportableWeek(asked, now, timeZone) ? asked : weekStartAt(now, timeZone);

  const [version, setVersion] = useState(0);
  const [busyKid, setBusyKid] = useState<string | null>(null);
  // the last read, keyed by what it was for: loading is "the last read is for something else"
  const key = `${user?.id ?? ""}|${weekStart}|${version}`;
  const [read, setRead] = useState<{ key: string; answer: ReportAnswer | null } | null>(null);
  const [kept, setKept] = useState<ReportAnswer | null>(null);
  const loading = !read || read.key !== key;
  const failed = !loading && read.answer === null;
  const answer = !loading ? read.answer : kept;

  useEffect(() => {
    if (!authLoading && !user && !authError) router.replace("/login");
  }, [user, authLoading, authError, router]);

  useEffect(() => {
    if (!user) return;
    const abort = new AbortController();
    loadReport(weekStart, timeZone, abort.signal)
      .then((a) => {
        setRead({ key, answer: a });
        setKept(a);
      })
      .catch((err) => {
        if (abort.signal.aborted) return;
        setRead({ key, answer: null });
        reportUserError({ kind: "live.account", code: "report_load", message: err instanceof Error ? err.message : String(err) });
      });
    return () => abort.abort();
  }, [user, weekStart, timeZone, key]);

  const pickWeek = useCallback(
    (next: string) => {
      router.replace(next === weekStartAt(now, timeZone) ? REPORT_PATH : `${REPORT_PATH}?week=${next}`, { scroll: false });
    },
    [router, now, timeZone],
  );

  const current = weekStart === weekStartAt(now, timeZone);
  const todayIndex = useMemo(() => (current ? weekDays(weekStart).indexOf(localDayIn(now, timeZone)) : null), [current, weekStart, now, timeZone]);
  // while another week loads, the last one stays (dimmed) rather than flashing a skeleton
  const shown = answer && (answer.report.weekStart === weekStart || loading) ? answer : null;

  async function practise(child: ChildWeek) {
    if (!shown) return;
    if (shown.role === "kid" || child.userId === user?.id) {
      router.push("/");
      return;
    }
    setBusyKid(child.userId);
    try {
      await switchProfile(child.userId, { dest: "/" });
    } catch (err) {
      const view = switchErrorView(err);
      toast.error(view.message);
      if (!view.expected) reportUserError({ kind: "live.account", code: view.code, message: view.message });
      setBusyKid(null);
    }
  }

  let body: React.ReactNode;
  if (authLoading || !user || (!shown && loading && !failed)) {
    body = <Skeleton lines={8} avatar label={REPORT_COPY.loading} />;
  } else if (failed) {
    body = (
      <Alert tone="danger" title={REPORT_COPY.loadFailedTitle}>
        <p>{REPORT_COPY.loadFailed}</p>
        <Button variant="secondary" size="sm" onClick={() => setVersion((v) => v + 1)} className={styles.retry}>
          <RefreshCw size={14} aria-hidden />
          {REPORT_COPY.retry}
        </Button>
      </Alert>
    );
  } else if (shown) {
    const kids = shown.report.children.filter((c) => c.userId !== shown.report.ownerId);
    body = (
      <>
        <ul className={styles.children} data-loading={loading ? "" : undefined} aria-busy={loading}>
          {shown.report.children.map((c) => (
            <ChildWeekCard
              key={c.userId}
              week={c}
              self={c.userId === user.id}
              current={current}
              todayIndex={todayIndex !== null && todayIndex >= 0 ? todayIndex : null}
              onWatch={(boardId) => router.push(`${REPORT_PATH}/replay/${boardId}`)}
              onPractice={() => void practise(c)}
              practiceBusy={busyKid === c.userId}
            />
          ))}
        </ul>
        {shown.role === "parent" && kids.length === 0 && (
          <div className={styles.note}>
            <span>{REPORT_COPY.noKids}</span>
            <Button variant="secondary" size="sm" onClick={() => router.push(FAMILY_PATH)}>
              <Users size={15} aria-hidden />
              {REPORT_COPY.familyLink}
            </Button>
          </div>
        )}
        {shown.email?.sending && <EmailCard optedOut={shown.email.optedOut} />}
      </>
    );
  }

  return (
    <div className={styles.page}>
      <AppHeader />
      <main className={`${APP_CONTENT_CLASS} ${styles.main}`}>
        <div className={styles.inner}>
          <AuthErrorBanner />
          <div className={styles.head}>
            <div className={styles.titleBlock}>
              <Link href="/" className={styles.back}>
                <ArrowLeft size={16} aria-hidden />
                {REPORT_COPY.back}
              </Link>
              <h1 className={styles.title}>{REPORT_COPY.pageTitle}</h1>
              <p className={styles.subtitle}>{REPORT_COPY.subtitle(weekLabel(weekStart))}</p>
            </div>
            <WeekPicker weekStart={weekStart} now={now} timeZone={timeZone} onChange={pickWeek} />
          </div>
          {body}
        </div>
      </main>
    </div>
  );
}
