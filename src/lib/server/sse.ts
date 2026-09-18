import type { z } from "zod";

/**
 * Server-Sent Events helpers for the Live Math streaming routes.
 * Frames are `event: <name>\ndata: <json>\n\n`; a `: ping` comment goes out every 15 s so
 * proxies and browsers keep the connection open while the model thinks.
 */

export const SSE_PING_MS = 15_000;

export const SSE_HEADERS: Record<string, string> = {
  "Content-Type": "text/event-stream; charset=utf-8",
  "Cache-Control": "no-cache, no-transform",
  Connection: "keep-alive",
  "X-Accel-Buffering": "no",
};

export type SseEmit = (event: string, data: unknown) => void;

/** Serialize one SSE frame. */
export function sseFrame(event: string, data: unknown): string {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

export type SseResponseOptions = {
  headers?: Record<string, string>;
  pingMs?: number;
  /** Called when `run` throws; return an event to emit before closing (default: error frame). */
  onError?: (err: unknown) => { event: string; data: unknown } | null;
};

/**
 * Build a streaming Response. `run(emit, signal)` produces the events; `signal` aborts when the
 * client disconnects (req.signal) or the stream is cancelled. When `run` rejects, an `error`
 * frame is emitted (unless the client is gone) and the stream closes.
 */
export function sseResponse(
  req: Request,
  run: (emit: SseEmit, signal: AbortSignal) => Promise<void>,
  opts: SseResponseOptions = {},
): Response {
  const encoder = new TextEncoder();
  const controller = new AbortController();
  const pingMs = opts.pingMs ?? SSE_PING_MS;

  const onReqAbort = () => controller.abort();
  req.signal?.addEventListener("abort", onReqAbort, { once: true });
  if (req.signal?.aborted) controller.abort();

  let ping: ReturnType<typeof setInterval> | null = null;
  let closed = false;

  const stream = new ReadableStream<Uint8Array>({
    start(ctrl) {
      const write = (chunk: string) => {
        if (closed) return;
        try {
          ctrl.enqueue(encoder.encode(chunk));
        } catch {
          closed = true;
        }
      };
      const close = () => {
        if (closed) return;
        closed = true;
        if (ping) clearInterval(ping);
        try {
          ctrl.close();
        } catch {
          /* already closed */
        }
      };
      const emit: SseEmit = (event, data) => write(sseFrame(event, data));

      ping = setInterval(() => write(": ping\n\n"), pingMs);
      controller.signal.addEventListener("abort", close, { once: true });

      run(emit, controller.signal)
        .catch((err: unknown) => {
          if (controller.signal.aborted) return;
          const frame = opts.onError
            ? opts.onError(err)
            : {
                event: "error",
                data: { error: "internal_error", message: err instanceof Error ? err.message : String(err) },
              };
          if (frame) emit(frame.event, frame.data);
        })
        .finally(() => {
          req.signal?.removeEventListener("abort", onReqAbort);
          close();
        });
    },
    cancel() {
      closed = true;
      if (ping) clearInterval(ping);
      controller.abort();
    },
  });

  return new Response(stream, { headers: { ...SSE_HEADERS, ...(opts.headers ?? {}) } });
}

export type JsonlResult = { count: number; invalid: number };

/** Remove markdown code fences (```json ... ```) that models sometimes wrap JSON Lines in. */
export function stripCodeFences(line: string): string {
  return line.replace(/^\s*```[a-zA-Z]*\s*$/, "").replace(/^\s*```\s*/, "").replace(/\s*```\s*$/, "");
}

/**
 * Models write LaTeX inside JSON strings with single backslashes (`"\boxed{x}"`, `"\frac12"`,
 * `"\times"`, `"\neq"`, `"\rightarrow"`). JSON.parse would silently turn `\b \f \t \n \r` into
 * control bytes and reject `\c`, `\l`, `\u`+non-hex outright. Repair before parsing:
 * - keep `\\`, `\"`, `\/` and valid `\uXXXX`
 * - a `\b \f \n \r \t` escape immediately followed by a letter is LaTeX -> `\\b` etc.
 * - any other `\x` that is not a JSON escape -> `\\x`
 * Trade-off: a literal newline escape followed directly by a letter (`"a\nb"`) becomes `\n` text;
 * the prompts never ask for multi-line strings, so this is the right default for math output.
 */
export function repairJsonEscapes(line: string): string {
  return line.replace(/\\\\|\\(?:([bfnrt])(?=[a-zA-Z])|u(?![0-9a-fA-F]{4})|(?=[^"\\/bfnrtu]))/g, (m) =>
    m === "\\\\" ? m : `\\${m}`,
  );
}

/**
 * Consume a stream of text deltas containing JSON Lines. Buffers partial lines across chunks,
 * strips code fences, `JSON.parse`s each complete line and validates it with `schema`. Valid
 * items are handed to `onItem` (which may stop the stream by returning `false`); invalid lines
 * are counted and dropped (optionally reported through `onInvalid`).
 */
export async function jsonlToEvents<S extends z.ZodTypeAny>(
  chunks: AsyncIterable<string>,
  schema: S,
  onItem: (item: z.infer<S>) => void | boolean | Promise<void | boolean>,
  onInvalid?: (line: string, reason: string) => void,
): Promise<JsonlResult> {
  let buffer = "";
  let count = 0;
  let invalid = 0;
  let stopped = false;

  const handleLine = async (rawLine: string): Promise<void> => {
    if (stopped) return;
    const line = stripCodeFences(rawLine).trim();
    if (!line) return;
    // Tolerate array-style output ("[", "]", trailing commas) without counting it as invalid.
    if (line === "[" || line === "]" || line === ",") return;
    const candidate = line.replace(/,\s*$/, "");
    if (!candidate.startsWith("{")) {
      invalid++;
      onInvalid?.(rawLine, "not a JSON object");
      return;
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(repairJsonEscapes(candidate));
    } catch {
      invalid++;
      onInvalid?.(rawLine, "invalid JSON");
      return;
    }
    const result = schema.safeParse(parsed);
    if (!result.success) {
      invalid++;
      onInvalid?.(rawLine, result.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "));
      return;
    }
    count++;
    const keepGoing = await onItem(result.data);
    if (keepGoing === false) stopped = true;
  };

  for await (const chunk of chunks) {
    if (stopped) break;
    buffer += chunk;
    let nl: number;
    while ((nl = buffer.indexOf("\n")) >= 0) {
      const line = buffer.slice(0, nl);
      buffer = buffer.slice(nl + 1);
      await handleLine(line);
      if (stopped) break;
    }
  }
  if (!stopped && buffer.trim()) await handleLine(buffer);

  return { count, invalid };
}
