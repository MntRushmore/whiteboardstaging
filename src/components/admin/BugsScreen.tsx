"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { ArrowLeft, ArrowUpRight, Ban, Camera, CircleCheck, Eye, Inbox, LayoutGrid, MessagesSquare, RotateCcw, ScrollText, Send } from "lucide-react";
import { ADMIN_API, AdminBugListSchema, BUG_STATUSES, type AdminBug, type BugStatus } from "@/lib/admin/contracts";
import { BUGS_COPY, BUG_STATUS_LABELS, bugKeyAction, bugTabs, bugView, bugsInTab, moveSelection, selectionAfterLeaving, type BugView } from "@/lib/admin/bugsView";
import { CONSOLE_COPY } from "@/lib/admin/consoleView";
import { ADMIN_COPY, formatWhen, relativeTime, type ViewClock } from "@/lib/admin/view";
import { BUG_MESSAGE_MAX } from "@/lib/bugReports/contracts";
import { Button } from "@/registry/components/button/button";
import { Dialog, DialogContent } from "@/registry/components/dialog/dialog";
import { AdminFrame, PageHeader, useAdminAccess } from "./AdminFrame";
import { ChoiceRow, Empty, LoadFailed, Pill, SkeletonRows } from "./ConsoleBits";
import { replyToBug, updateBug, type ActionResult } from "./adminActions";
import { readAdminBlob } from "./adminData";
import { isTyping, useWide } from "./consoleHooks";
import { useAdminResource } from "./useAdminResource";
import { useNow } from "./useNow";
import styles from "./admin.module.css";
import c from "./console.module.css";

/** The screenshot, read with the admin's token into a blob URL (let go when it leaves); a tap opens it full size. */
export function BugScreenshot({ url, alt }: { url: string; alt: string }) {
  const [shot, setShot] = useState<{ url: string; src: string | null; failed: boolean } | null>(null);
  const [open, setOpen] = useState(false);
  useEffect(() => {
    let live = true;
    let made: string | null = null;
    readAdminBlob(url)
      .then((blob) => {
        made = URL.createObjectURL(blob);
        if (live) setShot({ url, src: made, failed: false });
        else URL.revokeObjectURL(made);
      })
      .catch(() => {
        if (live) setShot({ url, src: null, failed: true });
      });
    return () => {
      live = false;
      if (made) URL.revokeObjectURL(made);
    };
  }, [url]);
  const current = shot && shot.url === url ? shot : null;
  if (!current) return <div className={`${styles.pulse} ${c.shotFrame}`} aria-label={BUGS_COPY.screenshotLoading} role="img" />;
  if (current.failed || !current.src) return <p className={styles.quiet}>{BUGS_COPY.screenshotFailed}</p>;
  return (
    <>
      <button type="button" className={c.shotButton} onClick={() => setOpen(true)} aria-label={`${BUGS_COPY.screenshotOpen}: ${alt}`}>
        {/* eslint-disable-next-line @next/next/no-img-element -- a blob: URL read with the admin's token; next/image cannot load it */}
        <img src={current.src} alt={alt} className={c.shotImage} />
      </button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent title={BUGS_COPY.screenshot} description={alt} className={c.lightbox}>
          {/* eslint-disable-next-line @next/next/no-img-element -- as above */}
          <img src={current.src} alt={alt} className={c.lightboxImage} />
        </DialogContent>
      </Dialog>
    </>
  );
}

const STATUS_ACTIONS: { status: BugStatus; label: string; icon: ReactNode; key: string }[] = [
  { status: "seen", label: BUGS_COPY.markSeen, icon: <Eye size={15} strokeWidth={1.9} aria-hidden />, key: "s" },
  { status: "fixed", label: BUGS_COPY.markFixed, icon: <CircleCheck size={15} strokeWidth={1.9} aria-hidden />, key: "f" },
  { status: "wontfix", label: BUGS_COPY.markWontfix, icon: <Ban size={15} strokeWidth={1.9} aria-hidden />, key: "w" },
];

/**
 * The reply box under the conversation: Send (or Ctrl / ⌘ + Enter) posts it; the box is kept while it
 * is on its way and cleared once it is saved; a failure says why under the box and keeps the words.
 */
