"use client";

import {
  Tldraw,
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
import React, { useCallback, useState, useRef, useEffect, useMemo } from "react";
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
  Mic02Icon,
  MicOff02Icon,
  Loading03Icon,
} from "hugeicons-react";
import { dropPendingAiOverlays } from "@/hooks/useAiOverlayShapes";
import { useAssistanceMode, type AssistanceMode } from "@/hooks/useAssistanceMode";
import { offloadAssetsOnce, useSnapshotSave } from "@/hooks/useSnapshotSave";
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
import { apiJson } from "@/lib/api-client";
import { useApiErrorHandler } from "@/hooks/useApiErrorHandler";
import { useParams, useRouter } from "next/navigation";
import { Volume2, VolumeX } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/components/AuthProvider";
import { CreditsBanner } from "@/components/CreditsBanner";
import { StickerLibrary } from "@/components/StickerLibrary";
import { PdfUpload } from "@/components/PdfUpload";
import { BugReportButton } from "@/components/BugReportButton";
import { useFeatureLabs } from "@/lib/featureLabs";
import { ListOrdered } from "lucide-react";
import { liveShapeUtils, liveTools, liveUiOverrides, LiveToolbar } from "@/shapes";
import { LIVE_KILL_SWITCH, type LiveController } from "@/lib/live/contracts";
import { useLiveMath } from "@/lib/live/useLiveMath";
import { runVoiceTool, voiceSessionTools, VOICE_SESSION_INSTRUCTIONS } from "@/lib/live/voiceTools";
import { useLiveSettings } from "@/lib/live/liveSettings";
import { ScreenStrip } from "@/components/screens/ScreenStrip";
import { ScreenBackground, ScreenFrame } from "@/components/screens/ScreenFrame";
import { applyScreenCamera } from "@/lib/screens/screens";
import { useScreenCamera } from "@/lib/screens/useScreenCamera";
import { LiveStatusPill } from "@/components/live/LiveStatusPill";
import { SaveStatus } from "@/components/live/SaveStatus";
import { LiveHintLayer } from "@/components/live/LiveHintLayer";
import { LiveErrorBoundary } from "@/components/live/LiveErrorBoundary";
import { ASSET_COPY, LIVE_COPY } from "@/components/live/copy";
import { boardToolbarView } from "@/components/live/toolbar";

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

type VoiceStatus =
  | "idle"
  | "connecting"
  | "listening"
  | "thinking"
  | "callingTool"
  | "error";

/** Subset of OpenAI Realtime server events we react to. */
type RealtimeServerEvent = {
  type?: string;
  message?: string;
  error?: { message?: string };
  response?: {
    output?: Array<{
      type?: string;
      name?: string;
      arguments?: string;
      call_id?: string;
    }>;
  };
};

type AnalyzeWorkspaceResponse = { analysis?: string | null };
type VoiceTokenResponse = { client_secret?: string | null };

interface VoiceAgentControlsProps {
  onSessionChange: (active: boolean) => void;
  /** the Live layer the voice tools read and write (read_live_math, place_math, plot_function) */
  controller: LiveController;
}

