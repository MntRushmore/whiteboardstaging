"use client";

import { lazy, Suspense } from "react";
import {
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import { KID_COPY } from "@/components/kidmode/copy";
import { SPEECH_COPY } from "@/components/speech/copy";
import { useLiveSettings } from "@/lib/live/liveSettings";
import { LIVE_COPY } from "./copy";
import { LiveErrorBoundary } from "./LiveErrorBoundary";
import { boardMenuView } from "./toolbar";

// "Read hints aloud": the setting and the speaker load the first time the menu opens (docs/BUNDLE.md)
const ReadAloudMenuItem = lazy(() => import("@/components/speech/ReadAloudMenuItem"));

export interface BoardMenuProps {
  /** Live is switched on AND allowed by the build (kill switch off) */
  liveRunning: boolean;
  /** false when the deploy-time kill switch has taken Live away entirely */
  liveAvailable: boolean;
  onLiveEnabledChange: (enabled: boolean) => void;
  onHelp: () => void;
  canHelp: boolean;
  onClearMarks: () => void;
  onShowModeInfo: () => void;
  onReportProblem: () => void;
  onReplay?: () => void;
  simpleBoard?: { on: boolean; onChange: (on: boolean) => void };
}

/**
 * Board options, the status pill's "…" menu (`LiveStatusPill` has what each prop is): its items, as
 * the menu's content. A chunk of its own, fetched as the pill mounts, just after the board: there is
 * nothing to show before the first tap on "…" (docs/BUNDLE.md).
 */
export default function BoardMenu({
  liveRunning,
  liveAvailable,
  onLiveEnabledChange,
  onHelp,
  canHelp,
  onClearMarks,
  onShowModeInfo,
  onReportProblem,
  onReplay,
  simpleBoard,
}: BoardMenuProps) {
  const { settings, update } = useLiveSettings();
  const menu = boardMenuView({ liveEnabled: liveRunning, liveAvailable });
  return (
    <DropdownMenuContent align="start" side="bottom" className="w-60" data-testid="board-menu">
      <DropdownMenuLabel className="text-xs text-gray-500">{LIVE_COPY.pill.groupCanvas}</DropdownMenuLabel>
      <DropdownMenuItem
        className="pl-8"
        onSelect={onHelp}
        disabled={!canHelp}
        title={canHelp ? LIVE_COPY.pill.helpHint : LIVE_COPY.pill.helpOffHint}
        data-testid="board-help-item"
      >
        {LIVE_COPY.pill.help}
      </DropdownMenuItem>
      <DropdownMenuItem className="pl-8" onSelect={onClearMarks}>
        {LIVE_COPY.pill.clearMarks}
      </DropdownMenuItem>
      {onReplay && (
        <DropdownMenuItem className="pl-8" onSelect={onReplay} title={LIVE_COPY.pill.replayHint} data-testid="board-replay-item">
          {LIVE_COPY.pill.replay}
        </DropdownMenuItem>
      )}
      <DropdownMenuCheckboxItem
        checked={settings.hideAiShapes}
        onCheckedChange={(v) => update({ hideAiShapes: v === true })}
      >
        {LIVE_COPY.pill.hideAiShapes}
      </DropdownMenuCheckboxItem>
      <DropdownMenuCheckboxItem
        checked={settings.celebrations}
        onCheckedChange={(v) => update({ celebrations: v === true })}
        title={LIVE_COPY.pill.celebrationsHint}
      >
        {LIVE_COPY.pill.celebrations}
      </DropdownMenuCheckboxItem>
      {simpleBoard && (
        <DropdownMenuCheckboxItem
          checked={simpleBoard.on}
          onCheckedChange={(v) => simpleBoard.onChange(v === true)}
          title={KID_COPY.simpleBoardHint}
          data-testid="simple-board-item"
        >
          {KID_COPY.simpleBoard}
        </DropdownMenuCheckboxItem>
      )}
      {/* a chunk that fails to load hides this one item, not the menu */}
      <LiveErrorBoundary>
        <Suspense
          fallback={
            <DropdownMenuCheckboxItem checked={false} disabled>
              {SPEECH_COPY.toggle}
            </DropdownMenuCheckboxItem>
          }
        >
          <ReadAloudMenuItem />
        </Suspense>
      </LiveErrorBoundary>

      <DropdownMenuSeparator />
      <DropdownMenuLabel className="text-xs text-gray-500">{LIVE_COPY.pill.groupLive}</DropdownMenuLabel>
      <DropdownMenuCheckboxItem
        checked={menu.liveChecked}
        disabled={menu.liveDisabled}
        onCheckedChange={(v) => onLiveEnabledChange(v === true)}
        title={menu.liveHint}
        data-testid="live-enabled-item"
      >
        {LIVE_COPY.pill.liveOn}
      </DropdownMenuCheckboxItem>
      {menu.showHandwriting && (
        <DropdownMenuCheckboxItem
          checked={settings.handwriting}
          onCheckedChange={(v) => update({ handwriting: v === true })}
          title={LIVE_COPY.pill.handwritingHint}
        >
          {LIVE_COPY.pill.handwriting}
        </DropdownMenuCheckboxItem>
      )}

      <DropdownMenuSeparator />
      <DropdownMenuLabel className="text-xs text-gray-500">{LIVE_COPY.pill.groupHelp}</DropdownMenuLabel>
      <DropdownMenuItem className="pl-8" onSelect={onShowModeInfo}>
        {LIVE_COPY.pill.modeInfo}
      </DropdownMenuItem>
      <DropdownMenuItem className="pl-8" onSelect={onReportProblem}>
        {LIVE_COPY.pill.report}
      </DropdownMenuItem>
    </DropdownMenuContent>
  );
}