export function BugReplyBox({ bugId, onReply }: { bugId: string; onReply: (body: string) => Promise<ActionResult> }) {
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const body = text.trim();
  const fieldId = `bug-${bugId}-reply`;

  async function send() {
    if (!body || sending) return;
    setSending(true);
    setError(null);
    const r = await onReply(body);
    setSending(false);
    if (r.ok) setText("");
    else setError(BUGS_COPY.replyFailed(r.error));
  }

  return (
    <div className={c.replyBox}>
      <label htmlFor={fieldId} className={styles.chartTitle}>
        {BUGS_COPY.replyLabel}
      </label>
      <textarea
        id={fieldId}
        className={c.textarea}
        rows={3}
        value={text}
        placeholder={BUGS_COPY.replyPlaceholder}
        maxLength={BUG_MESSAGE_MAX}
        readOnly={sending}
        aria-busy={sending || undefined}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? `${fieldId}-error` : `${fieldId}-keys`}
        onChange={(e) => {
          setText(e.target.value);
          if (error) setError(null);
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
            e.preventDefault();
            void send();
          }
        }}
      />
      {error && (
        <p id={`${fieldId}-error`} role="alert" className={c.replyError}>
          {error}
        </p>
      )}
      <div className={c.replyActions}>
        <Button variant="primary" size="sm" onClick={() => void send()} disabled={!body || sending} data-testid="bug-reply-send">
          <Send size={15} strokeWidth={1.9} aria-hidden />
          {sending ? BUGS_COPY.sending : BUGS_COPY.send}
        </Button>
        <span id={`${fieldId}-keys`} className={c.replyKeys}>
          {BUGS_COPY.sendKeys}
        </span>
      </div>
    </div>
  );
}

/** The conversation with the reporter, oldest first (ours on the right), and the reply box. */
function BugThread({ bug, onReply }: { bug: BugView; onReply: (body: string) => Promise<ActionResult> }) {
  const titleId = `bug-${bug.id}-thread`;
  return (
    <section className={c.bugBlock} aria-labelledby={titleId}>
      <h3 id={titleId} className={styles.chartTitle}>
        <MessagesSquare size={14} strokeWidth={1.9} aria-hidden /> {BUGS_COPY.conversation}
      </h3>
      {bug.thread.length > 0 ? (
        <ol className={c.thread}>
          {bug.thread.map((m) => (
            <li key={m.id} className={c.message} data-author={m.author}>
              <span className={c.messageHead}>
                <span className={c.messageWho}>{m.who}</span>
                <span title={m.whenTitle}>{m.when}</span>
              </span>
              <p className={c.messageBody}>{m.body}</p>
            </li>
          ))}
        </ol>
      ) : (
        bug.canReply && <p className={styles.quiet}>{BUGS_COPY.conversationEmpty}</p>
      )}
      {bug.seenByThem && <p className={c.blockHint}>{bug.seenByThem}</p>}
      {bug.canReply ? <BugReplyBox bugId={bug.id} onReply={onReply} /> : <p className={styles.quiet}>{BUGS_COPY.noReporter}</p>}
    </section>
  );
}