function VoiceAgentControls({
  onSessionChange,
  controller,
}: VoiceAgentControlsProps) {
  const editor = useEditor();
  const handleApiError = useApiErrorHandler();
  const [isSessionActive, setIsSessionActive] = useState(false);
  const [status, setStatus] = useState<VoiceStatus>("idle");
  const [statusDetail, setStatusDetail] = useState<string | null>(null);
  const [isMuted, setIsMuted] = useState(false);

  const pcRef = useRef<RTCPeerConnection | null>(null);
  const dcRef = useRef<RTCDataChannel | null>(null);
  const localStreamRef = useRef<MediaStream | null>(null);
  const remoteAudioRef = useRef<HTMLAudioElement | null>(null);

  const statusMessages: Record<Exclude<VoiceStatus, "idle">, string> = {
    connecting: "Connecting voice assistant...",
    listening: "Listening...",
    thinking: "Thinking...",
    callingTool: "Working on your canvas...",
    error: "Voice error",
  };

  const setErrorStatus = useCallback((message: string) => {
    setStatus("error");
    setStatusDetail(message);
    console.error("[Voice Agent]", message);
  }, []);

  const cleanupSession = useCallback(() => {
    dcRef.current?.close();
    pcRef.current?.close();

    dcRef.current = null;
    pcRef.current = null;

    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach((t) => t.stop());
      localStreamRef.current = null;
    }

    if (remoteAudioRef.current) {
      remoteAudioRef.current.srcObject = null;
      remoteAudioRef.current = null;
    }
  }, []);

  const stopSession = useCallback(() => {
    cleanupSession();
    setIsSessionActive(false);
    setStatus("idle");
    setStatusDetail(null);
    setIsMuted(false);
    onSessionChange(false);
  }, [cleanupSession, onSessionChange]);

  const captureCanvasImage = useCallback(async (): Promise<string | null> => {
    if (!editor) return null;

    const shapeIds = editor.getCurrentPageShapeIds();
    if (shapeIds.size === 0) return null;

    const viewportBounds = editor.getViewportPageBounds();
    const { blob } = await editor.toImage([...shapeIds], {
      format: "png",
      bounds: viewportBounds,
      background: true,
      scale: 1,
      padding: 0,
    });

    if (!blob) return null;

    return await new Promise<string>((resolve) => {
      const reader = new FileReader();
      reader.onloadend = () => resolve(reader.result as string);
      reader.readAsDataURL(blob);
    });
  }, [editor]);

  const handleFunctionCall = useCallback(
    async (name: string, argsJson: string, callId: string) => {
      const dc = dcRef.current;
      if (!dc) return;

      let args: Record<string, unknown> = {};
      try {
        const parsed: unknown = argsJson ? JSON.parse(argsJson) : {};
        args = parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : {};
      } catch {
        setErrorStatus(`Failed to parse tool arguments for ${name}`);
        return;
      }

      try {
        setStatus("callingTool");
        setStatusDetail(name === "analyze_workspace" ? "Analyzing your canvas..." : "Working on your canvas...");

        // Live tools read and write typeset maths through the controller (no network);
        // analyze_workspace is a vision READ of the viewport. Nothing paints an image.
        const output = await runVoiceTool(name, args, {
          controller,
          analyzeWorkspace: async (focus) => {
            const image = await captureCanvasImage();
            if (!image) {
              throw new Error("Canvas is empty or could not be captured");
            }
            const data = await apiJson<AnalyzeWorkspaceResponse>(
              "/api/voice/analyze-workspace",
              { image, focus },
            );
            return data.analysis ?? "";
          },
        });

        dc.send(
          JSON.stringify({
            type: "conversation.item.create",
            item: {
              type: "function_call_output",
              call_id: callId,
              output,
            },
          }),
        );

        dc.send(
          JSON.stringify({
            type: "response.create",
          }),
        );

        setStatus("thinking");
        setStatusDetail(null);
      } catch (error) {
        console.error("[Voice Agent] Tool error", error);

        const message = handleApiError(error, {
          fallback: "Tool execution failed",
        });

        dc.send(
          JSON.stringify({
            type: "conversation.item.create",
            item: {
              type: "function_call_output",
              call_id: callId,
              output: JSON.stringify({ error: message }),
            },
          }),
        );

        dc.send(
          JSON.stringify({
            type: "response.create",
          }),
        );

        setErrorStatus(`Tool ${name} failed: ${message}`);
      }
    },
    [captureCanvasImage, controller, setErrorStatus, handleApiError],
  );

  const handleServerEvent = useCallback(
    (event: RealtimeServerEvent) => {
      if (!event || typeof event !== "object") return;

      switch (event.type) {
        case "response.created":
          setStatus("thinking");
          setStatusDetail(null);
          break;
        case "response.output_text.delta":
          // Streaming text tokens are available here if you want on-screen captions.
          break;
        case "response.done": {
          const output = event.response?.output ?? [];
          for (const item of output) {
            if (item.type === "function_call" && item.name && item.call_id) {
              handleFunctionCall(
                item.name,
                item.arguments ?? "{}",
                item.call_id,
              );
            }
          }
          setStatus("listening");
          setStatusDetail(null);
          break;
        }
        case "input_audio_buffer.speech_started":
          setStatus("listening");
          setStatusDetail("Listening...");
          break;
        case "input_audio_buffer.speech_stopped":
          setStatus("thinking");
          setStatusDetail(null);
          break;
        case "error":
          // Log the full error object for debugging
          console.error("[Voice Agent] Server error event:", event);
          setErrorStatus(event.error?.message || event.message || "Realtime error");
          break;
        case "invalid_request_error":
          console.error("[Voice Agent] Invalid request error:", event);
          setErrorStatus(event.message || "Invalid request");
          break;
        default:
          break;
      }
    },
    [handleFunctionCall, setErrorStatus],
  );

  const startSession = useCallback(async () => {
    if (isSessionActive) return;

    if (!editor) {
      setErrorStatus("Canvas not ready yet");
      return;
    }

    try {
      setStatus("connecting");
      setStatusDetail(null);

      const stream = await navigator.mediaDevices.getUserMedia({
        audio: true,
      });
      localStreamRef.current = stream;

      const pc = new RTCPeerConnection();
      pcRef.current = pc;

      const audioEl = document.createElement("audio");
      audioEl.autoplay = true;
      remoteAudioRef.current = audioEl;
      pc.ontrack = (e) => {
        audioEl.srcObject = e.streams[0];
      };

      stream.getTracks().forEach((track) => pc.addTrack(track, stream));

      const dc = pc.createDataChannel("oai-events");
      dcRef.current = dc;

      dc.onopen = () => {
        setStatus("listening");
        setStatusDetail(null);
        setIsSessionActive(true);
        onSessionChange(true);

        const tools = voiceSessionTools();

        const sessionUpdate = {
          type: "session.update",
          session: {
            // Model and core configuration are set when creating the session;
            // here we provide instructions and tools.
            modalities: ["audio", "text"],
            instructions: VOICE_SESSION_INSTRUCTIONS,
            tools,
            tool_choice: "auto",
          },
        };

        dc.send(JSON.stringify(sessionUpdate));
      };

      dc.onmessage = (event) => {
        try {
          const serverEvent = JSON.parse(event.data) as RealtimeServerEvent;
          handleServerEvent(serverEvent);
        } catch (e) {
          console.error("[Voice Agent] Failed to parse server event", e);
        }
      };

      dc.onerror = (e) => {
        console.error("[Voice Agent] DataChannel error", e);
        setErrorStatus("Voice channel error");
      };

      pc.onconnectionstatechange = () => {
        if (pc.connectionState === "failed" || pc.connectionState === "disconnected") {
          setErrorStatus("Voice connection lost");
          stopSession();
        }
      };

      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);

      // Wait for ICE gathering to complete before sending SDP to OpenAI.
      await new Promise<void>((resolve) => {
        if (pc.iceGatheringState === "complete") {
          resolve();
          return;
        }
        const checkState = () => {
          if (pc.iceGatheringState === "complete") {
            pc.removeEventListener("icegatheringstatechange", checkState);
            resolve();
          }
        };
        pc.addEventListener("icegatheringstatechange", checkState);
      });

      const { client_secret } = await apiJson<VoiceTokenResponse>(
        "/api/voice/token",
        {},
      );
      if (!client_secret) {
        throw new Error("Realtime token missing client_secret");
      }

      // Note: client_secret is used as a Bearer token in the Authorization header
      const sdpRes = await fetch(
        "https://api.openai.com/v1/realtime?model=gpt-realtime",
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${client_secret}`,
            "Content-Type": "application/sdp",
          },
          body: pc.localDescription?.sdp ?? "",
        },
      );

      if (!sdpRes.ok) {
        const errorText = await sdpRes.text().catch(() => "");
        console.error(
          "[Voice Agent] SDP exchange failed",
          sdpRes.status,
          errorText,
        );
        throw new Error("Failed to exchange SDP with Realtime API");
      }

      const answerSdp = await sdpRes.text();
      await pc.setRemoteDescription({
        type: "answer",
        sdp: answerSdp,
      });
    } catch (error) {
      console.error("[Voice Agent] Failed to start session", error);
      setErrorStatus(
        handleApiError(error, { fallback: "Failed to start voice session" }),
      );
      stopSession();
    }
  }, [editor, isSessionActive, handleServerEvent, onSessionChange, setErrorStatus, stopSession, handleApiError]);

  const handleClick = () => {
    if (isSessionActive) {
      stopSession();
    } else {
      void startSession();
    }
  };

  const handleToggleMute = () => {
    setIsMuted((prev) => {
      const next = !prev;

      // Following WebRTC best practices for Realtime:
      // mute by disabling the outgoing microphone track(s),
      // so no audio is sent to the agent while keeping the session alive.
      if (localStreamRef.current) {
        localStreamRef.current.getAudioTracks().forEach((track) => {
          track.enabled = !next;
        });
      }

      return next;
    });
  };

  const showStatus = status !== "idle";
  const isError = status === "error";

  return (
    <>
      {/* Status indicator at top center */}
      {showStatus && (
        <div
          className="flex items-center gap-2 px-4 py-2 bg-white border border-gray-200 rounded-lg shadow-sm animate-in fade-in slide-in-from-top-2 duration-300"
          style={{
            position: "absolute",
            top: "10px",
            left: "50%",
            transform: "translateX(-50%)",
            zIndex: 1000,
          }}
        >
          {status !== "error" && (
            <Loading03Icon
              size={16}
              strokeWidth={2}
              className="animate-spin text-blue-600"
            />
          )}
          <span
            className={`text-sm font-medium ${
              isError ? "text-red-600" : "text-gray-700"
            }`}
          >
            {statusDetail || statusMessages[status] || "Voice status"}
          </span>
        </div>
      )}

      {/* Voice controls at center bottom */}
      <div className="absolute bottom-16 left-1/2 -translate-x-1/2 z-[2000] pointer-events-auto">
        <div className="flex items-center gap-2">
          {isSessionActive && (
            <Button
              type="button"
              onClick={handleToggleMute}
              variant="outline"
              size="icon"
              className="rounded-full shadow-md bg-white hover:bg-gray-50"
              aria-label={isMuted ? "Unmute tutor" : "Mute tutor"}
            >
              {isMuted ? (
                <VolumeX className="w-4 h-4" />
              ) : (
                <Volume2 className="w-4 h-4" />
              )}
            </Button>
          )}
          <Button
            onClick={handleClick}
            variant={"outline"}
            className="rounded-full shadow-md bg-white hover:bg-gray-50"
            size="lg"
          >
            {isSessionActive ? (
              <MicOff02Icon size={20} strokeWidth={2} />
            ) : (
              <Mic02Icon size={20} strokeWidth={2} />
            )}
            <span className="ml-2 font-medium">
              {isSessionActive ? "End Session" : "Voice Mode"}
            </span>
          </Button>
        </div>
      </div>
    </>
  );
}

function BoardContent({ id, initialVersion }: { id: string; initialVersion: number | null }) {
  const editor = useEditor();
  useScreenCamera(editor);
  const router = useRouter();
  const { features } = useFeatureLabs();
  const [isVoiceSessionActive, setIsVoiceSessionActive] = useState(false);
  // Help mode is remembered per board on this device (default Feedback).
  const [assistanceMode, setAssistanceMode] = useAssistanceMode(id);
  // The (i) explainer and the bug report both used to be buttons in the bar; they open from
  // Board options now, so the page owns their open state.
  const [modeInfoOpen, setModeInfoOpen] = useState(false);
  const [reportOpen, setReportOpen] = useState(false);

  // Live Math layer: per-device switch (localStorage) gated by the deploy-time kill switch.
  const { settings: live, update: updateLive } = useLiveSettings();
  const liveEnabled = live.enabled && !LIVE_KILL_SWITCH;
  const controller = useLiveMath(editor, {
    boardId: id,
    mode: assistanceMode,
    enabled: liveEnabled,
    voiceActive: isVoiceSessionActive,
  });

  // Auto-save through the SaveQueue (2 s debounce, offline backup + replay, optimistic
  // concurrency on `version`, size guard + Storage offload): src/hooks/useSnapshotSave.ts
  const { sync, retry: retrySave } = useSnapshotSave(editor, id, initialVersion);

  // One place decides what the bar shows (see src/components/live/toolbar.ts).
  const toolbar = boardToolbarView({
    mode: assistanceMode,
    liveEnabled: live.enabled,
    liveAvailable: !LIVE_KILL_SWITCH,
    voiceActive: isVoiceSessionActive,
  });

  return (
    <>
      {/*
        The board's one primary row: go back, choose how much help, see what the tutor is
        doing, and (in Solve) ask for the worked steps. Everything rare — the Live
        preference, the help-mode explainer, Report a problem — hangs off the status pill's
        "…" menu rather than competing with them.
      */}
      {toolbar.showTopBar && (
        <div
          style={{
            position: 'absolute',
            top: '16px',
            left: '16px',
            zIndex: 1000,
            display: 'flex',
            alignItems: 'center',
            gap: '12px',
            // Wrap on narrow screens (400 px) so the status pill stays reachable;
            // leave room for tldraw's style panel pinned at the top-right.
            flexWrap: 'wrap',
            maxWidth: 'calc(100% - 180px)',
          }}
        >
          <Button
            variant="ghost"
            size="icon"
            aria-label="Back to my whiteboards"
            onClick={() => router.push("/")}
          >
            <ArrowLeft01Icon size={20} strokeWidth={2} />
          </Button>
          <div className="flex flex-wrap items-center gap-2">
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
            {toolbar.showStatusPill && (
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
            )}
            <SaveStatus sync={sync} onRetry={() => void retrySave()} />
            {features.stickers && <StickerLibrary />}
            {features.pdfUpload && <PdfUpload />}
          </div>
        </div>
      )}

      {/* Opened from Board options; neither owns a button in the bar any more. */}
      <ModeInfoDialog open={modeInfoOpen} onOpenChange={setModeInfoOpen} />
      <BugReportButton boardId={id} open={reportOpen} onOpenChange={setReportOpen} />

      {!isVoiceSessionActive && (
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
      )}
      {toolbar.showHintLayer && (
        <LiveErrorBoundary>
          <LiveHintLayer editor={editor} controller={controller} />
        </LiveErrorBoundary>
      )}
      <VoiceAgentControls onSessionChange={setIsVoiceSessionActive} controller={controller} />
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
    <div style={{ position: "fixed", inset: 0 }}>
      <Tldraw
        shapeUtils={liveShapeUtils}
        tools={liveTools}
        overrides={boardOverrides}
        licenseKey={process.env.NEXT_PUBLIC_TLDRAW_LICENSE_KEY}
        assets={assetStoreBundle?.store}
        components={{
          MenuPanel: null,
          NavigationPanel: ScreenStrip,
          HelperButtons: null,
          Background: ScreenBackground,
          OnTheCanvas: ScreenFrame,
          Toolbar: LiveToolbar,
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
          }
        }}
      >
        <BoardContent id={id} initialVersion={initialVersion} />
      </Tldraw>
    </div>
  );
}
