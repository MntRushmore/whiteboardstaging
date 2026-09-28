import { isApiError } from "@/lib/api-client";
import type { ListenTokenResponse, SpeechCallbacks, SpeechSource, SpeechState } from "../contracts";
import { isTransientSpeechFailure, micErrorCode, SpeechError, speechErrorCodeFor, type SpeechErrorCode } from "./errors";
import { bytesToBase64, parseScribeMessage, PCM_WORKLET_NAME, PCM_WORKLET_SOURCE, pcm16leBytes, SCRIBE, scribeAudioMessage } from "./scribe";

/**
 * The microphone through ElevenLabs Scribe v2 Realtime (protocol: `scribe.ts`). The browser
 * streams 16 kHz PCM straight to ElevenLabs over a websocket opened with a single-use token from
 * our token route, so neither the audio nor our key passes through the server; only the words come
 * back to the board.
 *
 * A session ends (the recognizer's time limit, a dropped connection, a token that lived its 15
 * minutes): the source opens the next one with a fresh token, backing off while it fails
 * ("reconnecting"), keeps up to `BACKLOG_MS` of audio meanwhile so no words fall in the gap, and
 * gives the new session the last words heard as context (`previous_text`). What was being heard
 * when a session ends is kept as a final, not lost.
 *
 * Pausing lets go of the microphone (the browser's recording light goes out) and closes the
 * session; resuming opens both again. The browser parts (`openMicrophone`, `openScribeSocket`) are
 * injected, so everything else runs in node against fakes.
 */

/** What the source needs from a websocket (the browser's `WebSocket` fits). */
export interface ScribeSocket {
  readonly readyState: number;
  send(data: string): void;
  close(code?: number, reason?: string): void;
  onopen: ((ev: unknown) => void) | null;
  onmessage: ((ev: { data: unknown }) => void) | null;
  onclose: ((ev: { code: number; reason: string }) => void) | null;
  onerror: ((ev: unknown) => void) | null;
}

/** The microphone as 16 kHz 16-bit PCM chunks (`SCRIBE.chunkMs` each). */
export interface MicCapture {
  onChunk: ((pcm: Int16Array) => void) | null;
  stop(): void;
}

type Timer = ReturnType<typeof setTimeout>;

export interface ElevenLabsSourceDeps {
  /** a fresh single-use token (the token route; 1 credit each) */
  requestToken(): Promise<ListenTokenResponse>;
  /** the first session's token, when the caller already has it (`createSpeechSource`) */
  firstToken?: ListenTokenResponse;
  openSocket?(url: string): ScribeSocket;
  openMic?(): Promise<MicCapture>;
  now?(): number;
  setTimeout?(fn: () => void, ms: number): Timer;
  clearTimeout?(t: Timer): void;
}

const OPEN = 1;

/** audio kept while a new session is being opened (older audio is dropped) */
export const BACKLOG_MS = 4_000;
/** how long a socket may take to open before the attempt counts as failed */
export const CONNECT_TIMEOUT_MS = 10_000;
/** reconnect delays: immediately, then doubling from half a second up to 15 s */
export function reconnectDelayMs(attempt: number): number {
  return attempt <= 1 ? 0 : Math.min(15_000, 500 * 2 ** (attempt - 2));
}
/** consecutive failed attempts before the source gives up */
export const MAX_RECONNECT_ATTEMPTS = 8;
/** a session that stayed open this long was a success (the attempt count starts again) */
export const HEALTHY_SESSION_MS = 30_000;

export class ElevenLabsSource implements SpeechSource {
  readonly kind = "elevenlabs" as const;

  private cb: SpeechCallbacks | null = null;
  private socket: ScribeSocket | null = null;
  private mic: MicCapture | null = null;
  private state: SpeechState = "idle";
  private startedAt = 0;
  private partial = "";
  /** the last words committed, for the next session's `previous_text` */
  private heard = "";
  /** the next chunk sent opens a new session: it carries `previous_text` */
  private firstChunk = true;
  private backlog: Int16Array[] = [];
  private attempts = 0;
  private timer: Timer | null = null;
  private connectTimer: Timer | null = null;
  private pendingToken: ListenTokenResponse | null;
  /** bumps whenever a session is abandoned, so a late callback from it does nothing */
  private generation = 0;
  /** when the current session's socket opened */
  private openedAt: number | null = null;

