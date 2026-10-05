"use client";

import {
  Tldraw,
  useBreakpoint,
  useEditor,
  type TLAssetId,
  DefaultColorThemePalette,
  type TLUiOverrides,
  type TLUiIconJsx,
  type TLEditorSnapshot,
  type TLStoreSnapshot,
  loadSnapshot,
  createTLStore,
  defaultShapeUtils,
  defaultBindingUtils,
  type Editor,
} from "tldraw";
import React, { useCallback, useState, useEffect, useMemo } from "react";
import { createPortal } from "react-dom";
import "tldraw/tldraw.css";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Cursor02Icon,
  ThreeFinger05Icon,
  PencilIcon,
  EraserIcon,
  ArrowUpRight01Icon,
  ArrowLeft01Icon,
  TextIcon,
  StickyNote01Icon,
  Image01Icon,
  AddSquareIcon,
} from "hugeicons-react";
import { useAssistanceMode, type AssistanceMode } from "@/hooks/useAssistanceMode";
import { offloadAssetsOnce, useSnapshotSave } from "@/hooks/useSnapshotSave";
import { useBoardAutoTitle } from "@/hooks/useBoardAutoTitle";
import { createBoardAssetStore } from "@/lib/assets/boardAssetStore";
import { BOARD_EMBEDS } from "@/lib/boards/embeds";
import {
  BOARD_LOAD_COPY,
  BoardCrashed,
  BoardLoadError,
  BoardLoading,
  loadStateFor,
  type BoardLoadState,
} from "@/components/BoardLoadError";
import { logger } from "@/lib/logger";
import { reportUserError } from "@/lib/reportAppError";
import { supabase } from "@/lib/supabase";
import { useParams, useRouter } from "next/navigation";
import { Bug, MessageSquare } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/components/AuthProvider";
import { InkMeter } from "@/components/billing/InkMeter";
import { OutOfInkWatcher } from "@/components/billing/OutOfInkWatcher";
import { usePlanGate } from "@/components/billing/usePlanGate";
import { noteInkBalance } from "@/lib/live/liveStore";
import { captureBoardScreenshot } from "@/components/board/boardScreenshot";
import { BETA_COPY } from "@/components/app/BetaBadge";
import { useFeatureLabs } from "@/lib/featureLabs";
import { liveShapeUtils, liveTools, liveUiOverrides, LiveToolbar } from "@/shapes";
import { LIVE_KILL_SWITCH } from "@/lib/live/contracts";
import { useLiveMath } from "@/lib/live/useLiveMath";
import { autoActs, useLiveSettings } from "@/lib/live/liveSettings";
import { ScreenStrip, ScreenStripCorner, screenStripSlot } from "@/components/screens/ScreenStrip";
import { PenStyleButton } from "@/components/board/PenStyleButton";
import { liveDebugEnabled } from "@/lib/live/liveDebug";
import { ScreenBackground, ScreenFrame } from "@/components/screens/ScreenFrame";
import { applyScreenCamera } from "@/lib/screens/screens";
import { useScreenCamera } from "@/lib/screens/useScreenCamera";
import { LiveStatusPill } from "@/components/live/LiveStatusPill";
import { SaveStatus } from "@/components/live/SaveStatus";
import { LiveHintLayer } from "@/components/live/LiveHintLayer";
import { BOARD_BAR_ATTR } from "@/components/live/hintPlacement";
import { LiveErrorBoundary } from "@/components/live/LiveErrorBoundary";
import { ASSET_COPY, LIVE_COPY } from "@/components/live/copy";
import { boardToolbarView } from "@/components/live/toolbar";
import { AskButton } from "@/components/live/AskButton";
import { BoardChatPanel, CHAT_TOGGLE_ATTR } from "@/components/chat/BoardChatPanel";
import { CHAT_COPY } from "@/components/chat/chatView";
import { useChatOpen } from "@/components/chat/useBoardChat";
import { useLecture } from "@/components/lecture/useLecture";
import { LectureBar } from "@/components/lecture/LectureBar";
import { browserStorage as onboardingStorage, isGuidedBoard } from "@/lib/onboarding/marker";
import { hasPracticeMarker } from "@/lib/learning/practiceMarker";
import { attachKeyboardFit, browserKeyboardFitEnv } from "@/components/board/keyboardFit";
import { useBoardLearning } from "@/components/learning/useBoardLearning";