/** One report, read in full: its words, who and from where, the board, the conversation, the screenshot, the logs, and what to do with it. */
export function BugDetail({
  bug,
  onStatus,
  onNote,
  onReply,
  onBack,
}: {
  bug: BugView;
  onStatus: (status: BugStatus, note?: string) => void;
  onNote: (note: string) => void;
  onReply: (body: string) => Promise<ActionResult>;
  onBack?: () => void;
}) {
  const [note, setNote] = useState(bug.note);
  const edited = note.trim() !== bug.note.trim();
  return (
    <article className={c.bugDetail} aria-labelledby={`bug-${bug.id}-title`}>
      {onBack && (
        <button type="button" className={styles.back} onClick={onBack}>
          <ArrowLeft size={16} strokeWidth={1.9} aria-hidden />
          {BUGS_COPY.back}
        </button>
      )}
      <div className={c.bugDetailHead}>
        <Pill tone={bug.statusTone}>{bug.statusLabel}</Pill>
        {bug.waiting && <Pill tone="warn">{BUGS_COPY.waiting}</Pill>}
        <span className={c.bugDetailWhen} title={bug.whenTitle}>
          {bug.when} · {bug.ago}
        </span>
        {bug.resolved && <span className={c.bugDetailWhen}>{bug.resolved}</span>}
      </div>
      <h2 id={`bug-${bug.id}-title`} className={c.bugMessage} data-missing={bug.messageMissing || undefined}>
        {bug.message}
      </h2>

      <div className={c.bugActions} role="group" aria-label={BUGS_COPY.actions}>
        {STATUS_ACTIONS.filter((a) => a.status !== bug.status).map((a) => (
          <Button key={a.status} variant={a.status === "fixed" ? "primary" : "secondary"} size="sm" onClick={() => onStatus(a.status, edited ? note : undefined)} aria-keyshortcuts={a.key}>
            {a.icon}
            {a.label}
          </Button>
        ))}
        {bug.status !== "new" && (
          <Button variant="ghost" size="sm" onClick={() => onStatus("new", edited ? note : undefined)}>
            <RotateCcw size={15} strokeWidth={1.9} aria-hidden />
            {BUGS_COPY.markNew}
          </Button>
        )}
      </div>

      <dl className={c.kv}>
        <div>
          <dt>{BUGS_COPY.from}</dt>
          <dd>
            {bug.userHref ? (
              <Link href={bug.userHref} className={c.inlineLink}>
                {bug.who}
              </Link>
            ) : (
              <span data-missing>{bug.who}</span>
            )}
          </dd>
        </div>
        {bug.device.summary && (
          <div>
            <dt>{BUGS_COPY.device}</dt>
            <dd>
              {bug.device.summary}
              {bug.device.more && <span className={c.kvMore}>{bug.device.more}</span>}
            </dd>
          </div>
        )}
        {bug.path && (
          <div>
            <dt>{BUGS_COPY.page}</dt>
            <dd>
              <code className={c.code} title={bug.path}>
                {bug.path}
              </code>
            </dd>
          </div>
        )}
        {bug.boardHref && (
          <div>
            <dt>{BUGS_COPY.board}</dt>
            <dd>
              <Link href={bug.boardHref} className={c.inlineLink}>
                <LayoutGrid size={14} strokeWidth={1.9} aria-hidden />
                {BUGS_COPY.openBoard}
                <ArrowUpRight size={14} strokeWidth={1.9} aria-hidden />
              </Link>
            </dd>
          </div>
        )}
      </dl>

      <BugThread bug={bug} onReply={onReply} />

      <section className={c.bugBlock} aria-label={BUGS_COPY.screenshot}>
        <h3 className={styles.chartTitle}>
          <Camera size={14} strokeWidth={1.9} aria-hidden /> {BUGS_COPY.screenshot}
        </h3>
        {bug.screenshotUrl ? <BugScreenshot url={bug.screenshotUrl} alt={BUGS_COPY.screenshotAlt(bug.who)} /> : <p className={styles.quiet}>{BUGS_COPY.noScreenshot}</p>}
      </section>

      <section className={c.bugBlock} aria-label={BUGS_COPY.logs(bug.logs.length)}>
        <h3 className={styles.chartTitle}>
          <ScrollText size={14} strokeWidth={1.9} aria-hidden /> {BUGS_COPY.logs(bug.logs.length)}
        </h3>
        {bug.logs.length === 0 ? (
          <p className={styles.quiet}>{BUGS_COPY.noLogs}</p>
        ) : (
          <>
            <p className={c.blockHint}>{BUGS_COPY.logsHint}</p>
            <ol className={c.logs}>
              {bug.logs.map((l) => (
                <li key={l.key} data-level={l.level}>
                  <span className={c.logTime}>{l.time}</span>
                  <span className={c.logLevel}>{l.levelLabel}</span>
                  <span className={c.logText}>{l.text}</span>
                </li>
              ))}
            </ol>
          </>
        )}
      </section>

      <section className={c.bugBlock}>
        <label htmlFor={`bug-${bug.id}-note`} className={styles.chartTitle}>
          {BUGS_COPY.noteLabel}
        </label>
        <textarea id={`bug-${bug.id}-note`} className={c.textarea} rows={3} value={note} placeholder={BUGS_COPY.notePlaceholder} onChange={(e) => setNote(e.target.value)} maxLength={2000} />
        {edited && (
          <div className={c.noteActions}>
            <Button variant="secondary" size="sm" onClick={() => onNote(note)}>
              {BUGS_COPY.saveNote}
            </Button>
            <Button variant="ghost" size="sm" onClick={() => setNote(bug.note)}>
              {BUGS_COPY.cancelNote}
            </Button>
          </div>
        )}
      </section>
    </article>
  );
}