  private readonly now: () => number;
  private readonly setTimer: (fn: () => void, ms: number) => Timer;
  private readonly clearTimer: (t: Timer) => void;
  private readonly openSocket: (url: string) => ScribeSocket;
  private readonly openMic: () => Promise<MicCapture>;

  constructor(private readonly deps: ElevenLabsSourceDeps) {
    this.pendingToken = deps.firstToken ?? null;
    this.now = deps.now ?? (() => Date.now());
    this.setTimer = deps.setTimeout ?? ((fn, ms) => setTimeout(fn, ms));
    this.clearTimer = deps.clearTimeout ?? ((t) => clearTimeout(t));
    this.openSocket = deps.openSocket ?? openScribeSocket;
    this.openMic = deps.openMic ?? openMicrophone;
  }

  async start(cb: SpeechCallbacks): Promise<void> {
    this.cb = cb;
    this.startedAt = this.now();
    this.setState("connecting");
    try {
      await this.openMicrophone();
      await this.connect();
    } catch (err) {
      this.teardown();
      this.setState("error", speechErrorCodeFor(err));
      throw err instanceof SpeechError ? err : new SpeechError(speechErrorCodeFor(err), err instanceof Error ? err.message : String(err));
    }
  }

  pause(): void {
    if (this.state === "idle" || this.state === "paused" || this.state === "error") return;
    this.flushPartial();
    this.teardown();
    this.setState("paused");
  }

  resume(): void {
    if (this.state !== "paused") return;
    this.setState("connecting");
    void (async () => {
      try {
        await this.openMicrophone();
        await this.connect();
      } catch (err) {
        if (this.state === "idle" || this.state === "paused") return;
        this.teardown();
        this.setState("error", speechErrorCodeFor(err));
      }
    })();
  }

  stop(): void {
    if (this.state === "idle" && !this.cb) return;
    this.flushPartial();
    this.teardown();
    this.backlog = [];
    this.setState("idle");
    this.cb = null;
  }

  // ---------------------------------------------------------------- sessions

  private async openMicrophone(): Promise<void> {
    if (this.mic) return;
    const mic = await this.openMic();
    if (this.state === "idle" || this.state === "paused") {
      mic.stop(); // stopped or paused while the permission prompt was up
      throw new SpeechError("mic-missing", "stopped while opening the microphone");
    }
    this.mic = mic;
    mic.onChunk = (pcm) => this.onAudio(pcm);
  }

  /** Opens a session with a token (the one in hand, else a fresh one); resolves when the socket is open. */
  private async connect(): Promise<void> {
    const gen = ++this.generation;
    let token = this.pendingToken;
    this.pendingToken = null;
    if (!token || token.expiresAt <= this.now()) token = await this.deps.requestToken();
    if (gen !== this.generation) return;
    await new Promise<void>((resolve, reject) => {
      let opened = false;
      const socket = this.openSocket(token.url);
      this.socket = socket;
      this.firstChunk = true;
      this.connectTimer = this.setTimer(() => {
        if (gen !== this.generation) return;
        this.generation++;
        this.closeSocket();
        reject(new SpeechError("network", "the recognizer did not answer"));
      }, CONNECT_TIMEOUT_MS);
      socket.onopen = () => {
        if (gen !== this.generation) return;
        opened = true;
        this.openedAt = this.now();
        this.clearConnectTimer();
        this.setState("listening");
        this.drainBacklog();
        resolve();
      };
      socket.onmessage = (ev) => {
        if (gen === this.generation) this.onMessage(ev.data);
      };
      socket.onerror = () => {
        /* a close always follows; it decides */
      };
      socket.onclose = () => {
        if (gen !== this.generation) return;
        this.clearConnectTimer();
        this.socket = null;
        if (!opened) {
          this.generation++;
          reject(new SpeechError("network", "the recognizer closed the connection"));
          return;
        }
        this.sessionEnded();
      };
    });
  }

