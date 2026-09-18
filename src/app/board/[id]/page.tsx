"use client";

import {
  Tldraw,
  useEditor,
  createShapeId,
  TLShapeId,
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
} from "@/components/ui/dialog";
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
import { aiOverlayMeta, dropPendingAiOverlays, overlayIndexBelowLive, useAiOverlayShapes } from "@/hooks/useAiOverlayShapes";
import { useAssistanceMode, type AssistanceMode } from "@/hooks/useAssistanceMode";
import { offloadAssetsOnce, useSnapshotSave, warnInlineAssetFallbackOnce } from "@/hooks/useSnapshotSave";
import { createBoardAssetStore } from "@/lib/assets/boardAssetStore";
import { uploadDataUrlAsset } from "@/lib/assets/uploadDataUrl";
import {
  GENERATION_COPY,
  INFO_CLEAR_MS,
  StatusIndicator,
  SUCCESS_CLEAR_MS,
  type GenerationState,
} from "@/components/StatusIndicator";
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
import { describeApiError, isAbortError, useApiErrorHandler } from "@/hooks/useApiErrorHandler";
import { useParams, useRouter } from "next/navigation";
import { Volume2, VolumeX } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/components/AuthProvider";
import { CreditsBanner } from "@/components/CreditsBanner";
import { StickerLibrary } from "@/components/StickerLibrary";
import { WorksheetGenerator } from "@/components/WorksheetGenerator";
import { PdfUpload } from "@/components/PdfUpload";
import { BugReportButton } from "@/components/BugReportButton";
import { useFeatureLabs } from "@/lib/featureLabs";
import { ListOrdered } from "lucide-react";
import { GenerationSkeleton } from "@/components/GenerationSkeleton";
import { liveShapeUtils, liveTools, liveUiOverrides, LiveToolbar } from "@/shapes";
import { isLiveMeta, LIVE_KILL_SWITCH, LIVE_TIMING } from "@/lib/live/contracts";
import { legacyShouldSkip } from "@/lib/live/liveStore";
import { useLiveMath } from "@/lib/live/useLiveMath";
import { useLiveSettings } from "@/lib/live/liveSettings";
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
 * The one image model the legacy overlay pipeline uses. The board used to carry a
 * "Nano Banana Pro" / "GPT-5.4 Image 2" badge that flipped this on a single click, plus a
 * "Speed" popover of fast-mode / downscale / skeleton knobs. Both were developer controls
 * in a student's way; the defaults they shipped with are now simply the behaviour.
 */
const IMAGE_MODEL = "gemini";

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
              Full worked solution overlaid on your canvas for comparison.
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

type LegacyMode = "feedback" | "suggest" | "answer";
type GenerationRequest = { mode: LegacyMode; promptOverride?: string; source: "auto" | "voice" };

