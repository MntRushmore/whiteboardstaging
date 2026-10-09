"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, Bug, RefreshCw, Send } from "lucide-react";
import { AuthErrorBanner, useAuth } from "@/components/AuthProvider";
import { AppHeader, APP_CONTENT_CLASS } from "@/components/app/AppHeader";
import { describeError } from "@/lib/errorMessage";
import { loadMyReports, markRepliesSeen, sendReply } from "@/lib/bugReports/client";
import { BUG_MESSAGE_MAX, type BugMessage, type MyBugReport } from "@/lib/bugReports/contracts";
import { setBugUnread } from "@/lib/bugReports/unread";
import { REPORTS_COPY, reportTarget, reportView, totalUnread, withReply, type ReportsClock } from "@/lib/bugReports/view";
import { openProfilePicker } from "@/lib/family/picker";
import { Alert } from "@/registry/components/alert/alert";
import { Badge } from "@/registry/components/badge/badge";
import { Button } from "@/registry/components/button/button";
import { EmptyState } from "@/registry/components/empty-state/empty-state";
import { Skeleton } from "@/registry/components/skeleton/skeleton";
import styles from "./reports.module.css";

/** Writing back on one report: Send (or Ctrl / ⌘ + Enter); the words stay until they are saved, and a failure says why under the box. */
export function ReplyBox({ reportId, onReply }: { reportId: string; onReply: (body: string) => Promise<{ ok: true } | { ok: false; error: string }> }) {
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);
  const body = text.trim();
  const fieldId = `report-${reportId}-reply`;

  async function send() {
    if (!body || sending) return;
    setSending(true);
    setError(null);
    setSent(false);
    const r = await onReply(body);
    setSending(false);
    if (r.ok) {
      setText("");
      setSent(true);
    } else setError(REPORTS_COPY.sendFailed(r.error));
  }

  return (
    <div className={styles.reply}>
      <label htmlFor={fieldId} className={styles.replyLabel}>
        {REPORTS_COPY.replyLabel}
      </label>
      <textarea
        id={fieldId}
        className={styles.textarea}
        rows={3}
        value={text}
        placeholder={REPORTS_COPY.replyPlaceholder}
        maxLength={BUG_MESSAGE_MAX}
        readOnly={sending}
        aria-busy={sending || undefined}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? `${fieldId}-error` : `${fieldId}-keys`}
        onChange={(e) => {
          setText(e.target.value);
          if (error) setError(null);
          if (sent) setSent(false);
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
            e.preventDefault();
            void send();
          }
        }}
      />
      {error && (
        <p id={`${fieldId}-error`} role="alert" className={styles.replyError}>
          {error}
        </p>
      )}
      {sent && (
        <p role="status" className={styles.replySent}>
          {REPORTS_COPY.sent}
        </p>
      )}
      <div className={styles.replyActions}>
        <Button size="sm" onClick={() => void send()} disabled={!body || sending} data-testid="report-reply-send">
          <Send size={15} strokeWidth={1.9} aria-hidden />
          {sending ? REPORTS_COPY.sending : REPORTS_COPY.send}
        </Button>
        <span id={`${fieldId}-keys`} className={styles.replyKeys}>
          {REPORTS_COPY.sendKeys}
        </span>
      </div>
    </div>
  );
}

/** One report: its status in plain words, what they sent, the conversation, and the box to write back. */
function ReportCard({ report, clock, target, onReply }: { report: MyBugReport; clock: ReportsClock; target: boolean; onReply: (body: string) => Promise<{ ok: true } | { ok: false; error: string }> }) {
  const view = reportView(report, clock);
  const titleId = `report-${view.id}-title`;
  return (
    <li>
      <article id={view.id} className={styles.card} data-target={target || undefined} tabIndex={-1} aria-labelledby={titleId}>
        <div className={styles.cardHead}>
          <Badge tone={view.status.tone}>{view.status.label}</Badge>
          <span className={styles.when}>{view.sent}</span>
          {view.unread > 0 && <span className={styles.newMark}>{REPORTS_COPY.newMark(view.unread)}</span>}
        </div>
        <h2 id={titleId} className={styles.message} data-missing={view.messageMissing || undefined}>
          {view.message}
        </h2>
        <p className={styles.statusHint}>{view.status.hint}</p>
        {view.thread.length > 0 && (
          <ol className={styles.thread}>
            {view.thread.map((m) => (
              <li key={m.id} className={styles.bubble} data-author={m.author} data-new={m.isNew || undefined}>
                <span className={styles.bubbleHead}>
                  <span className={styles.bubbleWho}>{m.who}</span>
                  <span>{m.when}</span>
                  {m.isNew && <span className={styles.bubbleNew}>· {REPORTS_COPY.newOne}</span>}
                </span>
                <p className={styles.bubbleBody}>{m.body}</p>
              </li>
            ))}
          </ol>
        )}
        {view.footnote && <p className={styles.footnote}>{view.footnote}</p>}
        <ReplyBox reportId={view.id} onReply={onReply} />
      </article>
    </li>
  );
}

export interface ReportsContentProps {
  /** null while the first read is out, or when it failed */
  reports: MyBugReport[] | null;
  loading: boolean;
  error: string | null;
  onRetry: () => void;
  /** the report the address points at (`#<id>`) */
  target: { id: string; found: boolean } | null;
  clock: ReportsClock;
  onReply: (reportId: string, body: string) => Promise<{ ok: true } | { ok: false; error: string }>;
}