  private onMessage(data: unknown): void {
    const ev = parseScribeMessage(data);
    switch (ev.kind) {
      case "partial":
        if (ev.text !== this.partial) {
          this.partial = ev.text;
          this.cb?.onPartial(ev.text);
        }
        return;
      case "committed":
        this.partial = "";
        this.emitFinal(ev.text);
        return;
      case "error":
        if (ev.fatal) {
          this.fail("recognizer");
          return;
        }
        // a time limit or a hiccup: this session is over, the next one starts
        this.sessionEnded();
        return;
      default:
        return;
    }
  }

  /** The session is over (closed, or it said so): keep what was being heard, open the next. */
  private sessionEnded(): void {
    if (this.state === "idle" || this.state === "paused" || this.state === "error") return;
    this.flushPartial();
    this.generation++;
    this.closeSocket();
    // A session that lasted is a success: the count starts again. One that ends as soon as it
    // opens keeps counting, so a recognizer that refuses every session cannot spend a token a
    // second (each is a credit) — it backs off and gives up.
    if (this.openedAt !== null && this.now() - this.openedAt >= HEALTHY_SESSION_MS) this.attempts = 0;
    this.openedAt = null;
    this.scheduleReconnect();
  }

  private scheduleReconnect(retryAfterMs = 0): void {
    this.attempts++;
    if (this.attempts > MAX_RECONNECT_ATTEMPTS) {
      this.fail("network");
      return;
    }
    this.setState("reconnecting");
    const delay = Math.max(retryAfterMs, reconnectDelayMs(this.attempts));
    this.clearRetryTimer();
    this.timer = this.setTimer(() => {
      this.timer = null;
      void this.reconnect();
    }, delay);
  }

  private async reconnect(): Promise<void> {
    if (this.state !== "reconnecting") return;
    try {
      await this.connect();
    } catch (err) {
      if (this.state !== "reconnecting") return;
      if (!isTransientSpeechFailure(err)) {
        this.fail(isApiError(err, "listen_not_configured") ? "recognizer" : speechErrorCodeFor(err));
        return;
      }
      this.scheduleReconnect(isApiError(err) ? (err.retryAfterMs ?? 0) : 0);
    }
  }

  private fail(code: SpeechErrorCode): void {
    this.flushPartial();
    this.teardown();
    this.setState("error", code);
  }

  // ---------------------------------------------------------------- audio

  private onAudio(pcm: Int16Array): void {
    if (this.state === "listening" && this.socket?.readyState === OPEN) {
      this.send(pcm);
      return;
    }
    if (this.state === "connecting" || this.state === "reconnecting") {
      this.backlog.push(pcm);
      const keep = Math.max(1, Math.floor(BACKLOG_MS / SCRIBE.chunkMs));
      if (this.backlog.length > keep) this.backlog.splice(0, this.backlog.length - keep);
    }
  }

  private drainBacklog(): void {
    const chunks = this.backlog;
    this.backlog = [];
    for (const c of chunks) this.send(c);
  }

  private send(pcm: Int16Array): void {
    const socket = this.socket;
    if (!socket || socket.readyState !== OPEN) return;
    const previousText = this.firstChunk ? this.heard : undefined;
    this.firstChunk = false;
    try {
      socket.send(scribeAudioMessage(bytesToBase64(pcm16leBytes(pcm)), { previousText }));
    } catch {
      /* a socket closing under us: its close event reconnects */
    }
  }

  // ---------------------------------------------------------------- helpers

  private emitFinal(text: string): void {
    const t = text.replace(/\s+/g, " ").trim();
    if (!t) return;
    this.heard = `${this.heard} ${t}`.slice(-SCRIBE.previousTextChars * 4);
    this.cb?.onFinal({ text: t, atMs: Math.max(0, this.now() - this.startedAt) });
  }