function BugRow({ bug, selected, onSelect }: { bug: BugView; selected: boolean; onSelect: () => void }) {
  return (
    <li>
      <button type="button" id={`bug-row-${bug.id}`} className={c.bugRow} aria-current={selected || undefined} onClick={onSelect} data-status={bug.status}>
        <span className={c.bugRowHead}>
          {bug.status === "new" && <span className={c.newDot} aria-hidden />}
          <span className={c.bugRowWho} data-missing={bug.whoMissing || undefined}>
            {bug.who}
          </span>
          {bug.waiting && <Pill tone="warn">{BUGS_COPY.waiting}</Pill>}
          <span className={c.bugRowWhen} title={bug.whenTitle}>
            {bug.ago}
          </span>
        </span>
        <span className={c.bugRowText} data-missing={bug.messageMissing || undefined}>
          {bug.excerpt}
        </span>
        <span className={c.bugRowMeta}>
          {bug.thread.length > 0 && (
            <span>
              <MessagesSquare size={12} strokeWidth={2} aria-hidden /> {BUGS_COPY.messages(bug.thread.length)}
            </span>
          )}
          {bug.device.summary && <span>{bug.device.summary}</span>}
          {bug.hasScreenshot && (
            <span>
              <Camera size={12} strokeWidth={2} aria-hidden /> {BUGS_COPY.screenshot}
            </span>
          )}
          {bug.boardHref && (
            <span>
              <LayoutGrid size={12} strokeWidth={2} aria-hidden /> {BUGS_COPY.board}
            </span>
          )}
        </span>
      </button>
    </li>
  );
}

export interface BugsContentProps {
  bugs: AdminBug[] | null;
  clock: ViewClock;
  tab: BugStatus;
  onTab: (tab: BugStatus) => void;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  onStatus: (bug: AdminBug, status: BugStatus, note?: string) => void;
  onNote: (bug: AdminBug, note: string) => void;
  /** a reply to the report's reporter: resolves once it is saved (or why not) */
  onReply: (bug: AdminBug, body: string) => Promise<ActionResult>;
  loading: boolean;
  error: string | null;
  updated: string | null;
  onRefresh: () => void;
  /** side by side from 1000 px; one at a time below */
  layout: "split" | "stack";
}