// The guided first board's tour (the welcome's Start): loaded on that board only, after the board.
const BoardTour = React.lazy(() => import("@/components/onboarding/BoardTour"));
// The cheers on a tick (words and confetti): nothing to show until the tutor marks a line, so they
// load just after the board rather than with it (docs/BUNDLE.md).
const Celebrations = React.lazy(() => import("@/components/live/Celebrations").then((m) => ({ default: m.Celebrations })));
// Feature Labs extras (off by default) and the Mathpix debug panel (development, or opted in on the
// device): fetched only when shown, not with every board (docs/BUNDLE.md).
const StickerLibrary = React.lazy(() => import("@/components/StickerLibrary").then((m) => ({ default: m.StickerLibrary })));
const PdfUpload = React.lazy(() => import("@/components/PdfUpload").then((m) => ({ default: m.PdfUpload })));
// The bug report's dialog: opened rarely, so it loads the first time it is (the board's first load is at its budget).
const BugReportButton = React.lazy(() => import("@/components/BugReportButton").then((m) => ({ default: m.BugReportButton })));
// The help-modes explainer (Board options): loads the first time it is opened, like the report.
const ModeInfoDialog = React.lazy(() => import("@/components/board/ModeInfoDialog").then((m) => ({ default: m.ModeInfoDialog })));
const LiveDebugPanel = React.lazy(() => import("@/components/live/LiveDebugPanel").then((m) => ({ default: m.LiveDebugPanel })));
// The outline around the problem Help me acts on: shown only around an ask, so it loads after the board.
const ProblemHighlight = React.lazy(() => import("@/components/live/ProblemHighlight").then((m) => ({ default: m.ProblemHighlight })));
// Learning: "Now you try one!" after the tutor solves or helps, and a practice board's problems
// (the Progress page's marker): both load after the board, the second only on a practice board.
const NowYouTry = React.lazy(() => import("@/components/learning/NowYouTry"));
const PracticeBoard = React.lazy(() => import("@/components/learning/PracticeBoard"));

/** The help tabs: 6 px of padding on a board under 768 px (a 10.2" iPad sideways with Ask docked), 8 px from there. */
const HELP_TAB_CLASS = "px-1.5 @3xl/bar:px-2";

// Ensure the tldraw canvas background is pure white in both light and dark modes
DefaultColorThemePalette.lightMode.background = "#FFFFFF";
DefaultColorThemePalette.darkMode.background = "#FFFFFF";

const hugeIconsOverrides: TLUiOverrides = {
  tools(_editor, tools) {
    const toolIconMap: Record<string, TLUiIconJsx> = {
      select: (
        <div>
          <Cursor02Icon size={22} strokeWidth={1.5} />
        </div>
      ),
      hand: (
        <div>
          <ThreeFinger05Icon size={22} strokeWidth={1.5} />
        </div>
      ),
      draw: (
        <div>
          <PencilIcon size={22} strokeWidth={1.5} />
        </div>
      ),
      eraser: (
        <div>
          <EraserIcon size={22} strokeWidth={1.5} />
        </div>
      ),
      arrow: (
        <div>
          <ArrowUpRight01Icon size={22} strokeWidth={1.5} />
        </div>
      ),
      text: (
        <div>
          <TextIcon size={22} strokeWidth={1.5} />
        </div>
      ),
      note: (
        <div>
          <StickyNote01Icon size={22} strokeWidth={1.5} />
        </div>
      ),
      asset: (
        <div>
          <Image01Icon size={22} strokeWidth={1.5} />
        </div>
      ),
      rectangle: (
        <div>
          <AddSquareIcon size={22} strokeWidth={1.5} />
        </div>
      ),
    };

    Object.keys(toolIconMap).forEach((id) => {
      const icon = toolIconMap[id];
      if (!tools[id] || !icon) return;
      tools[id].icon = icon;
    });

    return tools;
  },
};

// Live's tool overrides (Math tool, kbd "m") layered on top of the icon overrides above.
const boardOverrides: TLUiOverrides = {
  ...hugeIconsOverrides,
  tools(editor, tools, helpers) {
    const withIcons = hugeIconsOverrides.tools ? hugeIconsOverrides.tools(editor, tools, helpers) : tools;
    return liveUiOverrides.tools ? liveUiOverrides.tools(editor, withIcons, helpers) : withIcons;
  },
};

interface BoardChatSlot {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** where the page lays the panel out: beside the board on a desktop, under it on a phone */
  host: HTMLElement | null;
}