/** The page under its title: loading, failed, none yet, or the reports (and a word when the address points at one this profile does not have). */
export function ReportsContent({ reports, loading, error, onRetry, target, clock, onReply }: ReportsContentProps) {
  if (!reports && (loading || !error)) return <Skeleton lines={6} label={REPORTS_COPY.loading} />;
  if (!reports) {
    return (
      <Alert tone="danger" title={REPORTS_COPY.loadFailedTitle}>
        <p>{error || REPORTS_COPY.loadFailed}</p>
        <Button variant="secondary" size="sm" onClick={onRetry} className={styles.retry}>
          <RefreshCw size={14} aria-hidden />
          {REPORTS_COPY.retry}
        </Button>
      </Alert>
    );
  }
  const notHere = target && !target.found && (
    <Alert tone="info" title={REPORTS_COPY.notHereTitle} data-testid="report-not-here">
      <p>{REPORTS_COPY.notHere}</p>
      <Button variant="secondary" size="sm" onClick={openProfilePicker} className={styles.retry}>
        {REPORTS_COPY.switchProfile}
      </Button>
    </Alert>
  );
  if (reports.length === 0) {
    return (
      <>
        {notHere}
        <EmptyState icon={<Bug aria-hidden />} title={REPORTS_COPY.emptyTitle} description={REPORTS_COPY.emptyHint} />
      </>
    );
  }
  return (
    <>
      {notHere}
      <ol className={styles.list} aria-label={REPORTS_COPY.title}>
        {reports.map((r) => (
          <ReportCard key={r.id} report={r} clock={clock} target={target?.found === true && target.id.toLowerCase() === r.id.toLowerCase()} onReply={(body) => onReply(r.id, body)} />
        ))}
      </ol>
    </>
  );
}

/**
 * /reports: the signed-in user's bug reports, newest first, each with its status in plain words, the
 * conversation with us and a box to write back (src/lib/bugReports). Signed-in only (signed out goes
 * to /login), never paywalled; a kid profile sees its own. Opening it marks our replies read (the
 * header's dot goes out), while this visit still shows which were new. `#<report id>` (the reply
 * email's button, src/lib/email/templates.ts) scrolls to that report and rings it; one this profile
 * does not have (a grown-up opening their kid's email) says to switch profile.
 */
export function ReportsScreen() {
  const router = useRouter();
  const { user, loading: authLoading, authError } = useAuth();
  const [reports, setReports] = useState<MyBugReport[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hash, setHash] = useState("");
  // the times are written against the moment the reports were read
  const [readAt, setReadAt] = useState(() => Date.now());
  const userId = user?.id ?? null;

  useEffect(() => {
    if (!authLoading && !user && !authError) router.replace("/login");
  }, [user, authLoading, authError, router]);

  const load = useCallback(async () => {
    if (!userId) return;
    setLoading(true);
    setError(null);
    try {
      const mine = await loadMyReports();
      setReadAt(Date.now());
      setReports(mine);
      // read now: the dot goes out (this visit still marks which ones were new)
      if (totalUnread(mine) > 0) {
        if (await markRepliesSeen()) setBugUnread(userId, 0);
      } else setBugUnread(userId, 0);
    } catch (err) {
      setError(describeError(err, REPORTS_COPY.loadFailed));
    } finally {
      setLoading(false);
    }
  }, [userId]);

  useEffect(() => {
    void load();
  }, [load]);

  // the address's #<id>, now and when it changes (the dialog's link, a second email)
  useEffect(() => {
    const read = () => setHash(window.location.hash);
    read();
    window.addEventListener("hashchange", read);
    return () => window.removeEventListener("hashchange", read);
  }, []);

  const target = useMemo(() => reportTarget(hash, reports), [hash, reports]);

  // to the report the address points at, once it is on the page
  useEffect(() => {
    if (!target?.found) return;
    const card = document.getElementById(target.id);
    if (!card) return;
    const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    card.scrollIntoView({ behavior: reduce ? "auto" : "smooth", block: "start" });
    card.focus({ preventScroll: true });
  }, [target]);

  const reply = useCallback(async (reportId: string, body: string): Promise<{ ok: true } | { ok: false; error: string }> => {
    try {
      const message: BugMessage = await sendReply(reportId, body);
      setReports((list) => (list ? withReply(list, reportId, message) : list));
      return { ok: true };
    } catch (err) {
      return { ok: false, error: describeError(err, "Try again in a moment.") };
    }
  }, []);

  const clock = useMemo<ReportsClock>(() => ({ now: readAt }), [readAt]);

  return (
    <div className={styles.page}>
      <AppHeader />
      <main className={`${APP_CONTENT_CLASS} ${styles.main}`}>
        <div className={styles.inner}>
          <AuthErrorBanner />
          <div className={styles.titleBlock}>
            <Link href="/" className={styles.back}>
              <ArrowLeft size={16} aria-hidden />
              {REPORTS_COPY.back}
            </Link>
            <h1 className={styles.title}>{REPORTS_COPY.title}</h1>
            <p className={styles.subtitle}>{REPORTS_COPY.subtitle}</p>
          </div>
          {authLoading || !user ? (
            <Skeleton lines={6} label={REPORTS_COPY.loading} />
          ) : (
            <ReportsContent reports={reports} loading={loading} error={error} onRetry={() => void load()} target={target} clock={clock} onReply={reply} />
          )}
        </div>
      </main>
    </div>
  );
}