/** The inbox under its header: the status tabs with counts, the reports, and the open one. */
export function BugsContent({ bugs, clock, tab, onTab, selectedId, onSelect, onStatus, onNote, onReply, loading, error, updated, onRefresh, layout }: BugsContentProps) {
  const list = useMemo(() => (bugs ? bugsInTab(bugs, tab).map((b) => bugView(b, clock)) : []), [bugs, tab, clock]);
  const tabs = useMemo(() => (bugs ? bugTabs(bugs) : null), [bugs]);
  const selectedBug = bugs?.find((b) => b.id === selectedId) ?? null;
  const selected = selectedBug ? bugView(selectedBug, clock) : null;

  let body: ReactNode;
  if (!bugs && loading) body = <SkeletonRows rows={6} height="5rem" />;
  else if (!bugs) body = <LoadFailed title={CONSOLE_COPY.loadFailed(BUGS_COPY.loadWhat)} error={error} onRetry={onRefresh} />;
  else if (bugs.length === 0) body = <Empty icon={<Inbox size={22} strokeWidth={1.6} />} title={BUGS_COPY.noneYetTitle} hint={BUGS_COPY.noneYetHint} />;
  else {
    const detail = selected && selectedBug && (
      <BugDetail
        key={selected.id}
        bug={selected}
        onStatus={(status, note) => onStatus(selectedBug, status, note)}
        onNote={(note) => onNote(selectedBug, note)}
        onReply={(body) => onReply(selectedBug, body)}
        onBack={layout === "stack" ? () => onSelect(null) : undefined}
      />
    );
    const listBlock =
      list.length === 0 ? (
        <Empty icon={<CircleCheck size={22} strokeWidth={1.6} />} title={BUGS_COPY.emptyTitle(tab)} hint={BUGS_COPY.emptyHint(tab)} />
      ) : (
        <ul className={c.bugList} aria-label={BUGS_COPY.listLabel(BUG_STATUS_LABELS[tab])}>
          {list.map((b) => (
            <BugRow key={b.id} bug={b} selected={b.id === selectedId} onSelect={() => onSelect(b.id)} />
          ))}
        </ul>
      );
    body = (
      <>
        <div className={c.inboxBar}>
          <ChoiceRow
            label={BUGS_COPY.tabsLabel}
            options={(tabs ?? []).map((t) => ({ key: t.status, label: t.label, count: t.count, urgent: t.status === "new" && t.count !== "0" }))}
            value={tab}
            onChange={onTab}
          />
          <p className={c.keysHint}>{BUGS_COPY.keys}</p>
        </div>
        {layout === "split" ? (
          <div className={c.inbox}>
            <div className={c.inboxList}>{listBlock}</div>
            <div className={c.inboxDetail}>{detail ?? <p className={c.pick}>{list.length > 0 ? BUGS_COPY.pick : ""}</p>}</div>
          </div>
        ) : (
          (detail ?? listBlock)
        )}
      </>
    );
  }

  return (
    <div className={styles.inner}>
      <PageHeader title={BUGS_COPY.title} hint={BUGS_COPY.hint} updated={bugs ? updated : null} refreshing={loading} stale={error ? CONSOLE_COPY.staleNote : null} onRefresh={onRefresh} />
      <div className={c.pageBody}>{body}</div>
    </div>
  );
}

/** Reads ?id= and ?tab= once; writes them back as the selection changes (no new history entries). The last: a tab with one report open in it. */
function useInboxAddress(): [BugStatus, (t: BugStatus) => void, string | null, (id: string | null) => void, (t: BugStatus, id: string) => void] {
  const [state, setState] = useState<{ tab: BugStatus; id: string | null }>(() => {
    if (typeof window === "undefined") return { tab: "new", id: null };
    const p = new URLSearchParams(window.location.search);
    const tab = p.get("tab");
    return { tab: (BUG_STATUSES as readonly string[]).includes(tab ?? "") ? (tab as BugStatus) : "new", id: p.get("id") };
  });
  useEffect(() => {
    const url = new URL(window.location.href);
    url.searchParams.set("tab", state.tab);
    if (state.id) url.searchParams.set("id", state.id);
    else url.searchParams.delete("id");
    if (url.href !== window.location.href) window.history.replaceState(window.history.state, "", url);
  }, [state]);
  const setTab = useCallback((tab: BugStatus) => setState({ tab, id: null }), []);
  const setId = useCallback((id: string | null) => setState((s) => ({ ...s, id })), []);
  const show = useCallback((tab: BugStatus, id: string) => setState({ tab, id }), []);
  return [state.tab, setTab, state.id, setId, show];
}

