"use client";

import { apiJson, isApiError } from "@/lib/api-client";
import {
  CapabilitiesResponseSchema,
  LIVE_LIMITS,
  LIVE_TIMING,
  RecognizeResponseSchema,
  type CapabilitiesResponse,
  type RecognizeRequest,
  type RecognizeResponse,
} from "./contracts";

/**
 * Recognition client (spec §6.1/§6.7): content-hash cache (500 entries, LRU),
 * 2 concurrent requests, one AbortController per line (a new burst on the same
 * line supersedes the in-flight request) and a 6 s timeout.
 */

export const RECOGNIZE_PATH = "/api/live/recognize";

export type FetchJson = (path: string, body: unknown, init?: { signal?: AbortSignal; method?: string }) => Promise<unknown>;

export interface RecognizeClientOptions {
  fetchJson?: FetchJson;
  concurrency?: number;
  cacheEntries?: number;
  timeoutMs?: number;
}

export class LiveAbortError extends Error {
  constructor(message = "aborted") {
    super(message);
    this.name = "AbortError";
  }
}

export class RecognizeTimeoutError extends Error {
  constructor() {
    super("Recognition timed out");
    this.name = "TimeoutError";
  }
}

export function isAbortLike(err: unknown): boolean {
  return err instanceof Error && err.name === "AbortError";
}

/**
 * Additive hints the recognize route puts on its `recognizer_failed` 502 (see
 * `recognizeFailureHints` in src/app/api/live/recognize/route.ts). They are read from the
 * error itself, its raw body and its `details` so the shape of the transport never matters.
 *
 *  - `needsCrop`      the server had nothing to fall back on: send the same line again with
 *                     a crop and the vision recognizer can still read it (one retry).
 *  - `recognizerDown` Mathpix rejected our credentials, so every following line would fail
 *                     the same way: switch to the vision recognizer now.
 */
export interface RecognizeFailureHints {
  needsCrop: boolean;
  recognizerDown: boolean;
}

const NO_HINTS: RecognizeFailureHints = { needsCrop: false, recognizerDown: false };

function flagOn(obj: unknown, key: string): boolean {
  return typeof obj === "object" && obj !== null && (obj as Record<string, unknown>)[key] === true;
}

export function recognizeFailureHints(err: unknown): RecognizeFailureHints {
  if (!isApiError(err, "recognizer_failed")) return NO_HINTS;
  const bags: unknown[] = [err, err.body, err.details];
  return {
    needsCrop: bags.some((b) => flagOn(b, "needsCrop")),
    recognizerDown: bags.some((b) => flagOn(b, "recognizerDown")),
  };
}

class Limiter {
  private active = 0;
  private queue: Array<{ resolve: () => void; reject: (e: Error) => void; signal?: AbortSignal }> = [];
  constructor(private readonly slots: number) {}

  acquire(signal?: AbortSignal): Promise<() => void> {
    if (signal?.aborted) return Promise.reject(new LiveAbortError());
    const release = () => {
      this.active = Math.max(0, this.active - 1);
      this.pump();
    };
    if (this.active < this.slots) {
      this.active++;
      return Promise.resolve(release);
    }
    return new Promise<() => void>((resolve, reject) => {
      const entry = {
        resolve: () => {
          signal?.removeEventListener("abort", onAbort);
          this.active++;
          resolve(release);
        },
        reject,
        signal,
      };
      const onAbort = () => {
        this.queue = this.queue.filter((q) => q !== entry);
        reject(new LiveAbortError());
      };
      signal?.addEventListener("abort", onAbort, { once: true });
      this.queue.push(entry);
    });
  }

  private pump(): void {
    while (this.active < this.slots && this.queue.length > 0) {
      const next = this.queue.shift();
      if (!next) break;
      if (next.signal?.aborted) continue;
      next.resolve();
    }
  }

  get pending(): number {
    return this.queue.length;
  }
  get running(): number {
    return this.active;
  }
}

