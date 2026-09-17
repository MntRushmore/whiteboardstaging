"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { atom, react, useValue, type Editor, type TLShape } from "tldraw";
import { MoreHorizontal } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { isLiveMeta, LIVE_LIMITS, LIVE_TIMING, type LiveStatus } from "@/lib/live/contracts";
import { clearLiveError, liveStore, retryLiveError, type LiveError } from "@/lib/live/liveStore";
import { scheduleLiveWrite } from "@/lib/live/liveWrite";
import { useLiveSettings } from "@/lib/live/liveSettings";
import { ACCOUNT_PATH } from "@/lib/billing/viewModel";
import { LIVE_COPY, pillLabelFor } from "./copy";
import { liveErrorView, secondsLeftFor } from "./errorView";

interface LiveStatusPillProps {
  editor: Editor;
  /** forces the legacy image-overlay generation */
  onDrawHelp: () => void;
  onClearMarks: () => void;
}

/** meta key that remembers a shape's opacity while "Hide AI shapes" is on */
const HIDDEN_OPACITY_KEY = "liveHiddenOpacity";

function liveShapesOnPage(editor: Editor): TLShape[] {
  const out: TLShape[] = [];
  for (const id of editor.getCurrentPageShapeIds()) {
    const shape = editor.getShape(id);
    if (shape && isLiveMeta(shape.meta)) out.push(shape);
  }
  return out;
}

function hideShapes(editor: Editor, shapes: TLShape[]): void {
  const updates = shapes
    .filter((s) => s.opacity > 0)
    .map((s) => ({
      id: s.id,
      type: s.type,
      opacity: 0,
      meta: { ...s.meta, [HIDDEN_OPACITY_KEY]: s.opacity },
    }));
  if (updates.length === 0) return;
  scheduleLiveWrite(editor, () => editor.updateShapes(updates));
}

function showShapes(editor: Editor, shapes: TLShape[]): void {
  // only shapes we hid ourselves (remembered opacity) or that are fully transparent
  const targets = shapes.filter((s) => HIDDEN_OPACITY_KEY in s.meta || s.opacity === 0);
  if (targets.length === 0) return;
  // editor.updateShapes shallow-merges `meta`, so a dropped key would survive; rewrite the
  // record through store.update to actually remove the remembered opacity.
  scheduleLiveWrite(editor, () => {
    for (const s of targets) {
      editor.store.update(s.id, (rec) => {
        const { [HIDDEN_OPACITY_KEY]: remembered, ...rest } = rec.meta as Record<string, unknown>;
        const opacity =
          typeof remembered === "number" && remembered > 0 ? remembered : rec.opacity > 0 ? rec.opacity : 1;
        return { ...rec, opacity, meta: rest as TLShape["meta"] };
      });
    }
  });
}

/**
 * Status label that lingers for LIVE_TIMING.pillFadeMs after the store goes idle so the
 * fade-out has something to fade. Lives in a tldraw atom (external store) so no state is
 * set synchronously inside an effect.
 */
function useLingeringStatus(): LiveStatus {
  const [shown] = useState(() => atom<LiveStatus>("live.pillShown", liveStore.status.get()));
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    const stop = react("live.pillLinger", () => {
      const status = liveStore.status.get();
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
      if (status !== "idle") {
        shown.set(status);
        return;
      }
      timer = setTimeout(() => shown.set("idle"), LIVE_TIMING.pillFadeMs);
    });
    return () => {
      stop();
      if (timer) clearTimeout(timer);
    };
  }, [shown]);
  return useValue(shown);
}

/**
 * Wall clock for the rate-limit countdown: ticks once a second only while a rate_limited
 * error still has seconds left, otherwise stays put (no re-render churn). Atom-based like
 * the linger above.
 */