  /** What was being heard becomes a final (a session ending mid-sentence, a pause, a stop). */
  private flushPartial(): void {
    const p = this.partial;
    this.partial = "";
    if (p.trim()) this.emitFinal(p);
  }

  private teardown(): void {
    this.generation++;
    this.clearRetryTimer();
    this.clearConnectTimer();
    this.closeSocket();
    if (this.mic) {
      this.mic.onChunk = null;
      this.mic.stop();
      this.mic = null;
    }
  }

  private closeSocket(): void {
    const s = this.socket;
    this.socket = null;
    if (!s) return;
    s.onopen = s.onmessage = s.onerror = s.onclose = null;
    try {
      s.close(1000, "done");
    } catch {
      /* already closed */
    }
  }

  private clearRetryTimer(): void {
    if (this.timer !== null) this.clearTimer(this.timer);
    this.timer = null;
  }

  private clearConnectTimer(): void {
    if (this.connectTimer !== null) this.clearTimer(this.connectTimer);
    this.connectTimer = null;
  }

  private setState(state: SpeechState, detail?: string): void {
    if (this.state === state && !detail) return;
    this.state = state;
    this.cb?.onState(state, detail);
  }
}

export function createElevenLabsSource(deps: ElevenLabsSourceDeps): SpeechSource {
  return new ElevenLabsSource(deps);
}

// ------------------------------------------------------------------ the browser parts

/** `new WebSocket(url)`; the browser's socket already has the shape the source needs. */
export function openScribeSocket(url: string): ScribeSocket {
  return new WebSocket(url) as unknown as ScribeSocket;
}

/** True when this browser can capture the microphone as PCM and stream it (the realtime path). */
export function canStreamMicrophone(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof navigator !== "undefined" &&
    Boolean(navigator.mediaDevices?.getUserMedia) &&
    typeof AudioContext !== "undefined" &&
    typeof AudioWorkletNode !== "undefined" &&
    typeof WebSocket !== "undefined"
  );
}

/**
 * The microphone, cleaned up by the browser (echo cancellation, noise suppression, automatic gain:
 * a laptop at the back of a lecture hall), downsampled to 16 kHz PCM by an AudioWorklet
 * (`PCM_WORKLET_SOURCE`, loaded from a Blob URL) and handed over one chunk at a time.
 */
export async function openMicrophone(): Promise<MicCapture> {
  if (!canStreamMicrophone()) throw new SpeechError("unsupported");
  let stream: MediaStream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 },
    });
  } catch (err) {
    throw new SpeechError(micErrorCode(err), err instanceof Error ? err.message : "microphone");
  }
  const ctx = new AudioContext();
  const stopStream = () => stream.getTracks().forEach((t) => t.stop());
  try {
    const url = URL.createObjectURL(new Blob([PCM_WORKLET_SOURCE], { type: "application/javascript" }));
    try {
      await ctx.audioWorklet.addModule(url);
    } finally {
      URL.revokeObjectURL(url);
    }
    const input = ctx.createMediaStreamSource(stream);
    const node = new AudioWorkletNode(ctx, PCM_WORKLET_NAME, { numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [1] });
    const capture: MicCapture = {
      onChunk: null,
      stop() {
        node.port.onmessage = null;
        try {
          input.disconnect();
          node.disconnect();
        } catch {
          /* already disconnected */
        }
        stopStream();
        void ctx.close().catch(() => undefined);
      },
    };
    node.port.onmessage = (ev: MessageEvent) => {
      if (ev.data instanceof Int16Array) capture.onChunk?.(ev.data);
    };
    input.connect(node);
    // the node writes nothing to its output (silence); connecting it keeps the graph pulling it
    node.connect(ctx.destination);
    if (ctx.state === "suspended") await ctx.resume().catch(() => undefined);
    return capture;
  } catch (err) {
    stopStream();
    void ctx.close().catch(() => undefined);
    throw err instanceof SpeechError ? err : new SpeechError("unsupported", err instanceof Error ? err.message : "audio");
  }
}
