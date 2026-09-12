"use client";

import { useEffect, useState } from "react";
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
import { liveStore } from "@/lib/live/liveStore";
import { scheduleLiveWrite } from "@/lib/live/liveWrite";
import { useLiveSettings } from "@/lib/live/liveSettings";
import { LIVE_COPY, pillLabelFor } from "./copy";

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
  const updates = shapes.filter((s) => HIDDEN_OPACITY_KEY in s.meta || s.opacity === 0).map((s) => {
    const { [HIDDEN_OPACITY_KEY]: remembered, ...rest } = s.meta as Record<string, unknown>;
    const opacity = typeof remembered === "number" && remembered > 0 ? remembered : s.opacity > 0 ? s.opacity : 1;
    return { id: s.id, type: s.type, opacity, meta: rest as TLShape["meta"] };
  });
  if (updates.length === 0) return;
  scheduleLiveWrite(editor, () => editor.updateShapes(updates));
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

export function LiveStatusPill({ editor, onDrawHelp, onClearMarks }: LiveStatusPillProps) {
  const status = useValue(liveStore.status);
  const recognizer = useValue(liveStore.recognizer);
  const shapeCount = useValue(liveStore.liveShapeCount);
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
  const label = pillLabelFor(active ? status : shown, recognizer);
  const atCap = shapeCount >= LIVE_LIMITS.maxLiveShapesPerBoard;

  return (
    <div
      className="live-pill flex items-center gap-1.5 rounded-full border bg-white pl-2.5 pr-1 py-1 text-xs font-medium text-gray-700 shadow-sm"
      data-status={active ? status : "idle"}
      role="status"
      aria-live="polite"
      title={atCap ? LIVE_COPY.pill.shapeCap : LIVE_COPY.toggleHint}
    >
      <span className="live-pill__dot" aria-hidden />
      <span className={`live-pill__label ${fading ? "live-pill__label--fading" : ""}`}>{label}</span>
      {atCap && !active && (
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
        <DropdownMenuContent align="start" side="top" className="w-56">
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

