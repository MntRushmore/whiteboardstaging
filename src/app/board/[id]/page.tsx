"use client";

import {
  Tldraw,
  useEditor,
  createShapeId,
  TLShapeId,
  DefaultColorThemePalette,
  type TLUiOverrides,
  type TLUiIconJsx,
  type TLEditorSnapshot,
  type TLStoreSnapshot,
  loadSnapshot,
  type Editor,
  type HistoryEntry,
  type TLRecord,
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
  DialogTrigger,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import {
  Tick01Icon,
  Cancel01Icon,
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
import { isStudentActivity, useDebounceActivity } from "@/hooks/useDebounceActivity";
import { aiOverlayMeta, overlayIndexBelowLive, useAiOverlayShapes } from "@/hooks/useAiOverlayShapes";
import { useAssistanceMode, type AssistanceMode } from "@/hooks/useAssistanceMode";
import { offloadAssetsOnce, useSnapshotSave, warnInlineAssetFallbackOnce } from "@/hooks/useSnapshotSave";
import { createBoardAssetStore } from "@/lib/assets/boardAssetStore";
import { uploadDataUrlAsset } from "@/lib/assets/uploadDataUrl";
import { StatusIndicator, type StatusIndicatorState } from "@/components/StatusIndicator";
import { logger } from "@/lib/logger";
import { supabase } from "@/lib/supabase";
import { apiJson } from "@/lib/api-client";
import { isAbortError, useApiErrorHandler } from "@/hooks/useApiErrorHandler";
import { useParams, useRouter } from "next/navigation";
import { Loader2, Volume2, VolumeX, Info } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/components/AuthProvider";
import { CreditsBanner } from "@/components/CreditsBanner";
import { StickerLibrary } from "@/components/StickerLibrary";
import { WorksheetGenerator } from "@/components/WorksheetGenerator";
import { PdfUpload } from "@/components/PdfUpload";
import { BugReportButton } from "@/components/BugReportButton";
import { useFeatureLabs } from "@/lib/featureLabs";
import { useAIPerfSettings } from "@/lib/aiPerfSettings";
import { downscaleBlob } from "@/utils/downscaleImage";
import { Switch } from "@/components/ui/switch";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Settings, ListOrdered } from "lucide-react";
import { GenerationSkeleton } from "@/components/GenerationSkeleton";
import { liveShapeUtils, liveTools, liveUiOverrides, LiveToolbar } from "@/shapes";
import { isLiveMeta, LIVE_KILL_SWITCH, LIVE_TIMING } from "@/lib/live/contracts";
import { legacyShouldSkip } from "@/lib/live/liveStore";
import { useLiveMath } from "@/lib/live/useLiveMath";
import { useLiveSettings } from "@/lib/live/liveSettings";
import { LiveToggle } from "@/components/live/LiveToggle";
import { LiveStatusPill } from "@/components/live/LiveStatusPill";
import { LiveHintLayer } from "@/components/live/LiveHintLayer";
import { LiveErrorBoundary } from "@/components/live/LiveErrorBoundary";
import { ASSET_COPY, LIVE_COPY } from "@/components/live/copy";

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

function ModeInfoDialog() {
  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          aria-label="How the help modes work"
        >
          <Info className="h-4 w-4" />
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-4xl">
        <DialogHeader>
          <DialogTitle>Help modes</DialogTitle>
          <DialogDescription>
            Choose how strongly the tutor helps on your canvas. New boards start in
            Feedback; your choice is remembered for this board on this device. Off
            pauses all help.
          </DialogDescription>
        </DialogHeader>
        <div className="flex gap-6">
          <div className="flex-1 flex flex-col items-start">
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

          <div className="flex-1 flex flex-col items-start">
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

          <div className="flex-1 flex flex-col items-start">
            <img
              src="/modes/solve.png"
              alt="Solve mode example"
              className="h-48 w-auto rounded-md border bg-muted object-contain mb-3"
            />
            <p className="text-sm font-medium mb-1">Solve</p>
            <p className="text-sm text-muted-foreground">
              Full worked solution overlaid on your canvas for comparison.
            </p>
          </div>

          <div className="flex-1 flex flex-col items-start">
            <div
              aria-hidden
              className="h-48 w-full rounded-md border bg-muted mb-3 flex items-center justify-center text-4xl font-serif text-gray-400"
            >
              Σ
            </div>
            <p className="text-sm font-medium mb-1">{LIVE_COPY.modeInfo.title}</p>
            <p className="text-sm text-muted-foreground">{LIVE_COPY.modeInfo.body}</p>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function ImageActionButtons({
  pendingImageIds,
  onAccept,
  onReject,
  isVoiceSessionActive,
}: {
  pendingImageIds: TLShapeId[];
  onAccept: (shapeId: TLShapeId) => void;
  onReject: (shapeId: TLShapeId) => void;
  isVoiceSessionActive: boolean;
}) {
  // Only show buttons when there's a pending image
  if (pendingImageIds.length === 0) return null;

  // For now, we'll just handle the most recent pending image
  const currentImageId = pendingImageIds[pendingImageIds.length - 1];

  return (
    <div
      style={{
        position: 'absolute',
        // Sit at the top-center just below the mode bar so it never covers the
        // Live pill; when voice is active the bar is hidden and the voice status
        // banner owns the very top instead.
        top: isVoiceSessionActive ? '56px' : '64px',
        left: '50%',
        transform: 'translateX(-50%)',
        zIndex: 1000,
        display: 'flex',
        gap: '8px',
      }}
    >
      <Button
        variant="default"
        onClick={() => onAccept(currentImageId)}
      >
        <Tick01Icon size={20} strokeWidth={2.5} />
        <span className="ml-2">Accept</span>
      </Button>
      <Button
        variant="secondary"
        onClick={() => onReject(currentImageId)}
      >
        <Cancel01Icon size={20} strokeWidth={2.5} />
        <span className="ml-2">Reject</span>
      </Button>
    </div>
  );
}

type VoiceStatus =
  | "idle"
  | "connecting"
  | "listening"
  | "thinking"
  | "callingTool"
  | "error";

/** Arguments the Realtime model may pass to our tools. */
type VoiceToolArgs = {
  focus?: string | null;
  mode?: string;
  instructions?: string | null;
};

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
type GenerateSolutionResponse = {
  imageUrl?: string | null;
  textContent?: string | null;
};

interface VoiceAgentControlsProps {
  onSessionChange: (active: boolean) => void;
  onSolveWithPrompt: (
    mode: "feedback" | "suggest" | "answer",
    instructions?: string
  ) => Promise<boolean>;
}

function VoiceAgentControls({
  onSessionChange,
  onSolveWithPrompt,
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

      let args: VoiceToolArgs = {};
      try {
        args = argsJson ? (JSON.parse(argsJson) as VoiceToolArgs) : {};
      } catch {
        setErrorStatus(`Failed to parse tool arguments for ${name}`);
        return;
      }

      try {
        if (name === "analyze_workspace") {
          setStatus("callingTool");
          setStatusDetail("Analyzing your canvas...");

          const image = await captureCanvasImage();
          if (!image) {
            throw new Error("Canvas is empty or could not be captured");
          }

          const data = await apiJson<AnalyzeWorkspaceResponse>(
            "/api/voice/analyze-workspace",
            {
              image,
              focus: args.focus ?? null,
            },
          );
          const analysis = data.analysis ?? "";

          dc.send(
            JSON.stringify({
              type: "conversation.item.create",
              item: {
                type: "function_call_output",
                call_id: callId,
                output: JSON.stringify({
                  analysis,
                }),
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
        } else if (name === "draw_on_canvas") {
          setStatus("callingTool");
          setStatusDetail("Updating your canvas...");

          const mode =
            args.mode === "feedback" ||
            args.mode === "suggest" ||
            args.mode === "answer"
              ? args.mode
              : "suggest";

          const success =
            (await onSolveWithPrompt(
              mode,
              args.instructions ?? undefined,
            )) ?? false;

          dc.send(
            JSON.stringify({
              type: "conversation.item.create",
              item: {
                type: "function_call_output",
                call_id: callId,
                output: JSON.stringify({
                  success,
                  mode,
                }),
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
        }
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
    [captureCanvasImage, onSolveWithPrompt, setErrorStatus, handleApiError],
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

        const tools = [
          {
            type: "function",
            name: "analyze_workspace",
            description:
              "Analyze the current whiteboard canvas to understand what the user is working on and where they might need help.",
            parameters: {
              type: "object",
              properties: {
                focus: {
                  type: "string",
                  description:
                    "Optional focus for the analysis, e.g. 'find mistakes in the algebra' or 'summarize progress'.",
                },
              },
              required: [],
            },
          },
          {
            type: "function",
            name: "draw_on_canvas",
            description:
              "Use the Gemini 3 Pro canvas solver to add feedback, hints, or full solutions directly onto the whiteboard image.",
            parameters: {
              type: "object",
              properties: {
                mode: {
                  type: "string",
                  enum: ["feedback", "suggest", "answer"],
                  description:
                    "How strong the help should be: 'feedback' for light annotations, 'suggest' for hints, 'answer' for full solutions.",
                },
                instructions: {
                  type: "string",
                  description:
                    "Optional instructions about what to draw, which problem to focus on, or style preferences.",
                },
              },
              required: ["mode"],
            },
          },
        ];

        const sessionUpdate = {
          type: "session.update",
          session: {
            // Model and core configuration are set when creating the session;
            // here we provide instructions and tools.
            modalities: ["audio", "text"],
            instructions:
              "You are a realtime voice tutor for a handwritten whiteboard canvas. " +
              "Speak clearly and briefly. Use tools when you need to inspect the canvas " +
              "or add visual help. Prefer gentle hints before full solutions.",
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

type AIModel = "gemini" | "gpt";

const MODEL_LABELS: Record<AIModel, string> = {
  gemini: "Nano Banana Pro",
  gpt: "GPT-5.4 Image 2",
};

function ModelBadge({ model, onClick }: { model: AIModel; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      title={`Switch model (current: ${MODEL_LABELS[model]})`}
      className="flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium border shadow-sm bg-white hover:bg-gray-50 transition-colors cursor-pointer select-none"
      style={{ lineHeight: 1.4 }}
    >
      <span
        className="w-2 h-2 rounded-full flex-shrink-0"
        style={{ background: model === "gemini" ? "#F4B400" : "#10a37f" }}
      />
      {MODEL_LABELS[model]}
    </button>
  );
}

function PerfSettingsPopover({
  fastMode,
  onFastModeChange,
  downscaleEnabled,
  onDownscaleEnabledChange,
  downscaleMaxEdge,
  onDownscaleMaxEdgeChange,
  downscaleQuality,
  onDownscaleQualityChange,
  skeletonEnabled,
  onSkeletonEnabledChange,
}: {
  fastMode: boolean;
  onFastModeChange: (v: boolean) => void;
  downscaleEnabled: boolean;
  onDownscaleEnabledChange: (v: boolean) => void;
  downscaleMaxEdge: number;
  onDownscaleMaxEdgeChange: (v: number) => void;
  downscaleQuality: number;
  onDownscaleQualityChange: (v: number) => void;
  skeletonEnabled: boolean;
  onSkeletonEnabledChange: (v: boolean) => void;
}) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          title="AI performance settings"
          className="flex items-center gap-1.5 px-2 py-1 rounded-full text-xs font-medium border shadow-sm bg-white hover:bg-gray-50 transition-colors cursor-pointer select-none"
          style={{ lineHeight: 1.4 }}
        >
          <Settings size={14} strokeWidth={1.75} />
          {fastMode || downscaleEnabled || !skeletonEnabled ? (
            <span className="text-[10px] text-amber-600 font-semibold">
              {[
                fastMode && "Fast",
                downscaleEnabled && `${downscaleMaxEdge}px`,
                !skeletonEnabled && "No skel",
              ]
                .filter(Boolean)
                .join(" · ")}
            </span>
          ) : (
            <span>Speed</span>
          )}
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-80">
        <div className="space-y-4">
          <div>
            <div className="text-sm font-semibold mb-1">AI performance</div>
            <div className="text-xs text-gray-500">
              Toggles for testing generation speed. Stored locally.
            </div>
          </div>

          <div className="flex items-start justify-between gap-3">
            <div className="flex-1">
              <Label htmlFor="perf-fast-mode" className="text-sm font-medium">
                Fast mode
              </Label>
              <p className="text-xs text-gray-500 mt-0.5">
                Use Gemini 2.5 Flash Image (~3–6s) instead of Gemini 3 Pro (~15–20s).
                Lower quality, much faster. Only applies when Gemini is selected.
              </p>
            </div>
            <Switch
              id="perf-fast-mode"
              checked={fastMode}
              onCheckedChange={onFastModeChange}
            />
          </div>

          <div className="border-t pt-4 space-y-3">
            <div className="flex items-start justify-between gap-3">
              <div className="flex-1">
                <Label htmlFor="perf-downscale" className="text-sm font-medium">
                  Downscale canvas
                </Label>
                <p className="text-xs text-gray-500 mt-0.5">
                  Resize the captured canvas before upload. Cuts upload time and
                  often inference time, at some loss of fine detail.
                </p>
              </div>
              <Switch
                id="perf-downscale"
                checked={downscaleEnabled}
                onCheckedChange={onDownscaleEnabledChange}
              />
            </div>

            <div className={downscaleEnabled ? "opacity-100" : "opacity-50 pointer-events-none"}>
              <div className="flex items-center justify-between mb-1">
                <Label htmlFor="perf-max-edge" className="text-xs">
                  Max edge
                </Label>
                <span className="text-xs font-mono text-gray-700">
                  {downscaleMaxEdge}px
                </span>
              </div>
              <input
                id="perf-max-edge"
                type="range"
                min={512}
                max={2048}
                step={64}
                value={downscaleMaxEdge}
                onChange={(e) => onDownscaleMaxEdgeChange(Number(e.target.value))}
                className="w-full"
              />
              <div className="flex items-center justify-between mt-3 mb-1">
                <Label htmlFor="perf-quality" className="text-xs">
                  JPEG quality
                </Label>
                <span className="text-xs font-mono text-gray-700">
                  {Math.round(downscaleQuality * 100)}%
                </span>
              </div>
              <input
                id="perf-quality"
                type="range"
                min={0.5}
                max={0.95}
                step={0.05}
                value={downscaleQuality}
                onChange={(e) => onDownscaleQualityChange(Number(e.target.value))}
                className="w-full"
              />
            </div>
          </div>

          <div className="border-t pt-4">
            <div className="flex items-start justify-between gap-3">
              <div className="flex-1">
                <Label htmlFor="perf-skeleton" className="text-sm font-medium">
                  Loading skeleton
                </Label>
                <p className="text-xs text-gray-500 mt-0.5">
                  Show a shimmering placeholder where the AI image will land while
                  it&apos;s generating. Doesn&apos;t change the actual speed.
                </p>
              </div>
              <Switch
                id="perf-skeleton"
                checked={skeletonEnabled}
                onCheckedChange={onSkeletonEnabledChange}
              />
            </div>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}

function ClearFeedbackButton({
  feedbackImageIds,
  onClear,
  isVoiceSessionActive,
  hasPendingImages,
}: {
  feedbackImageIds: TLShapeId[];
  onClear: () => void;
  isVoiceSessionActive: boolean;
  hasPendingImages: boolean;
}) {
  if (feedbackImageIds.length === 0) return null;

  // Sit at the top-center below the mode bar (64 px; 10 px when voice hides the
  // bar); step down when the voice banner and/or the Accept/Reject buttons
  // already occupy that spot.
  const top = (isVoiceSessionActive ? 10 + 46 : 64) + (hasPendingImages ? 46 : 0);

  return (
    <div
      style={{
        position: "absolute",
        top: `${top}px`,
        left: "50%",
        transform: "translateX(-50%)",
        zIndex: 1000,
      }}
    >
      <Button
        variant="outline"
        size="sm"
        className="bg-white shadow-sm"
        onClick={onClear}
        title="Remove the tutor's feedback annotations from the canvas"
      >
        <Cancel01Icon size={16} strokeWidth={2.5} />
        <span className="ml-1.5">Clear feedback</span>
      </Button>
    </div>
  );
}

function BoardContent({ id }: { id: string }) {
  const editor = useEditor();
  const router = useRouter();
  const handleApiError = useApiErrorHandler();
  const { features } = useFeatureLabs();
  // Legacy AI overlays are found by `meta.aiOverlay` in the store (not React state) so
  // Accept/Reject and "Clear feedback" come back after a reload. `pending` = suggest/answer
  // overlays awaiting Accept/Reject; `feedback` = locked full-opacity feedback overlays.
  const { pending: pendingImageIds, feedback: feedbackImageIds } = useAiOverlayShapes(editor);
  const [status, setStatus] = useState<StatusIndicatorState>("idle");
  const [errorMessage, setErrorMessage] = useState<string>("");
  const [statusMessage, setStatusMessage] = useState<string>("");
  const [isVoiceSessionActive, setIsVoiceSessionActive] = useState(false);
  // Help mode is remembered per board on this device (default Feedback).
  const [assistanceMode, setAssistanceMode] = useAssistanceMode(id);
  const [aiModel, setAiModel] = useState<AIModel>("gemini");
  const { settings: aiPerf, update: updateAiPerf } = useAIPerfSettings();
  const isProcessingRef = useRef(false);
  const abortControllerRef = useRef<AbortController | null>(null);
  const lastCanvasImageRef = useRef<string | null>(null);
  const isUpdatingImageRef = useRef(false);

  // Live Math layer: per-device switch (localStorage) gated by the deploy-time kill switch.
  const { settings: live, update: updateLive } = useLiveSettings();
  const liveEnabled = live.enabled && !LIVE_KILL_SWITCH;
  const controller = useLiveMath(editor, {
    boardId: id,
    mode: assistanceMode,
    enabled: liveEnabled,
    voiceActive: isVoiceSessionActive,
  });

  // Helper function to get mode-aware status messages
  const getStatusMessage = useCallback((mode: AssistanceMode, statusType: "generating" | "success") => {
    if (statusType === "generating") {
      switch (mode) {
        case "off":
          return "";
        case "feedback":
          return "Adding feedback...";
        case "suggest":
          return "Generating suggestion...";
        case "answer":
          return "Solving problem...";
      }
    } else if (statusType === "success") {
      switch (mode) {
        case "off":
          return "";
        case "feedback":
          return "Feedback added";
        case "suggest":
          return "Suggestion added";
        case "answer":
          return "Solution added";
      }
    }
    return "";
  }, []);

  const generateSolution = useCallback(
    async (options?: {
      modeOverride?: "feedback" | "suggest" | "answer";
      promptOverride?: string;
      force?: boolean;
      source?: "auto" | "voice";
    }): Promise<boolean> => {
      // Block when we don't have an editor or a generation is already running.
      // Also block auto generations while a voice session is active, but allow
      // explicit voice-triggered generations to proceed.
      if (
        !editor ||
        isProcessingRef.current ||
        (isVoiceSessionActive && options?.source !== "voice")
      ) {
        return false;
      }

      const mode = options?.modeOverride ?? assistanceMode;
      if (mode === "off") return false;

      // Check if canvas has content
      const shapeIds = editor.getCurrentPageShapeIds();
      if (shapeIds.size === 0) {
        return false;
      }

      isProcessingRef.current = true;
    
      // Create abort controller for this request chain
      abortControllerRef.current = new AbortController();
      const signal = abortControllerRef.current.signal;

      try {
        // Step 1: Capture viewport (excluding pending generated images and
        // any "protected" shapes — worksheets, PDFs, stickers — so the AI
        // never sees them and can't try to redraw them).
        const viewportBounds = editor.getViewportPageBounds();

        const protectedIds = new Set<TLShapeId>();
        // Live echoes / graphs / AI steps are hidden from the capture too, but they do
        // not count as a "worksheet" layer (hasProtectedShapes stays isProtected-only).
        const liveIds = new Set<TLShapeId>();
        for (const sid of shapeIds) {
          const shape = editor.getShape(sid);
          if (shape?.meta?.isProtected) {
            protectedIds.add(sid);
          } else if (isLiveMeta(shape?.meta)) {
            liveIds.add(sid);
          }
        }

        const shapesToCapture = [...shapeIds].filter(
          (id) => !pendingImageIds.includes(id) && !protectedIds.has(id) && !liveIds.has(id),
        );

        if (shapesToCapture.length === 0) {
          isProcessingRef.current = false;
          return false;
        }

        const hasProtectedShapes = protectedIds.size > 0;
        
        const captureStart = performance.now();
        const { blob } = await editor.toImage(shapesToCapture, {
          format: "png",
          bounds: viewportBounds,
          background: true,
          scale: 1,
          padding: 0,
        });

        if (!blob || signal.aborted) return false;

        let base64: string;
        if (aiPerf.downscaleEnabled) {
          const result = await downscaleBlob(
            blob,
            aiPerf.downscaleMaxEdge,
            aiPerf.downscaleQuality,
          );
          base64 = result.dataUrl;
          logger.info(
            {
              originalBytes: blob.size,
              outputBytes: result.bytes,
              outputWidth: result.width,
              outputHeight: result.height,
              scaled: result.scaled,
              captureMs: Math.round(performance.now() - captureStart),
            },
            "Canvas captured (downscale enabled)",
          );
        } else {
          base64 = await new Promise<string>((resolve) => {
            const reader = new FileReader();
            reader.onloadend = () => resolve(reader.result as string);
            reader.readAsDataURL(blob);
          });
          logger.info(
            {
              originalBytes: blob.size,
              captureMs: Math.round(performance.now() - captureStart),
            },
            "Canvas captured (downscale disabled)",
          );
        }

        // If the canvas image hasn't changed since the last successful check,
        // don't run the expensive OCR / help-check / generation pipeline again.
        if (!options?.force && lastCanvasImageRef.current === base64) {
          isProcessingRef.current = false;
          setStatus("idle");
          setStatusMessage("");
          return false;
        }
        lastCanvasImageRef.current = base64;

        if (signal.aborted) return false;

        // Step 2: Generate solution (Gemini decides if help is needed)
        setStatus("generating");
        setStatusMessage(getStatusMessage(mode, "generating"));

        const effectiveModel =
          aiPerf.fastMode && aiModel === "gemini" ? "gemini-fast" : aiModel;
        const body: Record<string, unknown> = {
          image: base64,
          mode,
          model: effectiveModel,
        };

        if (options?.promptOverride) {
          body.prompt = options.promptOverride;
        }

        // Let the backend know whether this was triggered automatically or
        // explicitly by the voice tutor.
        body.source = options?.source ?? "auto";

        // If the canvas has a protected worksheet/PDF/sticker, tell the
        // backend so it can adjust the prompt and we render the annotation
        // underneath the protected layer.
        if (hasProtectedShapes) {
          body.hasWorksheet = true;
        }

        const solutionData = await apiJson<GenerateSolutionResponse>(
          "/api/generate-solution",
          body,
          { signal },
        );

        if (signal.aborted) return false;

        const imageUrl = solutionData.imageUrl;
        const textContent = solutionData.textContent || '';

        logger.info({ 
          hasImageUrl: !!imageUrl, 
          imageUrlLength: imageUrl?.length,
          imageUrlStart: imageUrl?.slice(0, 50),
          textContent: textContent.slice(0, 100)
        }, 'Solution data received');

        // If the model didn't return an image, it means Gemini decided help isn't needed.
        // Log the reason and gracefully stop. Returning to "idle" also hides the
        // generation skeleton (it is only visible while status === "generating").
        if (!imageUrl || signal.aborted) {
          logger.info({ textContent }, 'Gemini decided help is not needed');
          setStatus("idle");
          setStatusMessage("");
          setErrorMessage("");
          isProcessingRef.current = false;
          return false;
        }

        const processedImageUrl = imageUrl;

        if (signal.aborted) return false;

        // Create asset and shape
        const img = new Image();
        logger.info('Loading image into asset...');
        
        await new Promise((resolve, reject) => {
          img.onload = () => {
            logger.info({ width: img.width, height: img.height }, 'Image loaded successfully');
            resolve(null);
          };
          img.onerror = (e) => {
            logger.error({ error: e }, 'Image load failed');
            reject(new Error('Failed to load generated image'));
          };
          img.src = processedImageUrl;
        });

        if (signal.aborted) return false;

        logger.info('Creating asset and shape...');

        // Set flag to prevent these shape additions from triggering activity detection
        isUpdatingImageRef.current = true;

        // The PNG is uploaded to Storage (board-assets bucket) and the asset record only
        // holds its URL, so the snapshot stays small. On upload failure the asset falls
        // back to the inline data URL (warned once) and the board still works.
        const { assetId, inline } = await uploadDataUrlAsset(editor, {
          dataUrl: processedImageUrl,
          name: 'generated-solution.png',
          width: img.width,
          height: img.height,
          source: 'ai',
          signal,
        });
        if (inline) warnInlineAssetFallbackOnce();

        if (signal.aborted) {
          // The student kept drawing while the image uploaded: drop the orphaned asset
          // (the asset store removes the Storage object) and release the activity guard.
          editor.deleteAssets([assetId]);
          isUpdatingImageRef.current = false;
          return false;
        }

        const shapeId = createShapeId();
        const scale = Math.min(
          viewportBounds.width / img.width,
          viewportBounds.height / img.height
        );
        const shapeWidth = img.width * scale;
        const shapeHeight = img.height * scale;

        // In "feedback" mode, show at full opacity without accept/reject
        // In "suggest" and "answer" modes, show at reduced opacity with accept/reject
        const isFeedbackMode = mode === "feedback";

        // Render the overlay BELOW every Live shape (echoes, graphs, AI steps) so a
        // full-viewport annotation never hides them. Computed before creation because
        // reorder calls skip locked shapes.
        const overlayIndex = overlayIndexBelowLive(editor);

        // `meta.aiOverlay` marks the shape for useAiOverlayShapes: feedback overlays feed
        // "Clear feedback", suggest/answer overlays feed Accept/Reject (also after reload).
        editor.createShape({
          id: shapeId,
          type: "image",
          x: viewportBounds.x + (viewportBounds.width - shapeWidth) / 2,
          y: viewportBounds.y + (viewportBounds.height - shapeHeight) / 2,
          opacity: isFeedbackMode ? 1.0 : 0.3,
          isLocked: true,
          ...(overlayIndex ? { index: overlayIndex } : {}),
          meta: aiOverlayMeta(mode),
          props: {
            w: shapeWidth,
            h: shapeHeight,
            assetId: assetId,
          },
        });

        // If the canvas has worksheet/PDF/sticker protected shapes, push the
        // new annotation behind them so the worksheet always renders on top.
        if (hasProtectedShapes) {
          try {
            // sendToBack ignores locked shapes unless the lock is bypassed.
            editor.run(() => editor.sendToBack([shapeId]), { ignoreShapeLock: true });
          } catch (e) {
            // Non-fatal: z-ordering is best-effort.
            logger.warn({ error: e }, "Failed to send annotation to back");
          }
        }


        // Show success message briefly, then return to idle
        setStatus("success");
        setStatusMessage(getStatusMessage(mode, "success"));
        setTimeout(() => {
          setStatus("idle");
          setStatusMessage("");
        }, 2000);

        // Reset flag after a brief delay
        setTimeout(() => {
          isUpdatingImageRef.current = false;
        }, 100);

        return true;
      } catch (error) {
        // The guard is set right before the (awaited) asset upload; never leave it stuck on.
        isUpdatingImageRef.current = false;
        if (signal.aborted || isAbortError(error)) {
          setStatus("idle");
          setStatusMessage("");
          return false;
        }

        logger.error({ error }, 'Auto-generation error');
        // 401 / 429 / 402 are toasted (and 401 redirects) by the handler;
        // everything else is shown inline in the status indicator.
        setErrorMessage(handleApiError(error, { fallback: "Generation failed" }));
        setStatus("error");
        setStatusMessage("");
        
        // Clear error after 3 seconds
        setTimeout(() => {
          setStatus("idle");
          setErrorMessage("");
        }, 3000);

        return false;
      } finally {
        isProcessingRef.current = false;
        abortControllerRef.current = null;
      }
    },
    [editor, pendingImageIds, isVoiceSessionActive, assistanceMode, aiModel, aiPerf, getStatusMessage, handleApiError],
  );

  const handleAutoGeneration = useCallback(() => {
    // Don't burn credits while the tab is in the background; the next edit
    // after the user comes back will schedule a fresh run.
    if (typeof document !== "undefined" && document.visibilityState !== "visible") {
      return;
    }
    // While Live owns the latest ink burst (recognized or still pending), the image
    // pipeline stays quiet; it still runs for non-math ink and on "Draw help".
    if (liveEnabled && legacyShouldSkip(LIVE_TIMING.legacyIdleMs)) {
      return;
    }
    void generateSolution({ source: "auto" });
  }, [generateSolution, liveEnabled]);

  // Listen for user activity and trigger auto-generation after idle
  // (2 s today; 4 s while Live is on so echoes land first).
  useDebounceActivity(
    handleAutoGeneration,
    liveEnabled ? LIVE_TIMING.legacyIdleMs : 2000,
    editor,
    isUpdatingImageRef,
    isProcessingRef,
  );

  // Cancel in-flight requests when user edits the canvas
  useEffect(() => {
    if (!editor) return;

    const handleEditorChange = (entry: HistoryEntry<TLRecord>) => {
      // Ignore if we're just updating accepted/rejected images
      if (isUpdatingImageRef.current) {
        return;
      }
      // Live echo/graph writes and AI overlays are not student edits (B1).
      if (!isStudentActivity(entry)) {
        return;
      }

      // Only cancel if there's an active generation in progress
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
        abortControllerRef.current = null;
        setStatus("idle");
        setStatusMessage("");
        isProcessingRef.current = false;
      }
    };

    // Listen to editor changes (actual edits)
    const dispose = editor.store.listen(handleEditorChange, {
      source: 'user',
      scope: 'document'
    });

    return () => {
      dispose();
    };
  }, [editor]);

  const handleAccept = useCallback(
    (shapeId: TLShapeId) => {
      if (!editor) return;

      // Set flag to prevent triggering activity detection
      isUpdatingImageRef.current = true;

      const current = editor.getShape(shapeId);
      if (!current) return;

      // First unlock to ensure we can update opacity; `accepted` takes the overlay out of
      // the pending list (useAiOverlayShapes) and keeps it out after a reload.
      editor.updateShape({
        id: shapeId,
        type: "image",
        isLocked: false,
        opacity: 1,
        meta: { ...current.meta, accepted: true },
      });

      // Then immediately lock it again to make it non-selectable
      editor.updateShape({
        id: shapeId,
        type: "image",
        isLocked: true,
      });

      // Reset flag after a brief delay
      setTimeout(() => {
        isUpdatingImageRef.current = false;
      }, 100);
    },
    [editor]
  );

  const handleReject = useCallback(
    (shapeId: TLShapeId) => {
      if (!editor) return;

      // Set flag to prevent triggering activity detection
      isUpdatingImageRef.current = true;

      // Unlock the shape first, then delete it
      editor.updateShape({
        id: shapeId,
        type: "image",
        isLocked: false,
      });
      
      editor.deleteShape(shapeId);

      // Reset flag after a brief delay
      setTimeout(() => {
        isUpdatingImageRef.current = false;
      }, 100);
    },
    [editor]
  );

  const handleClearFeedback = useCallback(() => {
    if (!editor) return;

    // Only touch shapes that still exist (the user may have undone some).
    const ids = feedbackImageIds.filter((sid) => editor.getShape(sid));

    // Set flag to prevent triggering activity detection
    isUpdatingImageRef.current = true;

    if (ids.length > 0) {
      // Unlock first, then delete (locked shapes are not deletable).
      editor.updateShapes(
        ids.map((sid) => ({ id: sid, type: "image" as const, isLocked: false })),
      );
      editor.deleteShapes(ids);
    }

    // Reset flag after a brief delay
    setTimeout(() => {
      isUpdatingImageRef.current = false;
    }, 100);
  }, [editor, feedbackImageIds]);

  // Auto-save (2 s debounce, offline skip, size guard + Storage offload): src/hooks/useSnapshotSave.ts
  const { blockedMessage: saveBlockedMessage } = useSnapshotSave(editor, id, isUpdatingImageRef);

  return (
    <>
      <GenerationSkeleton visible={aiPerf.skeletonEnabled && status === "generating"} />

      {/* Tabs at top left */}
      {!isVoiceSessionActive && (
        <div
          style={{
            position: 'absolute',
            top: '16px',
            left: '16px',
            zIndex: 1000,
            display: 'flex',
            alignItems: 'center',
            gap: '12px',
            // Wrap on narrow screens (400 px) so the Live toggle/pill stay reachable;
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
              <TabsList>
                <TabsTrigger value="off">Off</TabsTrigger>
                <TabsTrigger value="feedback">Feedback</TabsTrigger>
                <TabsTrigger value="suggest">Suggest</TabsTrigger>
                <TabsTrigger value="answer">Solve</TabsTrigger>
              </TabsList>
            </Tabs>
            <ModeInfoDialog />
            <LiveToggle
              checked={live.enabled}
              disabled={LIVE_KILL_SWITCH}
              onCheckedChange={(v) => updateLive({ enabled: v })}
            />
            {liveEnabled && assistanceMode === "answer" && (
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
            {liveEnabled && (
              <LiveErrorBoundary>
                <LiveStatusPill
                  editor={editor}
                  onDrawHelp={() => void generateSolution({ force: true, source: "auto" })}
                  onClearMarks={() => controller.clearMarks()}
                />
              </LiveErrorBoundary>
            )}
            {saveBlockedMessage && (
              <span
                role="status"
                data-testid="save-blocked"
                title={saveBlockedMessage}
                className="inline-flex h-9 items-center rounded-md border border-red-200 bg-red-50 px-2.5 text-xs font-medium text-red-700 shadow-sm"
              >
                {saveBlockedMessage}
              </span>
            )}
            <ModelBadge
              model={aiModel}
              onClick={() => setAiModel((m) => (m === "gemini" ? "gpt" : "gemini"))}
            />
            <PerfSettingsPopover
              fastMode={aiPerf.fastMode}
              onFastModeChange={(v) => updateAiPerf({ fastMode: v })}
              downscaleEnabled={aiPerf.downscaleEnabled}
              onDownscaleEnabledChange={(v) => updateAiPerf({ downscaleEnabled: v })}
              downscaleMaxEdge={aiPerf.downscaleMaxEdge}
              onDownscaleMaxEdgeChange={(v) => updateAiPerf({ downscaleMaxEdge: v })}
              downscaleQuality={aiPerf.downscaleQuality}
              onDownscaleQualityChange={(v) => updateAiPerf({ downscaleQuality: v })}
              skeletonEnabled={aiPerf.skeletonEnabled}
              onSkeletonEnabledChange={(v) => updateAiPerf({ skeletonEnabled: v })}
            />
            {features.stickers && <StickerLibrary />}
            {features.worksheetGen && <WorksheetGenerator model={aiModel} />}
            {features.pdfUpload && <PdfUpload />}
            {/* Report lives in the bar (after the Live pill) so it never overlaps
                tldraw's style panel at the top-right. */}
            <BugReportButton boardId={id} />
          </div>
        </div>
      )}

      {/* When a voice session is active, let the voice banner own the top-center space. */}
      {!isVoiceSessionActive && (
        <StatusIndicator
          status={status}
          errorMessage={errorMessage}
          customMessage={statusMessage}
        />
      )}
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
      {!isVoiceSessionActive && liveEnabled && (
        <LiveErrorBoundary>
          <LiveHintLayer editor={editor} controller={controller} />
        </LiveErrorBoundary>
      )}
      <ImageActionButtons
        pendingImageIds={pendingImageIds}
        isVoiceSessionActive={isVoiceSessionActive}
        onAccept={handleAccept}
        onReject={handleReject}
      />
      <ClearFeedbackButton
        feedbackImageIds={feedbackImageIds}
        isVoiceSessionActive={isVoiceSessionActive}
        hasPendingImages={pendingImageIds.length > 0}
        onClear={handleClearFeedback}
      />
      <VoiceAgentControls
        onSessionChange={setIsVoiceSessionActive}
        onSolveWithPrompt={async (mode, instructions) => {
          const success = await generateSolution({
            modeOverride: mode,
            promptOverride: instructions,
            force: true,
            source: "voice",
          });
          return success;
        }}
      />
    </>
  );
}

export default function BoardPage() {
  const params = useParams();
  const router = useRouter();
  const id = params.id as string;
  const { user, loading: authLoading } = useAuth();
  const [loading, setLoading] = useState(true);
  const [initialData, setInitialData] = useState<
    Partial<TLEditorSnapshot> | TLStoreSnapshot | null
  >(null);
  // tldraw's own paste/drop/upload of images goes to Storage ('<uid>/<boardId>/<assetId>.<ext>')
  // instead of being embedded as a data URL in the snapshot.
  // `getAsset` lets the store derive object paths for assets restored from the snapshot
  // (not uploaded this session) so `editor.deleteAssets` also removes the Storage object.
  const editorRef = useRef<Editor | null>(null);
  const userId = user?.id;
  const assetStore = useMemo(
    () =>
      userId
        ? createBoardAssetStore({
            supabase,
            userId,
            boardId: id,
            getAsset: (assetId) => editorRef.current?.getAsset(assetId),
          })
        : undefined,
    [userId, id],
  );

  useEffect(() => {
    if (!authLoading && !user) {
      router.replace("/login");
    }
  }, [user, authLoading, router]);

  useEffect(() => {
    if (!user) return;
    async function loadBoard() {
      try {
        const { data, error } = await supabase
          .from('whiteboards')
          .select('data')
          .eq('id', id)
          .single();

        if (error) throw error;

        if (data) {
          if (data.data && Object.keys(data.data).length > 0) {
            // `data` is a jsonb column holding a tldraw snapshot.
            setInitialData(data.data as Partial<TLEditorSnapshot> | TLStoreSnapshot);
          }
        }
      } catch (e) {
        console.error("Error loading board:", e);
        toast.error("Failed to load board");
      } finally {
        setLoading(false);
      }
    }
    loadBoard();
  }, [id, user]);

  if (authLoading || !user || loading) {
    return (
      <div className="flex h-screen items-center justify-center bg-gray-50">
        <div className="flex flex-col items-center gap-4">
          <Loader2 className="w-8 h-8 animate-spin text-blue-600" />
          <p className="text-gray-500 font-medium animate-pulse">Loading your canvas...</p>
        </div>
      </div>
    );
  }

  return (
    <div style={{ position: "fixed", inset: 0 }}>
      <Tldraw
        shapeUtils={liveShapeUtils}
        tools={liveTools}
        overrides={boardOverrides}
        licenseKey={process.env.NEXT_PUBLIC_TLDRAW_LICENSE_KEY}
        assets={assetStore}
        components={{
          MenuPanel: null,
          NavigationPanel: null,
          HelperButtons: null,
          Toolbar: LiveToolbar,
        }}
        onMount={(editor) => {
          editorRef.current = editor;
          if (initialData) {
            try {
              loadSnapshot(editor.store, initialData);
            } catch (e) {
              console.error("Failed to load snapshot:", e);
              toast.error("Failed to restore canvas state");
            }
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
              }
            })
            .catch((e) => {
              logger.warn({ id, error: e instanceof Error ? e.message : String(e) }, "On-load asset offload failed");
              toast.warning(ASSET_COPY.offloadPartial);
            });
          if (process.env.NODE_ENV !== "production") {
            // Dev-only handle for recording fixtures / poking the store from devtools.
            (window as unknown as { __agathonEditor?: Editor }).__agathonEditor = editor;
          }
        }}
      >
        <BoardContent id={id} />
      </Tldraw>
    </div>
  );
}