function BoardContent({ id, initialVersion }: { id: string; initialVersion: number | null }) {
  const editor = useEditor();
  const router = useRouter();
  const { features } = useFeatureLabs();
  // Legacy AI overlays are found by `meta.aiOverlay` in the store (not React state) so
  // Accept/Reject and "Clear feedback" come back after a reload. `pending` = suggest/answer
  // overlays awaiting Accept/Reject; `feedback` = locked full-opacity feedback overlays.
  const { pending: pendingImageIds, feedback: feedbackImageIds } = useAiOverlayShapes(editor);
  // Legacy pipeline status pill: loading/confirmations fade on their own, failures stay
  // until Retry/Dismiss (see generationStatusView in StatusIndicator.tsx).
  const [generation, setGeneration] = useState<GenerationState>({ kind: "idle" });
  const clearTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // The last request's shape so Retry re-runs the same mode/prompt.
  const lastRequestRef = useRef<GenerationRequest | null>(null);
  const showGeneration = useCallback((next: GenerationState, clearAfterMs?: number) => {
    if (clearTimerRef.current) {
      clearTimeout(clearTimerRef.current);
      clearTimerRef.current = null;
    }
    setGeneration(next);
    if (clearAfterMs) {
      clearTimerRef.current = setTimeout(() => {
        clearTimerRef.current = null;
        setGeneration({ kind: "idle" });
      }, clearAfterMs);
    }
  }, []);
  useEffect(
    () => () => {
      if (clearTimerRef.current) clearTimeout(clearTimerRef.current);
    },
    [],
  );
  const [isVoiceSessionActive, setIsVoiceSessionActive] = useState(false);
  // Help mode is remembered per board on this device (default Feedback).
  const [assistanceMode, setAssistanceMode] = useAssistanceMode(id);
  // The (i) explainer and the bug report both used to be buttons in the bar; they open from
  // Board options now, so the page owns their open state.
  const [modeInfoOpen, setModeInfoOpen] = useState(false);
  const [reportOpen, setReportOpen] = useState(false);
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

      // Never start a model call while offline; only say so when the student asked
      // explicitly (Draw help / voice) — the idle trigger stays quiet.
      if (typeof navigator !== "undefined" && navigator.onLine === false) {
        if (options?.force) showGeneration({ kind: "offline" });
        return false;
      }

      // Check if canvas has content
      const shapeIds = editor.getCurrentPageShapeIds();
      if (shapeIds.size === 0) {
        return false;
      }

      lastRequestRef.current = {
        mode,
        promptOverride: options?.promptOverride,
        source: options?.source ?? "auto",
      };
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

        const base64 = await new Promise<string>((resolve) => {
          const reader = new FileReader();
          reader.onloadend = () => resolve(reader.result as string);
          reader.readAsDataURL(blob);
        });
        logger.info(
          {
            originalBytes: blob.size,
            captureMs: Math.round(performance.now() - captureStart),
          },
          "Canvas captured",
        );

        // If the canvas image hasn't changed since the last successful check,
        // don't run the expensive OCR / help-check / generation pipeline again.
        if (!options?.force && lastCanvasImageRef.current === base64) {
          isProcessingRef.current = false;
          return false;
        }
        lastCanvasImageRef.current = base64;

        if (signal.aborted) return false;

        // Step 2: Generate solution (Gemini decides if help is needed)
        showGeneration({ kind: "generating", label: getStatusMessage(mode, "generating") });

        const body: Record<string, unknown> = {
          image: base64,
          mode,
          model: IMAGE_MODEL,
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
        // Say so briefly (the pill leaves "generating", which also hides the skeleton) so
        // the wait never ends in silence.
        if (!imageUrl || signal.aborted) {
          logger.info({ textContent }, 'Gemini decided help is not needed');
          if (signal.aborted) {
            showGeneration({ kind: "idle" });
          } else {
            showGeneration({ kind: "info", label: GENERATION_COPY.nothingToAdd }, INFO_CLEAR_MS);
          }
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
        showGeneration({ kind: "success", label: getStatusMessage(mode, "success") }, SUCCESS_CLEAR_MS);

        // Reset flag after a brief delay
        setTimeout(() => {
          isUpdatingImageRef.current = false;
        }, 100);

        return true;
      } catch (error) {
        // The guard is set right before the (awaited) asset upload; never leave it stuck on.
        isUpdatingImageRef.current = false;
        if (signal.aborted || isAbortError(error)) {
          // The student kept drawing: not an error, the next idle run picks it up.
          showGeneration({ kind: "idle" });
          return false;
        }

        logger.error({ error }, 'Auto-generation error');
        // The pill keeps the failure until Retry/Dismiss: 402 has no Retry, 429 carries the
        // server's wait hint, 401 sends the student back to sign in.
        const described = describeApiError(error, { fallback: GENERATION_COPY.failed });
        showGeneration({
          kind: "error",
          message: described.message,
          retryable: described.retryable,
          retryAfterMs: described.retryAfterMs,
          signIn: described.signIn,
        });
        if (described.signIn) router.replace("/login");

        return false;
      } finally {
        isProcessingRef.current = false;
        abortControllerRef.current = null;
      }
    },
    [editor, pendingImageIds, isVoiceSessionActive, assistanceMode, getStatusMessage, showGeneration, router],
  );

  const retryGeneration = useCallback(() => {
    const last = lastRequestRef.current;
    void generateSolution({
      force: true,
      source: "auto",
      modeOverride: last?.mode,
      promptOverride: last?.promptOverride,
    });
  }, [generateSolution]);

  const dismissGeneration = useCallback(() => showGeneration({ kind: "idle" }), [showGeneration]);

  const handleAutoGeneration = useCallback(() => {
    // Don't burn credits while the tab is in the background; the next edit
    // after the user comes back will schedule a fresh run.
    if (typeof document !== "undefined" && document.visibilityState !== "visible") {
      return;
    }
    // While Live owns the latest ink burst (recognized, still pending, or failed to read
    // because the recognizer is down), the image pipeline stays quiet so an outage never
    // turns into paid image generations; it still runs for non-math ink ('unhandled') and
    // on "Draw help", which calls generateSolution({ force: true }) and skips this gate.
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
        showGeneration({ kind: "idle" });
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
  }, [editor, showGeneration]);

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

  // Auto-save through the SaveQueue (2 s debounce, offline backup + replay, optimistic
  // concurrency on `version`, size guard + Storage offload): src/hooks/useSnapshotSave.ts
  const { sync, retry: retrySave } = useSnapshotSave(editor, id, isUpdatingImageRef, initialVersion);

  // One place decides what the bar shows (see src/components/live/toolbar.ts).
  const toolbar = boardToolbarView({
    mode: assistanceMode,
    liveEnabled: live.enabled,
    liveAvailable: !LIVE_KILL_SWITCH,
    voiceActive: isVoiceSessionActive,
  });

  return (
    <>
      <GenerationSkeleton visible={generation.kind === "generating"} />

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
                  onDrawHelp={() => void generateSolution({ force: true, source: "auto" })}
                  onClearMarks={() => controller.clearMarks()}
                  onShowModeInfo={() => setModeInfoOpen(true)}
                  onReportProblem={() => setReportOpen(true)}
                />
              </LiveErrorBoundary>
            )}
            <SaveStatus sync={sync} onRetry={() => void retrySave()} />
            {features.stickers && <StickerLibrary />}
            {features.worksheetGen && <WorksheetGenerator model={IMAGE_MODEL} />}
            {features.pdfUpload && <PdfUpload />}
          </div>
        </div>
      )}

      {/* Opened from Board options; neither owns a button in the bar any more. */}
      <ModeInfoDialog open={modeInfoOpen} onOpenChange={setModeInfoOpen} />
      <BugReportButton boardId={id} open={reportOpen} onOpenChange={setReportOpen} />

      {/* When a voice session is active, let the voice banner own the top-center space. */}
      {!isVoiceSessionActive && (
        <StatusIndicator
          state={generation}
          onRetry={retryGeneration}
          onDismiss={dismissGeneration}
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
      {toolbar.showHintLayer && (
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
          NavigationPanel: null,
          HelperButtons: null,
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