function BoardContent({ id, initialVersion, chat }: { id: string; initialVersion: number | null; chat: BoardChatSlot }) {
  const editor = useEditor();
  useScreenCamera(editor);
  const router = useRouter();
  const { features } = useFeatureLabs();
  // Help mode is remembered per board on this device (default Feedback).
  const [assistanceMode, setAssistanceMode] = useAssistanceMode(id);
  // Bumped each time the student moves the dial: the ask button glows (AskButton).
  const [askGlow, setAskGlow] = useState(0);
  // The (i) explainer and the bug report both used to be buttons in the bar; they open from
  // Board options now, so the page owns their open state.
  // null until first opened: the explainer is mounted from then on, so it can animate closed
  const [modeInfoOpen, setModeInfoOpen] = useState<boolean | null>(null);
  const [reportOpen, setReportOpen] = useState(false);
  // mounted from the first open on, so its dialog can animate closed and keeps the student's words
  const [reportMounted, setReportMounted] = useState(false);
  const openReport = useCallback(() => {
    setReportMounted(true);
    setReportOpen(true);
  }, []);
  const { user } = useAuth();
  const [guided, setGuided] = useState(() => isGuidedBoard(onboardingStorage(), user?.id, id));
  const endTour = useCallback(() => setGuided(false), []);
  // Each tap on Help me / Solve it, for the guided board's second coach mark (it waits for what the
  // tutor writes, and says so when there was nothing to help with). Only counted on that board.
  const [tourHelpAsk, setTourHelpAsk] = useState<{ n: number; ok: boolean } | null>(null);
  // a practice board opened from the Progress page: its problems are written once (PracticeBoard)
  const [practiceBoard] = useState(() => hasPracticeMarker(id));

  // Live Math layer: per-device switch (localStorage) gated by the deploy-time kill switch.
  const { settings: live, update: updateLive } = useLiveSettings();
  const liveEnabled = live.enabled && !LIVE_KILL_SWITCH;
  const controller = useLiveMath(editor, {
    boardId: id,
    mode: assistanceMode,
    enabled: liveEnabled,
    // paused while AI shapes are hidden: no ink spent on marks and steps the student cannot see
    auto: autoActs(live),
  });
  // The learning record (src/lib/learning): the problems the student works here, loaded in idle time.
  useBoardLearning(id, user?.id);
  // Lecture mode: the mic and the tutor sketching what is said. Not gated on Live or the help
  // mode: the controller's lecture methods work whatever they say.
  const lecture = useLecture(id, controller);
  useEffect(() => {
    if (process.env.NODE_ENV === "production") return;
    // Dev-only handles for QA: `__agathonLecture.startScripted(...)` plays a lecture without a mic;
    // `__agathonLectureDemo(speed?)` plays the two-minute demo lecture (src/lib/live/lecture/demo.ts).
    const w = window as unknown as { __agathonLecture?: typeof lecture; __agathonLectureDemo?: (speed?: number) => void };
    w.__agathonLecture = lecture;
    const demo = (speed?: number) => void import("@/lib/live/lecture/demo").then(({ DEMO_LECTURE }) => lecture.startScripted([...DEMO_LECTURE], { speed }));
    w.__agathonLectureDemo = demo;
    return () => {
      if (w.__agathonLecture === lecture) delete w.__agathonLecture;
      if (w.__agathonLectureDemo === demo) delete w.__agathonLectureDemo;
    };
  }, [lecture]);

  // Auto-save through the SaveQueue (2 s debounce, offline backup + replay, optimistic
  // concurrency on `version`, size guard + Storage offload): src/hooks/useSnapshotSave.ts
  const { sync, retry: retrySave } = useSnapshotSave(editor, id, initialVersion);
  // An "Untitled Whiteboard" is named after its first line of maths once it saves.
  useBoardAutoTitle(editor, id, sync);

  const narrowBoard = screenStripSlot(useBreakpoint()) === "corner";

  // One place decides what the bar shows (see src/components/live/toolbar.ts).
  const toolbar = boardToolbarView({
    mode: assistanceMode,
    liveEnabled: live.enabled,
    liveAvailable: !LIVE_KILL_SWITCH,
    auto: live.auto,
    hideAiShapes: live.hideAiShapes,
  });

  return (
    <>
      {/*
        The board's one primary row: go back, choose how much help, ask for it (Help me / Solve it),
        and see what the tutor is doing. Everything rare — the Live
        preference, the help-mode explainer — hangs off the status pill's "…" menu rather
        than competing with them. Report a bug has a button of its own while we are in beta.
      */}
      {/*
        The bar's width class is the board's width, not the window's (a container, `bar`): with
        Ask docked beside the board, an iPad held sideways has an upright iPad's board.
      */}
      <div className="@container/bar absolute inset-x-0 top-0 z-1000 h-0">
      {/* measured by the Live hint layer, whose cards stay below the bar's last row (hintPlacement.ts) */}
      <div
        {...{ [BOARD_BAR_ATTR]: "" }}
        style={{
          position: 'absolute',
          top: '16px',
          left: '16px',
          display: 'flex',
          alignItems: 'flex-start',
          gap: '12px',
          // The controls wrap beside the back button (an upright iPad keeps one row) and leave
          // room for the pen's swatch at the top-right. On a phone-narrow board they drop under
          // the back button instead: the screen strip takes that corner (screenStripSlot).
          flexWrap: narrowBoard ? 'wrap' : 'nowrap',
          maxWidth: 'calc(100% - 72px)',
        }}
      >
        <Button
          variant="ghost"
          size="icon"
          className="shrink-0"
          aria-label="Back to my whiteboards"
          onClick={() => router.push("/")}
        >
          <ArrowLeft01Icon size={20} strokeWidth={2} />
        </Button>
        {/*
          A board 768–1023 px wide (an upright iPad, or one sideways with Ask docked) fits this
          row only just: below @5xl the gaps are 6 px, the ink meter is the bottle and the number,
          Report a bug, a routine save and an open Ask are icons; below @3xl (a 10.2" iPad
          sideways with Ask) the help tabs are tighter. The save pill comes last, so neither it
          nor a long status ever pushes the other controls onto a second row (Solve's steps
          button still wraps the status end there).
        */}
        <div className="flex min-w-0 flex-wrap items-center gap-1.5 @5xl/bar:gap-2">
          <Tabs
            value={assistanceMode}
            onValueChange={(value) => {
              setAssistanceMode(value as AssistanceMode);
              setAskGlow((n) => n + 1);
            }}
            className="w-auto shadow-sm rounded-lg"
          >
            <TabsList aria-label="How much help">
              <TabsTrigger value="off" className={HELP_TAB_CLASS}>Off</TabsTrigger>
              <TabsTrigger value="feedback" className={HELP_TAB_CLASS}>Feedback</TabsTrigger>
              <TabsTrigger value="suggest" className={HELP_TAB_CLASS}>Suggest</TabsTrigger>
              <TabsTrigger value="answer" className={HELP_TAB_CLASS}>Solve</TabsTrigger>
            </TabsList>
          </Tabs>
          {/*
            Auto: the tabs say how much help, this says when — by itself once the student pauses
            (on), or only on the ask button (off). The whole pill is the touch target (32 px tall).
            A plain button with role="switch" rather than the Radix switch: the board's first load is
            at its budget, and this needs nothing a button does not already do.
          */}
          {toolbar.autoSwitch && (
            <button
              type="button"
              role="switch"
              aria-checked={toolbar.autoSwitch.on}
              title={toolbar.autoSwitch.hint}
              onClick={() => updateLive({ auto: !toolbar.autoSwitch?.on })}
              className="group flex h-8 shrink-0 cursor-pointer select-none items-center gap-1.5 rounded-full border bg-white pl-2.5 pr-1.5 text-xs font-medium shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              {LIVE_COPY.auto.label}
              <span aria-hidden className="inline-flex h-5 w-9 items-center rounded-full bg-input p-0.5 transition-colors group-aria-checked:bg-primary">
                <span className="block size-4 rounded-full bg-background shadow transition-transform group-aria-checked:translate-x-4" />
              </span>
            </button>
          )}
          {/* stuck? the one thing to tap: the next step, or in Solve the rest of them */}
          {toolbar.askButton && (
            <AskButton
              kind={toolbar.askButton}
              glow={askGlow}
              onAsk={() => {
                const ok = controller.requestHelp();
                if (guided) setTourHelpAsk((a) => ({ n: (a?.n ?? 0) + 1, ok }));
                return ok;
              }}
            />
          )}
          <Button
            variant={chat.open ? "secondary" : "outline"}
            size="sm"
            className={chat.open ? "shadow-sm" : "bg-white shadow-sm"}
            title={CHAT_COPY.buttonHint}
            aria-label={CHAT_COPY.button}
            aria-expanded={chat.open}
            {...{ [CHAT_TOGGLE_ATTR]: "" }}
            onClick={() => chat.onOpenChange(!chat.open)}
          >
            <MessageSquare className="h-4 w-4" />
            {/* open, the panel names itself: the button is its icon unless the board is wide */}
            <span className={chat.open ? "ml-1.5 hidden @5xl/bar:inline" : "ml-1.5"}>{CHAT_COPY.button}</span>
          </Button>
          {/* Lecture mode is hidden for now (owner, 2026-10-03): its button is out of the bar; the
              code, LectureBar and the dev handles stay, so it comes back with this one line. */}
          <LiveErrorBoundary>
            <LiveStatusPill
              editor={editor}
              liveRunning={toolbar.liveRunning}
              liveAvailable={!LIVE_KILL_SWITCH}
              onLiveEnabledChange={(enabled) => updateLive({ enabled })}
              onHelp={() => controller.requestHelp()}
              canHelp={toolbar.canHelp}
              onClearMarks={() => controller.clearMarks()}
              onShowModeInfo={() => setModeInfoOpen(true)}
              onReportProblem={openReport}
            />
          </LiveErrorBoundary>
          {/* the plan (∞), or the ink a plan spends right now; none on the guided board. Tapping a count opens the ink dialog */}
          {/* once the balance covers the refused call again (a pack landed), its "out of ink" pill goes;
              with none left, Auto spends nothing */}
          <InkMeter onBalance={noteInkBalance} />
          <Button
            variant="outline"
            size="sm"
            className="h-8 gap-1.5 rounded-full bg-white px-3 shadow-sm"
            title={BETA_COPY.hint}
            aria-label="Report a bug"
            onClick={openReport}
          >
            <Bug className="size-3.5" aria-hidden />
            <span className="hidden text-xs font-medium @5xl/bar:inline">Report a bug</span>
          </Button>
          {/* a chunk that fails to load (an offline tab, a stale deploy) hides the button, not the board */}
          {(features.stickers || features.pdfUpload) && (
            <LiveErrorBoundary>
              <React.Suspense fallback={null}>
                {features.stickers && <StickerLibrary />}
                {features.pdfUpload && <PdfUpload />}
              </React.Suspense>
            </LiveErrorBoundary>
          )}
          {/* last: it comes and goes with every save, and must not move the controls before it */}
          <SaveStatus sync={sync} onRetry={() => void retrySave()} />
        </div>
      </div>
      </div>

      {/* The explainer opens from Board options; the report from there or its button in the bar. */}
      {modeInfoOpen !== null && (
        <LiveErrorBoundary>
          <React.Suspense fallback={null}>
            <ModeInfoDialog open={modeInfoOpen} onOpenChange={setModeInfoOpen} />
          </React.Suspense>
        </LiveErrorBoundary>
      )}
      {reportMounted && (
        <LiveErrorBoundary>
          <React.Suspense fallback={null}>
            <BugReportButton boardId={id} open={reportOpen} onOpenChange={setReportOpen} screenshot={() => captureBoardScreenshot(editor)} />
          </React.Suspense>
        </LiveErrorBoundary>
      )}
      {liveEnabled && live.celebrations && (
        <LiveErrorBoundary>
          <React.Suspense fallback={null}>
            <Celebrations editor={editor} />
          </React.Suspense>
        </LiveErrorBoundary>
      )}

      {/* a Live 402 or "Unlock help" opens the ink dialog (lazy: the plan); a 402's never mid-stroke */}
      <OutOfInkWatcher editor={editor} />
      <LiveErrorBoundary>
        <LectureBar lecture={lecture} />
      </LiveErrorBoundary>
      {liveDebugEnabled() && (
        <LiveErrorBoundary>
          <React.Suspense fallback={null}>
            <LiveDebugPanel />
          </React.Suspense>
        </LiveErrorBoundary>
      )}
      {toolbar.askButton && !live.hideAiShapes && (
        <LiveErrorBoundary>
          <React.Suspense fallback={null}>
            <ProblemHighlight editor={editor} />
          </React.Suspense>
        </LiveErrorBoundary>
      )}
      {toolbar.showHintLayer && (
        <LiveErrorBoundary>
          <LiveHintLayer editor={editor} controller={controller} />
        </LiveErrorBoundary>
      )}
      {guided && user && (
        <LiveErrorBoundary>
          <React.Suspense fallback={null}>
            <BoardTour
              boardId={id}
              userId={user.id}
              controller={controller}
              mode={assistanceMode}
              onModeChange={setAssistanceMode}
              chatOpen={chat.open}
              helpAsk={tourHelpAsk}
              onFinished={endTour}
            />
          </React.Suspense>
        </LiveErrorBoundary>
      )}
      {/* the problem it offers is written in the tutor's hand: not while the tutor's writing is hidden */}
      {liveEnabled && !live.hideAiShapes && (
        <LiveErrorBoundary>
          <React.Suspense fallback={null}>
            <NowYouTry controller={controller} tour={guided} />
          </React.Suspense>
        </LiveErrorBoundary>
      )}
      {practiceBoard && (
        <LiveErrorBoundary>
          <React.Suspense fallback={null}>
            <PracticeBoard boardId={id} controller={controller} onModeChange={setAssistanceMode} />
          </React.Suspense>
        </LiveErrorBoundary>
      )}
      {chat.open &&
        chat.host &&
        createPortal(
          <LiveErrorBoundary>
            <BoardChatPanel boardId={id} controller={controller} onClose={() => chat.onOpenChange(false)} />
          </LiveErrorBoundary>,
          chat.host,
        )}
    </>
  );
}