export class RecognizeClient {
  private readonly fetchJson: FetchJson;
  private readonly limiter: Limiter;
  private readonly cache = new Map<string, RecognizeResponse>();
  private readonly cacheEntries: number;
  private readonly timeoutMs: number;
  private readonly controllers = new Map<string, AbortController>();

  constructor(opts: RecognizeClientOptions = {}) {
    this.fetchJson = opts.fetchJson ?? (apiJson as FetchJson);
    this.limiter = new Limiter(opts.concurrency ?? 2);
    this.cacheEntries = opts.cacheEntries ?? LIVE_LIMITS.cacheEntries;
    this.timeoutMs = opts.timeoutMs ?? LIVE_TIMING.recognizeTimeoutMs;
  }

  /** Cached response for a content hash (moves it to most-recent). */
  peek(hash: string): RecognizeResponse | undefined {
    const hit = this.cache.get(hash);
    if (hit) {
      this.cache.delete(hash);
      this.cache.set(hash, hit);
    }
    return hit;
  }

  private remember(hash: string, res: RecognizeResponse): void {
    if (this.cache.has(hash)) this.cache.delete(hash);
    this.cache.set(hash, res);
    while (this.cache.size > this.cacheEntries) {
      const oldest = this.cache.keys().next().value;
      if (oldest === undefined) break;
      this.cache.delete(oldest);
    }
  }

  /** Aborts the in-flight recognition for a line (a new burst supersedes it). */
  abortLine(lineId: string): void {
    const c = this.controllers.get(lineId);
    if (c) {
      c.abort();
      this.controllers.delete(lineId);
    }
  }

  abortAll(): void {
    for (const c of this.controllers.values()) c.abort();
    this.controllers.clear();
  }

  get inFlight(): number {
    return this.controllers.size;
  }

  get cacheSize(): number {
    return this.cache.size;
  }

  /**
   * Recognizes one line. Resolves from the cache when the hash is known; otherwise
   * queues behind the limiter and POSTs. Throws LiveAbortError when superseded and
   * RecognizeTimeoutError after `timeoutMs` without a response.
   */
  async recognize(req: RecognizeRequest, hash: string): Promise<RecognizeResponse> {
    const cached = this.peek(hash);
    if (cached) return cached;

    this.abortLine(req.lineId);
    const controller = new AbortController();
    this.controllers.set(req.lineId, controller);
    const timer = setTimeout(() => controller.abort(new RecognizeTimeoutError()), this.timeoutMs);

    let release: (() => void) | null = null;
    try {
      release = await this.limiter.acquire(controller.signal);
      if (controller.signal.aborted) throw new LiveAbortError();
      // A cache fill may have happened while we waited.
      const late = this.peek(hash);
      if (late) return late;
      const raw = await this.fetchJson(RECOGNIZE_PATH, req, { signal: controller.signal });
      const parsed = RecognizeResponseSchema.safeParse(raw);
      if (!parsed.success) throw new Error("Recognizer returned an unexpected response");
      // Still worth caching: the same ink will hash the same next time.
      this.remember(hash, parsed.data);
      if (controller.signal.aborted) throw new LiveAbortError();
      return parsed.data;
    } catch (err) {
      if (controller.signal.aborted) {
        const reason: unknown = controller.signal.reason;
        if (reason instanceof RecognizeTimeoutError) throw reason;
        throw new LiveAbortError();
      }
      throw err;
    } finally {
      clearTimeout(timer);
      release?.();
      if (this.controllers.get(req.lineId) === controller) this.controllers.delete(req.lineId);
    }
  }
}

export function createRecognizeClient(opts: RecognizeClientOptions = {}): RecognizeClient {
  return new RecognizeClient(opts);
}

/** GET /api/live/recognize — capabilities + warmup, called once at board mount. */
export async function fetchCapabilities(
  fetchJson: FetchJson = apiJson as FetchJson,
  signal?: AbortSignal,
): Promise<CapabilitiesResponse> {
  const raw = await fetchJson(RECOGNIZE_PATH, undefined, { method: "GET", signal });
  const parsed = CapabilitiesResponseSchema.safeParse(raw);
  if (!parsed.success) throw new Error("Unexpected capabilities response");
  return parsed.data;
}
