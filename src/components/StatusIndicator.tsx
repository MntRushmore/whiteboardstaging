import { Loading03Icon } from "hugeicons-react";

/**
 * Top-center pill for the legacy image pipeline (`generateSolution` in the board page).
 * Loading and short confirmations fade on their own; failures stay until the student
 * retries or dismisses them, so nothing in the recognition/solve path fails silently.
 */

export type GenerationTone = "neutral" | "info" | "amber" | "red";

export type GenerationState =
  | { kind: "idle" }
  | { kind: "generating"; label?: string }
  | { kind: "success"; label?: string }
  /** short informational note, e.g. the model had nothing to add (auto-clears) */
  | { kind: "info"; label: string }
  /** the student asked for help while the device is offline */
  | { kind: "offline" }
  | {
      kind: "error";
      message: string;
      retryable: boolean;
      retryAfterMs?: number;
      /** 401: the session is gone; Retry cannot help */
      signIn?: boolean;
    };

/** Kept for call-site compatibility: the discriminant of `GenerationState`. */
export type StatusIndicatorState = GenerationState["kind"];

export const GENERATION_COPY = {
  generating: "Working on your canvas…",
  success: "Added to your canvas",
  nothingToAdd: "Nothing to add yet",
  offline: "You're offline — help resumes when you're back online",
  failed: "Couldn't finish this one",
  retry: "Retry",
  dismiss: "Dismiss",
  retryIn: (seconds: number) => `Try again in ${seconds} second${seconds === 1 ? "" : "s"}`,
} as const;

/** How long a confirmation ("Added…") stays before the pill disappears. */
export const SUCCESS_CLEAR_MS = 2000;
/** How long an informational note ("Nothing to add yet") stays. */
export const INFO_CLEAR_MS = 2500;

export interface GenerationStatusView {
  label: string;
  tone: GenerationTone;
  spinner: boolean;
  showRetry: boolean;
  showDismiss: boolean;
}

/**
 * Pure mapping: generation state -> what the pill shows, or null for "show nothing".
 * Errors always carry Dismiss; Retry appears only when a re-run can help (never on 401 or
 * on credits). A 429 message that does not already say how long to wait gets the hint.
 */
export function generationStatusView(state: GenerationState): GenerationStatusView | null {
  switch (state.kind) {
    case "idle":
      return null;
    case "generating":
      return {
        label: state.label || GENERATION_COPY.generating,
        tone: "neutral",
        spinner: true,
        showRetry: false,
        showDismiss: false,
      };
    case "success":
      return {
        label: state.label || GENERATION_COPY.success,
        tone: "neutral",
        spinner: false,
        showRetry: false,
        showDismiss: false,
      };
    case "info":
      return { label: state.label, tone: "info", spinner: false, showRetry: false, showDismiss: false };
    case "offline":
      return {
        label: GENERATION_COPY.offline,
        tone: "amber",
        spinner: false,
        showRetry: true,
        showDismiss: true,
      };
    case "error": {
      let label = state.message || GENERATION_COPY.failed;
      if (state.retryAfterMs && !/second/i.test(label)) {
        const seconds = Math.max(1, Math.ceil(state.retryAfterMs / 1000));
        label = `${label.replace(/[.\s]+$/, "")}. ${GENERATION_COPY.retryIn(seconds)}`;
      }
      return {
        label,
        tone: "red",
        spinner: false,
        showRetry: state.retryable && !state.signIn,
        showDismiss: true,
      };
    }
    default:
      return null;
  }
}

const TONE_CLASS: Record<GenerationTone, string> = {
  neutral: "border-gray-200 bg-white text-gray-700",
  info: "border-blue-200 bg-blue-50 text-blue-700",
  amber: "border-amber-200 bg-amber-50 text-amber-800",
  red: "border-red-200 bg-red-50 text-red-700",
};

const BUTTON_CLASS: Record<GenerationTone, string> = {
  neutral: "text-gray-700",
  info: "text-blue-700",
  amber: "text-amber-800",
  red: "text-red-700",
};

interface StatusIndicatorProps {
  state: GenerationState;
  onRetry?: () => void;
  onDismiss?: () => void;
}

export function StatusIndicator({ state, onRetry, onDismiss }: StatusIndicatorProps) {
  const view = generationStatusView(state);
  if (!view) return null;

  const alert = state.kind === "error" || state.kind === "offline";

  return (
    <div
      role={alert ? "alert" : "status"}
      aria-live={alert ? "assertive" : "polite"}
      data-testid="generation-status"
      data-kind={state.kind}
      className={`flex items-center gap-2 px-4 py-2 border rounded-lg shadow-sm animate-in fade-in slide-in-from-top-2 duration-300 ${TONE_CLASS[view.tone]}`}
      style={{
        position: "absolute",
        // Default top-center position for canvas status; voice UI can choose
        // to hide this component when a voice session is active.
        top: "10px",
        left: "50%",
        transform: "translateX(-50%)",
        zIndex: 1000,
        maxWidth: "min(92vw, 560px)",
      }}
    >
      {view.spinner && (
        <Loading03Icon size={16} strokeWidth={2} className="animate-spin text-blue-600" />
      )}
      <span className="text-sm font-medium">{view.label}</span>
      {view.showRetry && onRetry && (
        <button
          type="button"
          onClick={onRetry}
          className={`rounded bg-white/70 px-2 py-0.5 text-xs font-semibold hover:bg-white ${BUTTON_CLASS[view.tone]}`}
        >
          {GENERATION_COPY.retry}
        </button>
      )}
      {view.showDismiss && onDismiss && (
        <button
          type="button"
          onClick={onDismiss}
          className={`rounded px-2 py-0.5 text-xs font-medium opacity-80 hover:opacity-100 ${BUTTON_CLASS[view.tone]}`}
        >
          {GENERATION_COPY.dismiss}
        </button>
      )}
    </div>
  );
}
