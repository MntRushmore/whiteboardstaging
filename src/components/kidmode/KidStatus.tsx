"use client";

import Link from "next/link";
import { KeyRound, LoaderCircle, RotateCcw } from "lucide-react";
import { useValue, type Editor } from "tldraw";
import { openInkDialog } from "@/lib/billing/inkDialog";
import { clearLiveError, liveStore, retryLiveError } from "@/lib/live/liveStore";
import { pillError } from "@/components/live/errorView";
import { errorCardAnchor } from "@/components/live/hintPlacement";
import { useLiveErrorClock } from "@/components/live/LiveStatusPill";
import { KID_STATUS_COPY, kidStatusView, type KidStatusAction } from "./kidStatusView";

/**
 * The simple board's status, in the bar beside Help me (`kidStatusView` says what): "Thinking…"
 * while a Help me is worked out, and after a failure one calm line and one big button — never the
 * grown-up pill's red words, small Retry and Dismiss, or its "…" (Board options stay inside More,
 * where the grown-up pill keeps running). Nothing at all the rest of the time. Loaded lazily with
 * the kid dock (`preloadKidDock`), so it is in place before the first thing goes wrong.
 */
export default function KidStatus({ editor, liveRunning }: { editor: Editor; liveRunning: boolean }) {
  const solving = useValue(liveStore.solving) > 0;
  // an error the card beside its line shows is not repeated here (as in the grown-up pill)
  const onCard = useValue(
    "kid status: error on card",
    () => {
      editor.getCamera();
      return errorCardAnchor(editor, liveStore.lastError.get(), liveStore.lines.get()) !== null;
    },
    [editor],
  );
  const error = pillError(useValue(liveStore.lastError), onCard);
  const canRetry = useValue(liveStore.retryHandler) !== null;
  const now = useLiveErrorClock(error);
  const view = liveRunning ? kidStatusView({ error, now, solving, canRetry }) : null;
  if (!view) return null;

  if (view.kind === "thinking") {
    return (
      <div role="status" data-kid-status="thinking" className="flex h-12 items-center gap-2.5 rounded-full border border-slate-200 bg-white pl-4 pr-5 text-base font-semibold text-slate-700 shadow-sm">
        <LoaderCircle className="size-5 animate-spin text-blue-600 motion-reduce:animate-none" aria-hidden />
        {view.words}
      </div>
    );
  }

  const action = view.action;
  return (
    <div
      role="alert"
      data-kid-status="error"
      data-error-code={error?.code}
      className="flex min-h-14 max-w-full flex-wrap items-center gap-x-3 gap-y-1.5 rounded-[28px] border border-amber-200 bg-amber-50 py-1 pl-5 pr-1 shadow-sm"
    >
      <span className="min-w-0 flex-1 basis-40 py-1 text-base font-semibold leading-snug text-amber-950">{view.words}</span>
      {action && <KidAction kind={action.kind} label={action.label} enabled={action.enabled} />}
    </div>
  );
}

const ACTION =
  "flex h-12 shrink-0 cursor-pointer select-none items-center justify-center gap-2 rounded-full bg-white px-5 text-base font-bold text-slate-800 shadow-sm ring-1 ring-amber-300 transition-colors hover:bg-amber-100/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/60 active:bg-amber-100 disabled:cursor-default disabled:opacity-60 disabled:hover:bg-white motion-reduce:transition-none";

function KidAction({ kind, label, enabled }: { kind: KidStatusAction; label: string; enabled: boolean }) {
  if (kind === "signin") {
    return (
      <Link href="/login" className={ACTION}>
        <KeyRound className="size-5" aria-hidden />
        {label}
      </Link>
    );
  }
  const onClick = kind === "retry" ? retryLiveError : kind === "ink" ? openInkDialog : () => clearLiveError();
  return (
    <button type="button" className={ACTION} disabled={!enabled} onClick={onClick} data-testid="kid-status-action">
      {label.startsWith(KID_STATUS_COPY.tryAgain) && <RotateCcw className="size-5" aria-hidden />}
      {label}
    </button>
  );
}