type BoardSnapshot = Partial<TLEditorSnapshot> | TLStoreSnapshot;

/**
 * Restore the snapshot on a throwaway store with the same shape/binding utils as the real
 * editor. Returns the thrown error (never throws) so the page can refuse to mount <Tldraw>
 * instead of leaving an empty editor that the autosave could write back.
 */
function snapshotRestoreError(snapshot: BoardSnapshot): unknown {
  let probe: ReturnType<typeof createTLStore> | null = null;
  try {
    probe = createTLStore({
      shapeUtils: [...defaultShapeUtils, ...liveShapeUtils],
      bindingUtils: defaultBindingUtils,
    });
    loadSnapshot(probe, snapshot);
    return null;
  } catch (e) {
    return e ?? new Error("snapshot restore failed");
  } finally {
    probe?.dispose();
  }
}

type PageLoadState = { kind: "loading" } | BoardLoadState;

export default function BoardPage() {
  const params = useParams();
  const router = useRouter();
  const id = params.id as string;
  const { user, loading: authLoading } = useAuth();
  const [loadState, setLoadState] = useState<PageLoadState>({ kind: "loading" });
  // Bumped by Retry; the load effect depends on it so it re-runs.
  const [loadAttempt, setLoadAttempt] = useState(0);
  const [initialData, setInitialData] = useState<BoardSnapshot | null>(null);
  // `whiteboards.version` at load time: the autosave's optimistic-concurrency baseline.
  const [initialVersion, setInitialVersion] = useState<number | null>(null);
  // tldraw's own paste/drop/upload of images goes to Storage ('<uid>/<boardId>/<assetId>.<ext>')
  // instead of being embedded as a data URL in the snapshot.
  // `getAsset` lets the store derive object paths for assets restored from the snapshot
  // (not uploaded this session) so `editor.deleteAssets` also removes the Storage object.
  const userId = user?.id;
  // The board chat: off by default, remembered per device; the page lays it out beside the board.
  const [chatOpen, setChatOpen] = useChatOpen();
  const [chatHost, setChatHost] = useState<HTMLElement | null>(null);
  // With the on-screen keyboard up for the Ask panel docked beside the board (an iPad held sideways), the root
  // is laid over the part of the screen the keyboard leaves (src/components/board/keyboardFit.ts).
  const [boardRoot, setBoardRoot] = useState<HTMLElement | null>(null);
  useEffect(() => (boardRoot && chatHost ? attachKeyboardFit(boardRoot, browserKeyboardFitEnv(chatHost)) : undefined), [boardRoot, chatHost]);
  // The store is created before the editor exists; `attach` (called from onMount) gives its
  // `getAsset` the mounted editor. A closure variable rather than a ref so nothing reads a
  // ref during render.
  const assetStoreBundle = useMemo(() => {
    if (!userId) return undefined;
    let mounted: Editor | null = null;
    const store = createBoardAssetStore({
      supabase,
      userId,
      boardId: id,
      getAsset: (assetId: TLAssetId) => mounted?.getAsset(assetId),
    });
    return {
      store,
      attach(editor: Editor) {
        mounted = editor;
      },
    };
  }, [userId, id]);

  useEffect(() => {
    if (!authLoading && !user) {
      // Signed out (or the session ended mid-board): come back here after signing in. Unsaved
      // strokes are in the device backup and are restored when the board reopens.
      router.replace(`/login?next=/board/${id}`);
    }
  }, [user, authLoading, router, id]);

  // No free plan: without Agathon Unlimited a board sends the student to the plan screen — except
  // the guided first board, the tour before the plan screen (its marker is read once the user is
  // known, and the tour clears it as it ends: the next board is gated).
  const guidedBoard = useMemo(() => (userId ? isGuidedBoard(onboardingStorage(), userId, id) : false), [userId, id]);
  usePlanGate({ enabled: !guidedBoard, page: "board" });

  const retryLoad = useCallback(() => {
    setInitialData(null);
    setInitialVersion(null);
    setLoadState({ kind: "loading" });
    setLoadAttempt((n) => n + 1);
  }, []);

  // Keyed on the user's id, not the user object: supabase-js hands out a new session object on
  // every auth event (a token refresh, another tab of the app starting), and reloading the row
  // under a mounted editor gave the autosave a newer version than the board on screen.
  useEffect(() => {
    if (!userId) return;
    let cancelled = false;
    async function loadBoard() {
      let result: BoardLoadState;
      let snapshot: BoardSnapshot | null = null;
      let version: number | null = null;
      try {
        // maybeSingle: a missing (or another account's) board is a null row, not a 406 error.
        const { data, error } = await supabase
          .from('whiteboards')
          .select('data, version')
          .eq('id', id)
          .maybeSingle();

        result = loadStateFor({ error, row: data });
        if (result.kind === "ready" && data) {
          if (data.data && Object.keys(data.data).length > 0) {
            // `data` is a jsonb column holding a tldraw snapshot. Prove it restores before
            // the editor exists: a snapshot that throws must never leave an empty canvas.
            snapshot = data.data as BoardSnapshot;
            const restoreError = snapshotRestoreError(snapshot);
            if (restoreError) result = loadStateFor({ row: data, restoreError });
          }
          // bigint arrives as a JSON number (PostgREST); tolerate a string just in case.
          const v = typeof data.version === "string" ? Number(data.version) : data.version;
          version = typeof v === "number" && Number.isFinite(v) ? v : null;
        }
      } catch (e) {
        // supabase-js only throws for transport failures (offline, DNS, aborted).
        result = loadStateFor({ error: { message: e instanceof Error ? e.message : String(e) } });
      }
      if (cancelled) return;
      if (result.kind !== "ready") {
        logger.warn({ id, kind: result.kind, detail: result.detail }, "Board load failed");
        setLoadState(result);
        return;
      }
      setInitialData(snapshot);
      setInitialVersion(version);
      setLoadState({ kind: "ready", message: "" });
    }
    void loadBoard();
    return () => {
      cancelled = true;
    };
  }, [id, userId, loadAttempt]);

  if (authLoading || !user || loadState.kind === "loading") {
    return <BoardLoading label={loadAttempt > 0 ? BOARD_LOAD_COPY.retrying : BOARD_LOAD_COPY.loading} />;
  }

  if (loadState.kind !== "ready") {
    // Never mount <Tldraw> here: an empty editor plus autosave could overwrite the board.
    return <BoardLoadError state={loadState} onRetry={retryLoad} />;
  }

  return (
    // touch-action: a quick double tap on the bar's buttons must not zoom the page on an iPad.
    // data-board-root: the page under it never scrolls or bounces (globals.css). Positioned by
    // class, not inline, so the keyboard fit's inline top/height fall back to inset: 0 when cleared.
    <div ref={setBoardRoot} data-board-root="" style={{ touchAction: "manipulation" }} className="fixed inset-0 flex flex-col md:landscape:flex-row">
      {/* the board refits whenever this box changes size (useScreenCamera): the whole screen stays in view */}
      <div className="relative min-h-0 min-w-0 flex-1">
      <Tldraw
        shapeUtils={liveShapeUtils}
        tools={liveTools}
        overrides={boardOverrides}
        // a board is for writing: the pen is in hand when it opens, not the selection arrow
        initialState="draw"
        licenseKey={process.env.NEXT_PUBLIC_TLDRAW_LICENSE_KEY}
        // no GitHub Gist: tldraw runs its script unsandboxed, in our origin (src/lib/boards/embeds.ts)
        embeds={BOARD_EMBEDS}
        assets={assetStoreBundle?.store}
        components={{
          MenuPanel: null,
          NavigationPanel: ScreenStrip,
          // a narrow board's strip, in the corner the style panel leaves free (screenStripSlot)
          SharePanel: ScreenStripCorner,
          HelperButtons: null,
          Background: ScreenBackground,
          OnTheCanvas: ScreenFrame,
          Toolbar: LiveToolbar,
          // the pen's colour and size on request, not a panel always open over the screen
          StylePanel: PenStyleButton,
          // tldraw's own error screen offers "Reset data", which clears localStorage
          ErrorFallback: BoardCrashed,
        }}
        onMount={(editor) => {
          assetStoreBundle?.attach(editor);
          // Pasted/dropped pictures: one whose upload fails is removed again, not saved broken.
          editor.registerExternalContentHandler("files", (c) => import("@/lib/assets/addImageFiles").then((m) => m.addImageFiles(editor, c)));
          if (initialData) {
            try {
              loadSnapshot(editor.store, initialData);
            } catch (e) {
              // Already validated on a probe store, so this is a last line of defense:
              // unmount the editor before anything can be saved from it.
              logger.error({ id, error: e instanceof Error ? e.message : String(e) }, "Failed to load snapshot");
              setLoadState(loadStateFor({ row: initialData, restoreError: e }));
              return;
            }
          }
          // An overlay the student never accepted is a proposal, not part of the board: it
          // would otherwise reopen full-canvas over work they have moved on from. Dropping
          // it here is the same outcome as Reject (see dropPendingAiOverlays). Only boards
          // from the retired image pipeline have any, so the module loads for those alone.
          if (editor.getCurrentPageShapes().some((s) => s.meta.aiOverlay === true)) {
            void import("@/hooks/useAiOverlayShapes").then(({ dropPendingAiOverlays }) => {
              const dropped = dropPendingAiOverlays(editor);
              if (dropped.length > 0) logger.info({ id, count: dropped.length }, "Dropped pending AI overlays on load");
            });
          }
          // Boards saved before the asset store shipped still carry base64 images: move
          // them to Storage in the background. The rewrite is a store change, so the
          // autosave persists the new URLs; only failures are surfaced.
          void offloadAssetsOnce(editor)
            .then((result) => {
              if (result.migrated > 0 || result.failed.length > 0) {
                logger.info(
                  {
                    id,
                    migrated: result.migrated,
                    failed: result.failed.length,
                    bytesBefore: result.bytesBefore,
                    bytesAfter: result.bytesAfter,
                  },
                  "On-load asset offload finished",
                );
              }
              if (result.failed.length > 0) {
                logger.warn({ id, failed: result.failed }, "On-load asset offload left images inline");
                toast.warning(ASSET_COPY.offloadPartial);
                reportUserError({ kind: "live.image", code: "offload_partial", message: ASSET_COPY.offloadPartial, boardId: id, level: "warn" });
              }
            })
            .catch((e) => {
              logger.warn({ id, error: e instanceof Error ? e.message : String(e) }, "On-load asset offload failed");
              toast.warning(ASSET_COPY.offloadPartial);
              reportUserError({ kind: "live.image", code: "offload_failed", message: ASSET_COPY.offloadPartial, boardId: id, level: "warn" });
            });
          // The board is a stack of fixed screens: hold the camera on the current one (a page
          // saved before screens gets a screen that fits its existing ink, see ensureScreen).
          applyScreenCamera(editor);
          if (process.env.NODE_ENV !== "production") {
            // Dev-only handle for recording fixtures / poking the store from devtools.
            (window as unknown as { __agathonEditor?: Editor }).__agathonEditor = editor;
            // …and for drawing a figure spec in the tutor's hand: `__agathonDrawFigure(spec)`.
            void import("@/lib/live/figureDraw/board").then(({ drawFigureOnBoard }) => Object.assign(window, { __agathonDrawFigure: (spec: unknown) => drawFigureOnBoard(editor, spec) }));
          }
        }}
      >
        <BoardContent id={id} initialVersion={initialVersion} chat={{ open: chatOpen, onOpenChange: setChatOpen, host: chatHost }} />
      </Tldraw>
      </div>
      {/* the chat panel: docked on the right on a wide screen held sideways, a bottom sheet on a
          phone or an upright iPad (docked there it would leave the 16:9 board a postcard) */}
      <div
        ref={setChatHost}
        className={
          chatOpen
            ? "relative z-[1100] h-[46dvh] shrink-0 overflow-hidden border-t border-gray-200 bg-white shadow-[0_-4px_16px_rgba(0,0,0,0.06)] md:landscape:h-auto md:landscape:w-[360px] md:landscape:border-l md:landscape:border-t-0 md:landscape:shadow-none"
            : "hidden"
        }
      />
    </div>
  );
}