/** /admin/bugs: the inbox. Admins only (see AdminFrame). */
export function BugsScreen({ notFound }: { notFound: ReactNode }) {
  const access = useAdminAccess();
  const res = useAdminResource(access.canRead ? ADMIN_API.bugs : null, AdminBugListSchema, { pollMs: 60_000 });
  const now = useNow();
  const clock = useMemo(() => ({ now }), [now]);
  const [tab, setTab, selectedId, setSelected, showInTab] = useInboxAddress();
  const split = useWide(1000);
  const bugs = res.data?.bugs ?? null;
  const updated = res.data ? ADMIN_COPY.updated(relativeTime(res.data.generatedAt, now) ?? formatWhen(res.data.generatedAt, clock)) : null;

  // a report opened by its address in another tab: show that tab, with the report still open (the
  // reporter-replied email links to ?id= alone)
  const opened = useRef(false);
  useEffect(() => {
    if (opened.current || !bugs || !selectedId) return;
    opened.current = true;
    const b = bugs.find((x) => x.id === selectedId);
    if (b && b.status !== tab) showInTab(b.status, b.id);
  }, [bugs, selectedId, tab, showInTab]);

  const ids = useMemo(() => (bugs ? bugsInTab(bugs, tab).map((b) => b.id) : []), [bugs, tab]);
  // the split view always has one open: the first, until another is picked
  const shownId = selectedId && ids.includes(selectedId) ? selectedId : split ? (ids[0] ?? null) : null;

  // a phone shows one report at a time: open it from its top
  useEffect(() => {
    if (!split && shownId) window.scrollTo({ top: 0 });
  }, [split, shownId]);

  const setStatus = useCallback(
    (bug: AdminBug, status: BugStatus, note?: string) => {
      if (bug.status === status && note === undefined) return;
      if (bug.status !== status && bug.status === tab) setSelected(split ? selectionAfterLeaving(ids, bug.id) : null);
      void updateBug(bug, note === undefined ? { status } : { status, note }).then((r) => {
        if (!r.ok) {
          // back where it was, and open again
          toast.error(CONSOLE_COPY.saveFailed(r.error));
          if (bug.status === tab) setSelected(bug.id);
        } else
          toast(BUGS_COPY.marked(status), {
            description: bugView(bug, clock).excerpt,
            action: { label: CONSOLE_COPY.undo, onClick: () => void updateBug({ ...bug, status }, { status: bug.status }) },
          });
      });
    },
    [tab, ids, split, setSelected, clock],
  );
  const setNote = useCallback((bug: AdminBug, note: string) => {
    void updateBug(bug, { note }).then((r) => {
      if (!r.ok) toast.error(CONSOLE_COPY.saveFailed(r.error));
      else toast(CONSOLE_COPY.saved);
    });
  }, []);
  // A reply to a new report moves it to Seen (the server does): follow it there, still open.
  const reply = useCallback(
    async (bug: AdminBug, body: string): Promise<ActionResult> => {
      const r = await replyToBug(bug, body);
      if (!r.ok) return r;
      if (bug.status === "new" && tab === "new") showInTab("seen", bug.id);
      toast(BUGS_COPY.replySent, r.email ? { description: BUGS_COPY.replyEmail(r.email) } : undefined);
      return { ok: true };
    },
    [tab, showInTab],
  );

  // j / k move, s / f / w set the open report's status (not while typing, nor with a dialog open)
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.metaKey || e.ctrlKey || e.altKey || e.defaultPrevented) return;
      if (isTyping(e.target) || document.querySelector('[role="dialog"]')) return;
      const action = bugKeyAction(e.key);
      if (!action || !bugs) return;
      e.preventDefault();
      if (action.kind === "move") {
        const next = moveSelection(ids, shownId, action.by);
        setSelected(next);
        if (next) document.getElementById(`bug-row-${next}`)?.scrollIntoView({ block: "nearest" });
        return;
      }
      const bug = bugs.find((b) => b.id === shownId);
      if (bug && bug.status !== action.status) setStatus(bug, action.status);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [bugs, ids, shownId, setSelected, setStatus]);

  return (
    <AdminFrame notFound={notFound} access={access} resource={res} page="bugs" documentTitle={CONSOLE_COPY.documentTitle(BUGS_COPY.title)}>
      <BugsContent
        bugs={bugs}
        clock={clock}
        tab={tab}
        onTab={setTab}
        selectedId={shownId}
        onSelect={setSelected}
        onStatus={setStatus}
        onNote={setNote}
        onReply={reply}
        loading={res.loading}
        error={res.error}
        updated={updated}
        onRefresh={res.refresh}
        layout={split ? "split" : "stack"}
      />
    </AdminFrame>
  );
}