export function useLiveErrorClock(error: LiveError | null): number {
  const [now] = useState(() => atom("live.errorNow", Date.now()));
  const current = useValue(now);
  const ticking = error?.code === "rate_limited" && secondsLeftFor(error, current) > 0;
  const errorId = error?.id;
  useEffect(() => {
    now.set(Date.now());
    if (!ticking) return;
    const timer = setInterval(() => now.set(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [now, ticking, errorId]);
  return current;
}

const ERROR_BUTTON = "rounded-full px-2 py-0.5 text-[11px] font-medium";

/** The pill's error face: message + the one way out (Retry / Sign in) + Dismiss. */
function LiveErrorFace({ error, now, canRetry }: { error: LiveError; now: number; canRetry: boolean }) {
  const view = liveErrorView(error, now);
  return (
    <>
      <span className="live-pill__label max-w-[260px] truncate text-red-700" title={view.title}>
        {view.title}
      </span>
      {view.primary === "retry" && canRetry && (
        <button
          type="button"
          className={`${ERROR_BUTTON} ml-1 bg-red-50 text-red-700 hover:bg-red-100 disabled:cursor-default disabled:opacity-50 disabled:hover:bg-red-50`}
          onClick={retryLiveError}
          disabled={!view.retryEnabled}
          aria-disabled={!view.retryEnabled}
          data-testid="live-error-retry"
        >
          {LIVE_COPY.errors.retry}
          {view.secondsLeft ? ` (${view.secondsLeft})` : ""}
        </button>
      )}
      {view.primary === "signin" && (
        <Link href="/login" className={`${ERROR_BUTTON} ml-1 bg-red-50 text-red-700 hover:bg-red-100`} data-testid="live-error-signin">
          {LIVE_COPY.errors.signIn}
        </Link>
      )}
      {view.primary === "account" && (
        <Link href={ACCOUNT_PATH} className={`${ERROR_BUTTON} ml-1 bg-red-50 text-red-700 hover:bg-red-100`} data-testid="live-error-account">
          {LIVE_COPY.errors.viewPlan}
        </Link>
      )}
      <button
        type="button"
        className={`${ERROR_BUTTON} text-gray-500 hover:bg-gray-100 hover:text-gray-800`}
        onClick={clearLiveError}
        data-testid="live-error-dismiss"
      >
        {LIVE_COPY.errors.dismiss}
      </button>
    </>
  );
}

export function LiveStatusPill({ editor, onDrawHelp, onClearMarks }: LiveStatusPillProps) {
  const status = useValue(liveStore.status);
  const recognizer = useValue(liveStore.recognizer);
  const shapeCount = useValue(liveStore.liveShapeCount);
  const offlineQueued = useValue(liveStore.offlineQueued);
  const solving = useValue(liveStore.solving);
  const lastError = useValue(liveStore.lastError);
  const canRetry = useValue(liveStore.retryHandler) !== null;
  const now = useLiveErrorClock(lastError);
  const shown = useLingeringStatus();
  const { settings, update } = useLiveSettings();
  const hidden = settings.hideAiShapes;

  // Apply "Hide AI shapes": flip opacity of every isLiveMeta shape, and keep newly created
  // live shapes hidden while the toggle stays on.
  useEffect(() => {
    if (!hidden) {
      showShapes(editor, liveShapesOnPage(editor));
      return;
    }
    hideShapes(editor, liveShapesOnPage(editor));
    const dispose = editor.store.listen(
      (entry) => {
        const fresh: TLShape[] = [];
        for (const rec of Object.values(entry.changes.added)) {
          if (rec.typeName === "shape" && isLiveMeta(rec.meta) && rec.opacity > 0) fresh.push(rec);
        }
        for (const [, to] of Object.values(entry.changes.updated)) {
          if (
            to.typeName === "shape" &&
            isLiveMeta(to.meta) &&
            to.opacity > 0 &&
            !(HIDDEN_OPACITY_KEY in to.meta)
          ) {
            fresh.push(to);
          }
        }
        if (fresh.length > 0) hideShapes(editor, fresh);
      },
      { source: "all", scope: "document" },
    );
    return dispose;
  }, [editor, hidden]);

  const active = status !== "idle";
  const fading = !active && shown !== "idle";
  const label = pillLabelFor(active ? status : shown, recognizer, offlineQueued, solving > 0);
  const atCap = shapeCount >= LIVE_LIMITS.maxLiveShapesPerBoard;
  // An error outranks every other state and stays until retried, superseded or dismissed.
  const showingError = lastError !== null;

  return (
    <div
      className={`live-pill flex items-center gap-1.5 rounded-full border bg-white pl-2.5 pr-1 py-1 text-xs font-medium text-gray-700 shadow-sm ${
        showingError ? "border-red-200" : ""
      }`}
      data-status={showingError ? "error" : active ? status : "idle"}
      data-error-code={lastError?.code}
      role={showingError ? "alert" : "status"}
      aria-live={showingError ? "assertive" : "polite"}
      aria-label={showingError ? LIVE_COPY.errors.region : undefined}
      title={showingError ? undefined : atCap ? LIVE_COPY.pill.shapeCap : LIVE_COPY.toggleHint}
    >
      <span className="live-pill__dot" aria-hidden />
      {showingError ? (
        <LiveErrorFace error={lastError} now={now} canRetry={canRetry} />
      ) : (
        <span className={`live-pill__label ${fading ? "live-pill__label--fading" : ""}`}>{label}</span>
      )}
      {atCap && !active && !showingError && (
        <button
          type="button"
          className="ml-1 rounded-full bg-amber-50 px-2 py-0.5 text-[11px] font-medium text-amber-700 hover:bg-amber-100"
          onClick={onClearMarks}
        >
          {LIVE_COPY.pill.clearMarks}
        </button>
      )}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            className="ml-0.5 flex h-6 w-6 items-center justify-center rounded-full text-gray-500 hover:bg-gray-100 hover:text-gray-800"
            aria-label={LIVE_COPY.pill.menuLabel}
          >
            <MoreHorizontal size={14} strokeWidth={2} />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" side="bottom" className="w-56">
          <DropdownMenuLabel className="text-xs text-gray-500">{LIVE_COPY.pill.menuLabel}</DropdownMenuLabel>
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={onDrawHelp} title={LIVE_COPY.pill.drawHelpHint}>
            {LIVE_COPY.pill.drawHelp}
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={onClearMarks}>{LIVE_COPY.pill.clearMarks}</DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuCheckboxItem
            checked={hidden}
            onCheckedChange={(v) => update({ hideAiShapes: v === true })}
          >
            {LIVE_COPY.pill.hideAiShapes}
          </DropdownMenuCheckboxItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}

