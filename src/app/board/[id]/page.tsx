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
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
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
import { dropPendingAiOverlays } from "@/hooks/useAiOverlayShapes";
import { useAssistanceMode, type AssistanceMode } from "@/hooks/useAssistanceMode";
import { offloadAssetsOnce, useSnapshotSave } from "@/hooks/useSnapshotSave";
import { useBoardAutoTitle } from "@/hooks/useBoardAutoTitle";
import { createBoardAssetStore } from "@/lib/assets/boardAssetStore";
import {
  BOARD_LOAD_COPY,
  BoardLoadError,
  BoardLoading,
  loadStateFor,
  type BoardLoadState,
} from "@/components/BoardLoadError";
import { logger } from "@/lib/logger";
import { supabase } from "@/lib/supabase";
import { useParams, useRouter } from "next/navigation";
import { Bug, MessageSquare } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/components/AuthProvider";
import { CreditsBanner } from "@/components/CreditsBanner";
import { OutOfCreditsWatcher } from "@/components/billing/OutOfCreditsWatcher";
import { StickerLibrary } from "@/components/StickerLibrary";
import { PdfUpload } from "@/components/PdfUpload";
import { BugReportButton } from "@/components/BugReportButton";
import { captureBoardScreenshot } from "@/components/board/boardScreenshot";
import { BETA_COPY } from "@/components/app/BetaBadge";
import { Celebrations } from "@/components/live/Celebrations";
import { useFeatureLabs } from "@/lib/featureLabs";
import { ListOrdered } from "lucide-react";
import { liveShapeUtils, liveTools, liveUiOverrides, LiveToolbar } from "@/shapes";
import { LIVE_KILL_SWITCH } from "@/lib/live/contracts";
import { useLiveMath } from "@/lib/live/useLiveMath";
import { useLiveSettings } from "@/lib/live/liveSettings";
import { ScreenStrip, ScreenStripCorner, screenStripSlot } from "@/components/screens/ScreenStrip";
import { PenStyleButton } from "@/components/board/PenStyleButton";
import { LiveDebugPanel } from "@/components/live/LiveDebugPanel";
import { ScreenBackground, ScreenFrame } from "@/components/screens/ScreenFrame";
import { applyScreenCamera } from "@/lib/screens/screens";
import { useScreenCamera } from "@/lib/screens/useScreenCamera";
import { LiveStatusPill } from "@/components/live/LiveStatusPill";
import { SaveStatus } from "@/components/live/SaveStatus";
import { LiveHintLayer } from "@/components/live/LiveHintLayer";
import { LiveErrorBoundary } from "@/components/live/LiveErrorBoundary";
import { ASSET_COPY, LIVE_COPY } from "@/components/live/copy";
import { boardToolbarView } from "@/components/live/toolbar";
import { BoardChatPanel, CHAT_TOGGLE_ATTR } from "@/components/chat/BoardChatPanel";
import { CHAT_COPY } from "@/components/chat/chatView";
import { useChatOpen } from "@/components/chat/useBoardChat";
import { useLecture } from "@/components/lecture/useLecture";
import { LectureButton } from "@/components/lecture/LectureButton";
import { LectureBar } from "@/components/lecture/LectureBar";
import { browserStorage as onboardingStorage, isGuidedBoard } from "@/lib/onboarding/marker";

// The guided first board's tour (the welcome's Start): loaded on that board only, after the board.
const BoardTour = React.lazy(() => import("@/components/onboarding/BoardTour"));

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

/**
 * The (i) explainer, opened from Board options rather than from a button in the bar: it is
 * help, not chrome. Copy tracks what the tabs actually do today, Live included.
 */
function ModeInfoDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl">
        <DialogHeader>
          <DialogTitle>Help modes</DialogTitle>
          <DialogDescription>
            The tabs at the top of your board set how much the tutor helps. New boards start
            in Feedback, and your choice is remembered for this board on this device. Off
            stops every check, hint and solution.
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-wrap gap-6">
          <div className="flex-1 min-w-[200px] flex flex-col items-start">
            <img
              src="/modes/feedback.png"
              alt="Feedback mode example"
              className="h-48 w-auto rounded-md border bg-muted object-contain mb-3"
            />
            <p className="text-sm font-medium mb-1">Feedback</p>
            <p className="text-sm text-muted-foreground">
              Light annotations pointing out mistakes without giving away answers.
            </p>
          </div>

          <div className="flex-1 min-w-[200px] flex flex-col items-start">
            <img
              src="/modes/suggest.png"
              alt="Suggest mode example"
              className="h-48 w-auto rounded-md border bg-muted object-contain mb-3"
            />
            <p className="text-sm font-medium mb-1">Suggest</p>
            <p className="text-sm text-muted-foreground">
              Hints and partial steps to nudge you in the right direction.
            </p>
          </div>

          <div className="flex-1 min-w-[200px] flex flex-col items-start">
            <img
              src="/modes/solve.png"
              alt="Solve mode example"
              className="h-48 w-auto rounded-md border bg-muted object-contain mb-3"
            />
            <p className="text-sm font-medium mb-1">Solve</p>
            <p className="text-sm text-muted-foreground">
              Worked steps written under your last line, in the tutor&apos;s hand or typeset.
            </p>
          </div>

        </div>
        {/* Live is not a fourth mode: it runs underneath all three, so it reads as a note. */}
        <div className="flex items-start gap-3 rounded-md border bg-muted/40 p-3">
          <span aria-hidden className="font-serif text-3xl leading-none text-gray-400">
            &Sigma;
          </span>
          <div>
            <p className="text-sm font-medium mb-1">{LIVE_COPY.modeInfo.title}</p>
            <p className="text-sm text-muted-foreground">{LIVE_COPY.modeInfo.body}</p>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

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
  // The (i) explainer and the bug report both used to be buttons in the bar; they open from
  // Board options now, so the page owns their open state.
  const [modeInfoOpen, setModeInfoOpen] = useState(false);
  const [reportOpen, setReportOpen] = useState(false);
  const { user } = useAuth();
  const [guided, setGuided] = useState(() => isGuidedBoard(onboardingStorage(), user?.id, id));
  const endTour = useCallback(() => setGuided(false), []);

  // Live Math layer: per-device switch (localStorage) gated by the deploy-time kill switch.
  const { settings: live, update: updateLive } = useLiveSettings();
  const liveEnabled = live.enabled && !LIVE_KILL_SWITCH;
  const controller = useLiveMath(editor, {
    boardId: id,
    mode: assistanceMode,
    enabled: liveEnabled,
  });
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
  useBoardAutoTitle(id, sync);

  const narrowBoard = screenStripSlot(useBreakpoint()) === "corner";

  // One place decides what the bar shows (see src/components/live/toolbar.ts).
  const toolbar = boardToolbarView({
    mode: assistanceMode,
    liveEnabled: live.enabled,
    liveAvailable: !LIVE_KILL_SWITCH,
  });

  return (
    <>
      {/*
        The board's one primary row: go back, choose how much help, see what the tutor is
        doing, and (in Solve) ask for the worked steps. Everything rare — the Live
        preference, the help-mode explainer — hangs off the status pill's "…" menu rather
        than competing with them. Report a bug has a button of its own while we are in beta.
      */}
      <div
        style={{
          position: 'absolute',
          top: '16px',
          left: '16px',
          zIndex: 1000,
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
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <Tabs
            value={assistanceMode}
            onValueChange={(value) => setAssistanceMode(value as AssistanceMode)}
            className="w-auto shadow-sm rounded-lg"
          >
            <TabsList aria-label="How much help">
              <TabsTrigger value="off">Off</TabsTrigger>
              <TabsTrigger value="feedback">Feedback</TabsTrigger>
              <TabsTrigger value="suggest">Suggest</TabsTrigger>
              <TabsTrigger value="answer">Solve</TabsTrigger>
            </TabsList>
          </Tabs>
          {toolbar.showSolveSteps && (
            <Button
              variant="outline"
              size="sm"
              className="bg-white shadow-sm"
              title={LIVE_COPY.solve.stepsHint}
              onClick={() => controller.requestSolve()}
            >
              <ListOrdered className="h-4 w-4" />
              <span className="ml-1.5">{LIVE_COPY.solve.steps}</span>
            </Button>
          )}
          <Button
            variant={chat.open ? "secondary" : "outline"}
            size="sm"
            className={chat.open ? "shadow-sm" : "bg-white shadow-sm"}
            title={CHAT_COPY.buttonHint}
            aria-expanded={chat.open}
            {...{ [CHAT_TOGGLE_ATTR]: "" }}
            onClick={() => chat.onOpenChange(!chat.open)}
          >
            <MessageSquare className="h-4 w-4" />
            <span className="ml-1.5">{CHAT_COPY.button}</span>
          </Button>
          <LectureButton lecture={lecture} />
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
              onReportProblem={() => setReportOpen(true)}
            />
          </LiveErrorBoundary>
          <SaveStatus sync={sync} onRetry={() => void retrySave()} />
          <Button
            variant="outline"
            size="sm"
            className="h-8 gap-1.5 rounded-full bg-white px-3 shadow-sm"
            title={BETA_COPY.hint}
            aria-label="Report a bug"
            onClick={() => setReportOpen(true)}
          >
            <Bug className="size-3.5" aria-hidden />
            <span className="hidden text-xs font-medium lg:inline">Report a bug</span>
          </Button>
          {features.stickers && <StickerLibrary />}
          {features.pdfUpload && <PdfUpload />}
        </div>
      </div>

      {/* The explainer opens from Board options; the report from there or its button in the bar. */}
      <ModeInfoDialog open={modeInfoOpen} onOpenChange={setModeInfoOpen} />
      <BugReportButton boardId={id} open={reportOpen} onOpenChange={setReportOpen} screenshot={() => captureBoardScreenshot(editor)} />
      {liveEnabled && live.celebrations && <Celebrations editor={editor} />}

      <div
        style={{
          position: "absolute",
          bottom: "16px",
          right: "16px",
          zIndex: 1000,
          maxWidth: "360px",
        }}
      >
        <CreditsBanner />
      </div>
      {/* a Live 402 opens the out-of-credits dialog (lazy), never mid-stroke */}
      <OutOfCreditsWatcher editor={editor} />
      <LiveErrorBoundary>
        <LectureBar lecture={lecture} />
      </LiveErrorBoundary>
      <LiveDebugPanel />
      {toolbar.showHintLayer && (
        <LiveErrorBoundary>
          <LiveHintLayer editor={editor} controller={controller} />
        </LiveErrorBoundary>
      )}
      {guided && user && (
        <LiveErrorBoundary>
          <React.Suspense fallback={null}>
            <BoardTour boardId={id} userId={user.id} controller={controller} onModeChange={setAssistanceMode} chatOpen={chat.open} onFinished={endTour} />
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
      router.replace("/login");
    }
  }, [user, authLoading, router]);

  const retryLoad = useCallback(() => {
    setInitialData(null);
    setInitialVersion(null);
    setLoadState({ kind: "loading" });
    setLoadAttempt((n) => n + 1);
  }, []);

  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    async function loadBoard() {
      let result: BoardLoadState;
      let snapshot: BoardSnapshot | null = null;
      let version: number | null = null;
      try {
        const { data, error } = await supabase
          .from('whiteboards')
          .select('data, version')
          .eq('id', id)
          .single();

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
  }, [id, user, loadAttempt]);

  if (authLoading || !user || loadState.kind === "loading") {
    return <BoardLoading label={loadAttempt > 0 ? BOARD_LOAD_COPY.retrying : BOARD_LOAD_COPY.loading} />;
  }

  if (loadState.kind !== "ready") {
    // Never mount <Tldraw> here: an empty editor plus autosave could overwrite the board.
    return <BoardLoadError state={loadState} onRetry={retryLoad} />;
  }

  return (
    // touch-action: a quick double tap on the bar's buttons must not zoom the page on an iPad
    <div style={{ position: "fixed", inset: 0, touchAction: "manipulation" }} className="flex flex-col md:landscape:flex-row">
      {/* the board refits whenever this box changes size (useScreenCamera): the whole screen stays in view */}
      <div className="relative min-h-0 min-w-0 flex-1">
      <Tldraw
        shapeUtils={liveShapeUtils}
        tools={liveTools}
        overrides={boardOverrides}
        // a board is for writing: the pen is in hand when it opens, not the selection arrow
        initialState="draw"
        licenseKey={process.env.NEXT_PUBLIC_TLDRAW_LICENSE_KEY}
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
        }}
        onMount={(editor) => {
          assetStoreBundle?.attach(editor);
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
          // it here is the same outcome as Reject (see dropPendingAiOverlays).
          const dropped = dropPendingAiOverlays(editor);
          if (dropped.length > 0) logger.info({ id, count: dropped.length }, "Dropped pending AI overlays on load");
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
              }
            })
            .catch((e) => {
              logger.warn({ id, error: e instanceof Error ? e.message : String(e) }, "On-load asset offload failed");
              toast.warning(ASSET_COPY.offloadPartial);
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
